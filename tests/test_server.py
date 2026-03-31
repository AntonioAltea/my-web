from __future__ import annotations

import errno
import io
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from src import server


class PublicFilesTests(unittest.TestCase):
    def test_public_files_filters_extensions_and_sorts_case_insensitively(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            directory = Path(temp_dir)
            (directory / "b.JPG").write_text("x")
            (directory / "a.jpg").write_text("x")
            (directory / "note.txt").write_text("x")

            files = server.public_files(directory, {".jpg", ".jpeg"}, "/assets/photos")

            self.assertEqual(files, ["/assets/photos/a.jpg", "/assets/photos/b.JPG"])

    def test_public_files_returns_empty_for_missing_directory(self) -> None:
        directory = Path("/tmp/does-not-exist-codex-test")
        files = server.public_files(directory, {".jpg"}, "/assets/photos")
        self.assertEqual(files, [])


def make_flac_file(path: Path, comments: dict[str, str]) -> None:
    vendor = b"manturon-tests"
    entries = []
    for key, value in comments.items():
        comment = f"{key}={value}".encode("utf-8")
        entries.append(len(comment).to_bytes(4, "little") + comment)

    metadata = b"".join(
        [
            len(vendor).to_bytes(4, "little"),
            vendor,
            len(entries).to_bytes(4, "little"),
            *entries,
        ]
    )
    header = bytes([0x84]) + len(metadata).to_bytes(3, "big")
    path.write_bytes(b"fLaC" + header + metadata)


class MediaRequestTests(unittest.TestCase):
    def test_is_media_request_accepts_query_string(self) -> None:
        self.assertTrue(server.is_media_request("/api/media?t=123"))

    def test_is_media_request_rejects_other_paths(self) -> None:
        self.assertFalse(server.is_media_request("/api/other"))

    def test_is_analytics_event_request_accepts_exact_path(self) -> None:
        self.assertTrue(server.is_analytics_event_request("/api/analytics/event"))
        self.assertTrue(server.is_analytics_event_request("/api/activity"))

    def test_is_analytics_summary_request_accepts_exact_path(self) -> None:
        self.assertTrue(server.is_analytics_summary_request("/api/analytics/summary"))
        self.assertTrue(server.is_analytics_summary_request("/api/activity/summary"))

    def test_asset_disk_path_maps_media_urls(self) -> None:
        original_photos = server.PHOTOS_DIR
        original_music = server.MUSIC_DIR

        try:
            server.PHOTOS_DIR = Path("/tmp/photos-test")
            server.MUSIC_DIR = Path("/tmp/music-test")
            self.assertEqual(
                server.asset_disk_path("/assets/photos/example.jpg"),
                Path("/tmp/photos-test/example.jpg"),
            )
            self.assertEqual(
                server.asset_disk_path("/assets/music/example.flac"),
                Path("/tmp/music-test/example.flac"),
            )
            self.assertEqual(
                server.asset_disk_path("/assets/photos/callado-mu%C3%B1eco.JPG"),
                Path("/tmp/photos-test/callado-muñeco.JPG"),
            )
            self.assertEqual(
                server.asset_disk_path("/static/css/styles.css"),
                server.ROOT / "static" / "css" / "styles.css",
            )
        finally:
            server.PHOTOS_DIR = original_photos
            server.MUSIC_DIR = original_music

    def test_redirect_target_uses_canonical_host(self) -> None:
        original_canonical = server.CANONICAL_HOST
        original_redirect_hosts = server.REDIRECT_HOSTS

        try:
            server.CANONICAL_HOST = "www.manturon.es"
            server.REDIRECT_HOSTS = {"manturon.es"}
            self.assertEqual(
                server.redirect_target("manturon.es", "/photos?a=1"),
                "https://www.manturon.es/photos?a=1",
            )
            self.assertIsNone(server.redirect_target("www.manturon.es", "/"))
        finally:
            server.CANONICAL_HOST = original_canonical
            server.REDIRECT_HOSTS = original_redirect_hosts

    def test_end_headers_disables_cache_for_html_css_and_js(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/static/css/styles.css"
        handler._headers_buffer = []
        handler.wfile = io.BytesIO()
        handler.request_version = "HTTP/1.1"
        handler.command = "GET"

        with mock.patch.object(
            server.SimpleHTTPRequestHandler, "end_headers", autospec=True
        ) as end_headers_mock:
            server.MediaHandler.end_headers(handler)

        cache_headers = [
            header.decode("latin-1")
            for header in handler._headers_buffer
            if b"Cache-Control" in header
        ]
        self.assertEqual(cache_headers, ["Cache-Control: no-store, max-age=0\r\n"])
        end_headers_mock.assert_called_once_with(handler)

    def test_end_headers_disables_cache_for_favicon(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/favicon.ico?v=3"
        handler._headers_buffer = []
        handler.wfile = io.BytesIO()
        handler.request_version = "HTTP/1.1"
        handler.command = "GET"

        with mock.patch.object(
            server.SimpleHTTPRequestHandler, "end_headers", autospec=True
        ) as end_headers_mock:
            server.MediaHandler.end_headers(handler)

        cache_headers = [
            header.decode("latin-1")
            for header in handler._headers_buffer
            if b"Cache-Control" in header
        ]
        self.assertEqual(cache_headers, ["Cache-Control: no-store, max-age=0\r\n"])
        end_headers_mock.assert_called_once_with(handler)

    def test_do_get_ignores_client_disconnect_while_serving_file(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/assets/music/demo.flac"
        handler.headers = {}

        with mock.patch.object(
            server.SimpleHTTPRequestHandler,
            "do_GET",
            autospec=True,
            side_effect=ConnectionResetError(
                errno.ECONNRESET, "Connection reset by peer"
            ),
        ) as do_get_mock:
            server.MediaHandler.do_GET(handler)

        do_get_mock.assert_called_once_with(handler)

    def test_do_get_reraises_unexpected_connection_reset(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/assets/music/demo.flac"
        handler.headers = {}

        with mock.patch.object(
            server.SimpleHTTPRequestHandler,
            "do_GET",
            autospec=True,
            side_effect=ConnectionResetError(errno.EPIPE, "Unexpected reset"),
        ):
            with self.assertRaises(ConnectionResetError):
                server.MediaHandler.do_GET(handler)

    def test_translate_path_uses_asset_disk_path_for_media(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)

        with mock.patch.object(
            server, "asset_disk_path", return_value=Path("/tmp/demo.jpg")
        ):
            translated = server.MediaHandler.translate_path(
                handler, "/assets/photos/demo.jpg"
            )

        self.assertEqual(translated, "/tmp/demo.jpg")

    def test_translate_path_uses_src_files_for_non_media(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)

        translated = server.MediaHandler.translate_path(
            handler, "/static/css/styles.css"
        )

        self.assertEqual(
            translated,
            str(server.ROOT / "static" / "css" / "styles.css"),
        )

    def test_do_get_redirects_to_canonical_host(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/foto?a=1"
        handler.headers = {"Host": "manturon.es"}
        handler.wfile = io.BytesIO()

        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()

        with mock.patch.object(
            server, "redirect_target", return_value="https://www.manturon.es/foto?a=1"
        ):
            server.MediaHandler.do_GET(handler)

        handler.send_response.assert_called_once_with(301)
        handler.send_header.assert_called_once_with(
            "Location", "https://www.manturon.es/foto?a=1"
        )
        handler.end_headers.assert_called_once_with()

    def test_do_get_returns_media_payload_json(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/api/media"
        handler.headers = {}
        handler.wfile = io.BytesIO()

        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()

        payload = {
            "photos": ["/assets/photos/demo.jpg"],
            "music": [
                {
                    "file": "/assets/music/demo.flac",
                    "title": "Demo",
                    "track_number": 1,
                }
            ],
        }

        with mock.patch.object(server, "redirect_target", return_value=None):
            with mock.patch.object(server, "media_payload", return_value=payload):
                server.MediaHandler.do_GET(handler)

        self.assertEqual(
            handler.wfile.getvalue(),
            b'{"photos": ["/assets/photos/demo.jpg"], "music": [{"file": "/assets/music/demo.flac", "title": "Demo", "track_number": 1}]}',
        )
        handler.send_response.assert_called_once_with(200)
        handler.send_header.assert_any_call(
            "Content-Type", "application/json; charset=utf-8"
        )
        handler.send_header.assert_any_call("Cache-Control", "no-store, max-age=0")
        handler.send_header.assert_any_call("Pragma", "no-cache")
        handler.send_header.assert_any_call(
            "Content-Length",
            str(len(handler.wfile.getvalue())),
        )
        handler.end_headers.assert_called_once_with()

    def test_do_get_returns_analytics_summary_json(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/api/analytics/summary"
        handler.headers = {}
        handler.wfile = io.BytesIO()

        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()

        with tempfile.TemporaryDirectory() as temp_dir:
            original_analytics_file = server.ANALYTICS_FILE
            server.ANALYTICS_FILE = Path(temp_dir) / "analytics.json"
            try:
                with mock.patch.object(server, "redirect_target", return_value=None):
                    server.MediaHandler.do_GET(handler)
            finally:
                server.ANALYTICS_FILE = original_analytics_file

        payload = json.loads(handler.wfile.getvalue().decode("utf-8"))
        self.assertEqual(payload["totals"]["visits"], 0)
        handler.send_response.assert_called_once_with(200)

    def test_do_post_records_analytics_event(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/api/analytics/event"
        handler.headers = {"Content-Length": "44"}
        handler.rfile = io.BytesIO(b'{"type":"visit","sessionId":"session-a"}')
        handler.wfile = io.BytesIO()

        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()

        with tempfile.TemporaryDirectory() as temp_dir:
            original_analytics_file = server.ANALYTICS_FILE
            server.ANALYTICS_FILE = Path(temp_dir) / "analytics.json"
            try:
                server.MediaHandler.do_POST(handler)
            finally:
                server.ANALYTICS_FILE = original_analytics_file

        payload = json.loads(handler.wfile.getvalue().decode("utf-8"))
        self.assertEqual(payload["totals"]["visits"], 1)
        handler.send_response.assert_called_once_with(202)

    def test_do_post_rejects_invalid_analytics_event(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/api/analytics/event"
        handler.headers = {"Content-Length": "16"}
        handler.rfile = io.BytesIO(b'{"type":"visit"}')
        handler.wfile = io.BytesIO()

        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()

        server.MediaHandler.do_POST(handler)

        payload = json.loads(handler.wfile.getvalue().decode("utf-8"))
        self.assertIn("error", payload)
        handler.send_response.assert_called_once_with(400)

    def test_do_get_handles_disconnect_while_writing_media_payload(self) -> None:
        handler = server.MediaHandler.__new__(server.MediaHandler)
        handler.path = "/api/media"
        handler.headers = {}
        handler.wfile = mock.Mock()
        handler.wfile.write.side_effect = BrokenPipeError()

        handler.send_response = mock.Mock()
        handler.send_header = mock.Mock()
        handler.end_headers = mock.Mock()
        handler._client_disconnected = mock.Mock()

        with mock.patch.object(server, "redirect_target", return_value=None):
            with mock.patch.object(
                server, "media_payload", return_value={"photos": [], "music": []}
            ):
                server.MediaHandler.do_GET(handler)

        handler._client_disconnected.assert_called_once()


class MediaPayloadTests(unittest.TestCase):
    def test_media_payload_uses_expected_prefixes(self) -> None:
        original_photos = server.PHOTOS_DIR
        original_music = server.MUSIC_DIR

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            photos = root / "photos"
            music = root / "music"
            photos.mkdir()
            music.mkdir()
            (photos / "frame.jpg").write_text("x")
            make_flac_file(
                music / "song.flac",
                {"TITLE": "Song From Metadata", "TRACKNUMBER": "2"},
            )

            server.PHOTOS_DIR = photos
            server.MUSIC_DIR = music
            payload = server.media_payload()

        server.PHOTOS_DIR = original_photos
        server.MUSIC_DIR = original_music

        self.assertEqual(payload["photos"], ["/assets/photos/frame.jpg"])
        self.assertEqual(
            payload["music"],
            [
                {
                    "file": "/assets/music/song.flac",
                    "title": "Song From Metadata",
                    "track_number": 2,
                }
            ],
        )

    def test_media_payload_orders_music_by_track_number(self) -> None:
        original_music = server.MUSIC_DIR

        with tempfile.TemporaryDirectory() as temp_dir:
            music = Path(temp_dir) / "music"
            music.mkdir()
            make_flac_file(
                music / "b-side.flac",
                {"TITLE": "B Side", "TRACKNUMBER": "2/10"},
            )
            make_flac_file(
                music / "a-side.flac",
                {"TITLE": "A Side", "TRACKNUMBER": "1"},
            )
            make_flac_file(music / "bonus-track.flac", {"TITLE": "Bonus Track"})

            server.MUSIC_DIR = music
            payload = server.media_payload()

        server.MUSIC_DIR = original_music

        self.assertEqual(
            [track["file"] for track in payload["music"]],
            [
                "/assets/music/a-side.flac",
                "/assets/music/b-side.flac",
                "/assets/music/bonus-track.flac",
            ],
        )

    def test_music_entry_from_path_falls_back_to_file_name(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            track_path = Path(temp_dir) / "mi-tema-bonito.flac"
            track_path.write_bytes(b"fLaC")

            entry = server.music_entry_from_path(track_path)

        self.assertEqual(entry["file"], "/assets/music/mi-tema-bonito.flac")
        self.assertEqual(entry["title"], "mi tema bonito")
        self.assertIsNone(entry["track_number"])

    def test_ensure_media_dirs_creates_missing_directories(self) -> None:
        original_root = server.MEDIA_ROOT
        original_photos = server.PHOTOS_DIR
        original_music = server.MUSIC_DIR

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "media"
            server.MEDIA_ROOT = root
            server.PHOTOS_DIR = root / "photos"
            server.MUSIC_DIR = root / "music"

            server.ensure_media_dirs()

            self.assertTrue(server.PHOTOS_DIR.exists())
            self.assertTrue(server.MUSIC_DIR.exists())

        server.MEDIA_ROOT = original_root
        server.PHOTOS_DIR = original_photos
        server.MUSIC_DIR = original_music

    def test_dedupe_photo_paths_prefers_variant_with_subtitle(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            photos = Path(temp_dir)
            plain = photos / "abcde1234.jpg"
            edited = photos / "abcde1234_edited.jpg"
            alt = photos / "otra.jpg"
            plain.write_text("x")
            edited.write_text("x")
            alt.write_text("x")

            deduped = server.dedupe_photo_paths([plain, edited, alt])

        self.assertEqual(
            [path.name for path in deduped], ["abcde1234_edited.jpg", "otra.jpg"]
        )

    def test_dedupe_photo_paths_keeps_plain_name_when_no_base_pair_exists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            photos = Path(temp_dir)
            first = photos / "cielo_edited.jpg"
            second = photos / "mar.jpg"
            first.write_text("x")
            second.write_text("x")

            deduped = server.dedupe_photo_paths([first, second])

        self.assertEqual(
            [path.name for path in deduped], ["cielo_edited.jpg", "mar.jpg"]
        )

    def test_dedupe_photo_paths_prefers_longer_name_when_variants_have_subtitle(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            photos = Path(temp_dir)
            plain = photos / "abcde.jpg"
            first = photos / "abcde-sub.jpg"
            second = photos / "abcde-subtitle.jpg"
            plain.write_text("x")
            first.write_text("x")
            second.write_text("x")

            deduped = server.dedupe_photo_paths([plain, first, second])

        self.assertEqual([path.name for path in deduped], ["abcde-subtitle.jpg"])


class MainTests(unittest.TestCase):
    def test_parse_args_uses_defaults(self) -> None:
        with mock.patch("sys.argv", ["src.server"]):
            args = server.parse_args()

        self.assertEqual(args.host, "127.0.0.1")
        self.assertEqual(args.port, 8000)

    def test_parse_args_accepts_custom_values(self) -> None:
        with mock.patch(
            "sys.argv", ["src.server", "--host", "0.0.0.0", "--port", "9000"]
        ):
            args = server.parse_args()

        self.assertEqual(args.host, "0.0.0.0")
        self.assertEqual(args.port, 9000)

    def test_create_server_reraises_non_address_in_use_errors(self) -> None:
        with mock.patch.object(
            server,
            "ThreadingHTTPServer",
            side_effect=OSError(errno.EACCES, "Permission denied"),
        ):
            with self.assertRaises(OSError):
                server.create_server("127.0.0.1", 8000)

    def test_create_server_reraises_address_in_use_errors(self) -> None:
        with mock.patch.object(
            server,
            "ThreadingHTTPServer",
            side_effect=OSError(errno.EADDRINUSE, "Address already in use"),
        ):
            with self.assertRaises(OSError):
                server.create_server("127.0.0.1", 8000)

    def test_find_available_port_returns_first_bindable_port(self) -> None:
        first_socket = mock.MagicMock()
        first_socket.__enter__.return_value = first_socket
        first_socket.bind.side_effect = OSError(errno.EADDRINUSE, "busy")

        second_socket = mock.MagicMock()
        second_socket.__enter__.return_value = second_socket
        second_socket.bind.return_value = None

        with mock.patch.object(
            server.socket, "socket", side_effect=[first_socket, second_socket]
        ):
            available = server.find_available_port("127.0.0.1", 8000, attempts=2)

        self.assertEqual(available, 8001)

    def test_find_available_port_raises_when_no_ports_are_free(self) -> None:
        fake_socket = mock.MagicMock()
        fake_socket.__enter__.return_value = fake_socket
        fake_socket.bind.side_effect = OSError(errno.EADDRINUSE, "busy")

        with mock.patch.object(server.socket, "socket", return_value=fake_socket):
            with self.assertRaises(OSError):
                server.find_available_port("127.0.0.1", 8000, attempts=2)

    def test_main_falls_back_to_next_free_port_when_default_is_busy(self) -> None:
        fake_server = mock.Mock()
        address_in_use = OSError(errno.EADDRINUSE, "Address already in use")

        with mock.patch.object(
            server,
            "parse_args",
            return_value=SimpleNamespace(host="127.0.0.1", port=8000),
        ):
            with mock.patch.object(
                server, "create_server", side_effect=[address_in_use, fake_server]
            ) as create_server_mock:
                with mock.patch.object(
                    server, "find_available_port", return_value=8001
                ):
                    with mock.patch("builtins.print") as print_mock:
                        result = server.main()

        self.assertEqual(result, 0)
        self.assertEqual(create_server_mock.call_args_list[0].args, ("127.0.0.1", 8000))
        self.assertEqual(create_server_mock.call_args_list[1].args, ("127.0.0.1", 8001))
        fake_server.serve_forever.assert_called_once()
        fake_server.server_close.assert_called_once()
        print_mock.assert_any_call("Port 8000 was already in use. Using 8001 instead.")
        print_mock.assert_any_call("Serving at http://127.0.0.1:8001")

    def test_main_closes_server_cleanly_on_keyboard_interrupt(self) -> None:
        fake_server = mock.Mock()
        fake_server.serve_forever.side_effect = KeyboardInterrupt

        with mock.patch.object(
            server,
            "parse_args",
            return_value=SimpleNamespace(host="127.0.0.1", port=8000),
        ):
            with mock.patch.object(server, "create_server", return_value=fake_server):
                with mock.patch("builtins.print"):
                    result = server.main()

        self.assertEqual(result, 0)
        fake_server.serve_forever.assert_called_once()
        fake_server.server_close.assert_called_once()

    def test_main_reraises_non_address_in_use_server_error(self) -> None:
        permission_error = OSError(errno.EACCES, "Permission denied")

        with mock.patch.object(
            server,
            "parse_args",
            return_value=SimpleNamespace(host="127.0.0.1", port=8000),
        ):
            with mock.patch.object(
                server, "create_server", side_effect=permission_error
            ):
                with self.assertRaises(OSError):
                    server.main()


class AnalyticsTests(unittest.TestCase):
    def test_record_analytics_event_counts_visit_once_per_session(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            original_analytics_file = server.ANALYTICS_FILE
            server.ANALYTICS_FILE = Path(temp_dir) / "analytics.json"
            try:
                first = server.record_analytics_event(
                    {"type": "visit", "sessionId": "session-a"}
                )
                second = server.record_analytics_event(
                    {"type": "visit", "sessionId": "session-a"}
                )
            finally:
                server.ANALYTICS_FILE = original_analytics_file

        self.assertEqual(first["totals"]["visits"], 1)
        self.assertEqual(second["totals"]["visits"], 1)

    def test_record_analytics_event_counts_sessions_with_music(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            original_analytics_file = server.ANALYTICS_FILE
            server.ANALYTICS_FILE = Path(temp_dir) / "analytics.json"
            try:
                server.record_analytics_event(
                    {"type": "visit", "sessionId": "session-a"}
                )
                first = server.record_analytics_event(
                    {
                        "type": "track_play",
                        "sessionId": "session-a",
                        "trackFile": "/assets/music/uno.mp3",
                        "trackTitle": "uno",
                    }
                )
                second = server.record_analytics_event(
                    {
                        "type": "track_play",
                        "sessionId": "session-a",
                        "trackFile": "/assets/music/dos.mp3",
                        "trackTitle": "dos",
                    }
                )
                third = server.record_analytics_event(
                    {
                        "type": "track_play",
                        "sessionId": "session-a",
                        "trackFile": "/assets/music/dos.mp3",
                        "trackTitle": "dos",
                    }
                )
            finally:
                server.ANALYTICS_FILE = original_analytics_file

        self.assertEqual(first["totals"]["play_starts"], 1)
        self.assertEqual(second["totals"]["sessions_with_music"], 1)
        self.assertEqual(third["totals"]["sessions_with_music"], 1)
        self.assertEqual(third["top_tracks"][0]["title"], "dos")


if __name__ == "__main__":
    unittest.main()
