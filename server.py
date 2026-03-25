from __future__ import annotations

import argparse
import errno
import json
import os
import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", ROOT / "assets")).resolve()
PHOTOS_DIR = MEDIA_ROOT / "photos"
MUSIC_DIR = MEDIA_ROOT / "music"
CANONICAL_HOST = os.environ.get("CANONICAL_HOST", "").strip()
REDIRECT_HOSTS = {
    host.strip()
    for host in os.environ.get("REDIRECT_HOSTS", "").split(",")
    if host.strip()
}
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
MUSIC_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".flac"}


def public_files(directory: Path, allowed_extensions: set[str], url_prefix: str) -> list[str]:
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


def media_payload() -> dict[str, list[str]]:
    photo_paths = [
        path
        for path in sorted(PHOTOS_DIR.iterdir(), key=lambda item: item.name.lower())
        if path.is_file() and path.suffix.lower() in PHOTO_EXTENSIONS
    ] if PHOTOS_DIR.exists() else []

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

    return None


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
    def _client_disconnected(self, error: BrokenPipeError | ConnectionResetError) -> None:
        # The browser may cancel media downloads when switching tracks.
        if isinstance(error, ConnectionResetError) and error.errno != errno.ECONNRESET:
            raise

    def end_headers(self) -> None:
        request_path = urlparse(self.path).path

        if request_path in {"/", "/index.html"} or request_path.endswith((".css", ".js")):
            self.send_header("Cache-Control", "no-store, max-age=0")

        super().end_headers()

    def translate_path(self, path: str) -> str:
        asset_path = asset_disk_path(path)
        if asset_path is not None:
            return str(asset_path)

        return super().translate_path(path)

    def do_GET(self) -> None:
        location = redirect_target(self.headers.get("Host"), self.path)
        if location is not None:
            self.send_response(301)
            self.send_header("Location", location)
            self.end_headers()
            return

        if is_media_request(self.path):
            payload = media_payload()
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError) as error:
                self._client_disconnected(error)
            return

        try:
            super().do_GET()
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
        print(f"El puerto {args.port} ya estaba en uso. Uso {chosen_port} en su lugar.")
        server = create_server(args.host, chosen_port)

    print(f"Sirviendo en http://{args.host}:{chosen_port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
