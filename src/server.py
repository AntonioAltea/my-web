from __future__ import annotations

import argparse
import errno
import json
import os
import socket
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
STATIC_ROOT = ROOT / "static"
PROJECT_ROOT = ROOT.parent
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", PROJECT_ROOT / "assets")).resolve()
PHOTOS_DIR = MEDIA_ROOT / "photos"
MUSIC_DIR = MEDIA_ROOT / "music"
ANALYTICS_FILE = MEDIA_ROOT / "analytics.json"
CANONICAL_HOST = os.environ.get("CANONICAL_HOST", "").strip()
REDIRECT_HOSTS = {
    host.strip()
    for host in os.environ.get("REDIRECT_HOSTS", "").split(",")
    if host.strip()
}
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
MUSIC_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".flac"}
ANALYTICS_LOCK = threading.Lock()
ANALYTICS_SESSION_RETENTION = timedelta(days=30)


def public_files(
    directory: Path, allowed_extensions: set[str], url_prefix: str
) -> list[str]:
    if not directory.exists():
        return []

    files = [
        f"{url_prefix}/{path.name}"
        for path in sorted(directory.iterdir(), key=lambda item: item.name.lower())
        if path.is_file() and path.suffix.lower() in allowed_extensions
    ]
    return files


def dedupe_photo_paths(paths: list[Path]) -> list[Path]:
    plain_names = {path.stem.lower() for path in paths}
    preferred: dict[str, Path] = {}

    for path in sorted(paths, key=lambda item: item.name.lower()):
        stem = path.stem
        group_key = stem.lower()

        for separator in ("_", "-"):
            if separator in stem:
                base_stem = stem.split(separator, 1)[0]
                if base_stem.lower() in plain_names:
                    group_key = base_stem.lower()
                    break

        current = preferred.get(group_key)
        if current is None:
            preferred[group_key] = path
            continue

        current_has_subtitle = current.stem != group_key
        new_has_subtitle = stem.lower() != group_key
        if new_has_subtitle and not current_has_subtitle:
            preferred[group_key] = path
        elif new_has_subtitle == current_has_subtitle and len(stem) > len(current.stem):
            preferred[group_key] = path

    return sorted(preferred.values(), key=lambda item: item.name.lower())


def is_media_request(path: str) -> bool:
    return urlparse(path).path == "/api/media"


def is_analytics_event_request(path: str) -> bool:
    return urlparse(path).path in {"/api/analytics/event", "/api/activity"}


def is_analytics_summary_request(path: str) -> bool:
    return urlparse(path).path in {
        "/api/analytics/summary",
        "/api/activity/summary",
    }


def analytics_default_state() -> dict[str, object]:
    return {
        "schema_version": 1,
        "totals": {
            "visits": 0,
            "play_starts": 0,
        },
        "tracks": {},
        "sessions": {},
    }


def load_analytics_state() -> dict[str, object]:
    if not ANALYTICS_FILE.exists():
        return analytics_default_state()

    try:
        data = json.loads(ANALYTICS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return analytics_default_state()

    if not isinstance(data, dict):
        return analytics_default_state()

    state = analytics_default_state()
    state.update(data)
    return state


def save_analytics_state(state: dict[str, object]) -> None:
    ANALYTICS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ANALYTICS_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def isoformat_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def parse_iso_datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None

    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def prune_analytics_sessions(
    state: dict[str, object], now: datetime | None = None
) -> dict[str, dict[str, object]]:
    current_time = now or utc_now()
    cutoff = current_time - ANALYTICS_SESSION_RETENTION
    sessions = state.setdefault("sessions", {})
    if not isinstance(sessions, dict):
        sessions = {}
        state["sessions"] = sessions

    expired_session_ids = []
    for session_id, session in sessions.items():
        if not isinstance(session, dict):
            expired_session_ids.append(session_id)
            continue

        last_seen = parse_iso_datetime(session.get("last_seen_at"))
        if last_seen is None or last_seen < cutoff:
            expired_session_ids.append(session_id)

    for session_id in expired_session_ids:
        sessions.pop(session_id, None)

    return sessions


def analytics_summary_from_state(
    state: dict[str, object], now: datetime | None = None
) -> dict[str, object]:
    current_time = now or utc_now()
    sessions = prune_analytics_sessions(state, current_time)
    totals = state.get("totals", {})
    if not isinstance(totals, dict):
        totals = {}

    tracks = state.get("tracks", {})
    if not isinstance(tracks, dict):
        tracks = {}

    top_tracks = []
    for file_path, track in tracks.items():
        if not isinstance(track, dict):
            continue

        play_starts = track.get("play_starts", 0)
        if not isinstance(play_starts, int):
            continue

        top_tracks.append(
            {
                "file": file_path,
                "title": track.get("title") or Path(str(file_path)).stem,
                "play_starts": play_starts,
            }
        )

    top_tracks.sort(
        key=lambda track: (-track["play_starts"], str(track["title"]).lower())
    )

    sessions_with_music = sum(
        1
        for session in sessions.values()
        if isinstance(session, dict) and session.get("played_tracks")
    )

    return {
        "generated_at": isoformat_utc(current_time),
        "totals": {
            "visits": int(totals.get("visits", 0)),
            "play_starts": int(totals.get("play_starts", 0)),
            "sessions_with_music": sessions_with_music,
            "tracked_sessions": len(sessions),
        },
        "top_tracks": top_tracks[:10],
    }


def record_analytics_event(payload: dict[str, object]) -> dict[str, object]:
    event_type = payload.get("type")
    session_id = payload.get("sessionId")

    if event_type not in {"visit", "track_play"}:
        raise ValueError("Unsupported analytics event type")

    if not isinstance(session_id, str) or not session_id.strip():
        raise ValueError("Missing analytics session ID")

    session_id = session_id.strip()[:120]
    current_time = utc_now()

    with ANALYTICS_LOCK:
        state = load_analytics_state()
        sessions = prune_analytics_sessions(state, current_time)
        totals = state.setdefault("totals", {})
        if not isinstance(totals, dict):
            totals = {}
            state["totals"] = totals

        tracks = state.setdefault("tracks", {})
        if not isinstance(tracks, dict):
            tracks = {}
            state["tracks"] = tracks

        session = sessions.get(session_id)
        if not isinstance(session, dict):
            session = {
                "visited": False,
                "played_tracks": [],
                "last_seen_at": isoformat_utc(current_time),
            }
            sessions[session_id] = session

        session["last_seen_at"] = isoformat_utc(current_time)

        if event_type == "visit":
            if not session.get("visited"):
                totals["visits"] = int(totals.get("visits", 0)) + 1
                session["visited"] = True
        else:
            track_file = payload.get("trackFile")
            if not isinstance(track_file, str) or not track_file.startswith(
                "/assets/music/"
            ):
                raise ValueError("Invalid analytics track path")

            track_title = payload.get("trackTitle")
            if not isinstance(track_title, str) or not track_title.strip():
                track_title = Path(track_file).stem

            totals["play_starts"] = int(totals.get("play_starts", 0)) + 1

            track_stats = tracks.get(track_file)
            if not isinstance(track_stats, dict):
                track_stats = {"title": track_title, "play_starts": 0}
                tracks[track_file] = track_stats

            track_stats["title"] = track_title
            track_stats["play_starts"] = int(track_stats.get("play_starts", 0)) + 1

            played_tracks = session.get("played_tracks")
            if not isinstance(played_tracks, list):
                played_tracks = []
                session["played_tracks"] = played_tracks

            if track_file not in played_tracks:
                played_tracks.append(track_file)

        save_analytics_state(state)
        return analytics_summary_from_state(state, current_time)


def media_payload() -> dict[str, list[str]]:
    photo_paths = (
        [
            path
            for path in sorted(PHOTOS_DIR.iterdir(), key=lambda item: item.name.lower())
            if path.is_file() and path.suffix.lower() in PHOTO_EXTENSIONS
        ]
        if PHOTOS_DIR.exists()
        else []
    )

    photo_paths = dedupe_photo_paths(photo_paths)

    return {
        "photos": [f"/assets/photos/{path.name}" for path in photo_paths],
        "music": public_files(MUSIC_DIR, MUSIC_EXTENSIONS, "/assets/music"),
    }


def ensure_media_dirs() -> None:
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)


def asset_disk_path(request_path: str) -> Path | None:
    parsed_path = unquote(urlparse(request_path).path)

    if parsed_path.startswith("/assets/photos/"):
        file_name = Path(parsed_path).name
        return PHOTOS_DIR / file_name

    if parsed_path.startswith("/assets/music/"):
        file_name = Path(parsed_path).name
        return MUSIC_DIR / file_name

    if parsed_path.startswith("/assets/icons/"):
        file_name = Path(parsed_path).name
        return PROJECT_ROOT / "assets" / "icons" / file_name

    if parsed_path == "/favicon.ico":
        return PROJECT_ROOT / "favicon.ico"

    if parsed_path.startswith("/static/"):
        return ROOT / parsed_path.lstrip("/")

    if parsed_path == "/":
        return ROOT / "index.html"

    if parsed_path in {"/stats", "/stats/", "/stats.html"}:
        return ROOT / "stats.html"

    relative_path = parsed_path.lstrip("/")
    if not relative_path:
        return ROOT / "index.html"

    return ROOT / relative_path


def static_disk_path(request_path: str) -> Path:
    disk_path = asset_disk_path(request_path)
    if disk_path is None:
        return ROOT / "index.html"
    return disk_path


def guess_directory_path(request_path: str) -> Path:
    parsed_path = unquote(urlparse(request_path).path)
    relative_path = parsed_path.lstrip("/")
    return ROOT / relative_path


def should_serve_index(request_path: str) -> bool:
    parsed_path = unquote(urlparse(request_path).path)
    if parsed_path in {"", "/"}:
        return True

    disk_path = guess_directory_path(request_path)
    return parsed_path.endswith("/") and disk_path.is_dir()


def redirect_target(host_header: str | None, request_path: str) -> str | None:
    if not CANONICAL_HOST or not host_header:
        return None

    host = host_header.split(":", 1)[0].strip().lower()
    if host not in REDIRECT_HOSTS:
        return None

    path = urlparse(request_path).path or "/"
    query = urlparse(request_path).query
    location = f"https://{CANONICAL_HOST}{path}"
    if query:
        location = f"{location}?{query}"
    return location


class MediaHandler(SimpleHTTPRequestHandler):
    def _client_disconnected(
        self, error: BrokenPipeError | ConnectionResetError
    ) -> None:
        # The browser may cancel media downloads when switching tracks.
        if isinstance(error, ConnectionResetError) and error.errno != errno.ECONNRESET:
            raise

    def end_headers(self) -> None:
        request_path = urlparse(self.path).path

        if (
            request_path
            in {"/", "/index.html", "/favicon.ico", "/stats", "/stats/", "/stats.html"}
            or request_path.startswith("/static/css/")
            or request_path.startswith("/static/js/")
            or request_path.startswith("/assets/icons/")
        ):
            self.send_header("Cache-Control", "no-store, max-age=0")

        super().end_headers()

    def translate_path(self, path: str) -> str:
        if should_serve_index(path):
            return str(ROOT / "index.html")
        return str(static_disk_path(path))

    def do_GET(self) -> None:
        location = redirect_target(self.headers.get("Host"), self.path)
        if location is not None:
            self.send_response(301)
            self.send_header("Location", location)
            self.end_headers()
            return

        if is_media_request(self.path):
            payload = media_payload()
            self._send_json_response(payload)
            return

        if is_analytics_summary_request(self.path):
            with ANALYTICS_LOCK:
                state = load_analytics_state()
                summary = analytics_summary_from_state(state)
                save_analytics_state(state)
            self._send_json_response(summary)
            return

        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError) as error:
            self._client_disconnected(error)

    def do_POST(self) -> None:
        if not is_analytics_event_request(self.path):
            self.send_error(404, "Not Found")
            return

        content_length = self.headers.get("Content-Length", "0")
        try:
            body_length = int(content_length)
        except ValueError:
            body_length = 0

        try:
            raw_body = self.rfile.read(body_length)
            payload = json.loads(raw_body.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("Request body must be a JSON object")

            summary = record_analytics_event(payload)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
            self._send_json_response(
                {"error": str(error)},
                status=400,
            )
            return

        self._send_json_response(summary, status=202)

    def _send_json_response(self, payload: object, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError) as error:
            self._client_disconnected(error)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    return parser.parse_args()


def create_server(host: str, port: int) -> ThreadingHTTPServer:
    try:
        return ThreadingHTTPServer((host, port), MediaHandler)
    except OSError as error:
        if error.errno == errno.EADDRINUSE:
            raise
        raise


def find_available_port(host: str, start_port: int, attempts: int = 20) -> int:
    for port in range(start_port, start_port + attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, port))
            except OSError:
                continue
            return port

    raise OSError(errno.EADDRINUSE, "No available ports found")


def main() -> int:
    args = parse_args()
    ensure_media_dirs()

    chosen_port = args.port

    try:
        server = create_server(args.host, chosen_port)
    except OSError as error:
        if error.errno != errno.EADDRINUSE:
            raise

        chosen_port = find_available_port(args.host, args.port + 1)
        print(f"Port {args.port} was already in use. Using {chosen_port} instead.")
        server = create_server(args.host, chosen_port)

    print(f"Serving at http://{args.host}:{chosen_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
