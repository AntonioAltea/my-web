from __future__ import annotations

import errno
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import server


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


class MediaRequestTests(unittest.TestCase):
    def test_is_media_request_accepts_query_string(self) -> None:
        self.assertTrue(server.is_media_request("/api/media?t=123"))

    def test_is_media_request_rejects_other_paths(self) -> None:
        self.assertFalse(server.is_media_request("/api/other"))

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
            self.assertIsNone(server.asset_disk_path("/styles.css"))
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
            (music / "song.flac").write_text("x")

            server.PHOTOS_DIR = photos
            server.MUSIC_DIR = music
            payload = server.media_payload()

        server.PHOTOS_DIR = original_photos
        server.MUSIC_DIR = original_music

        self.assertEqual(payload["photos"], ["/assets/photos/frame.jpg"])
        self.assertEqual(payload["music"], ["/assets/music/song.flac"])

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

        self.assertEqual([path.name for path in deduped], ["abcde1234_edited.jpg", "otra.jpg"])

    def test_dedupe_photo_paths_keeps_plain_name_when_no_base_pair_exists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            photos = Path(temp_dir)
            first = photos / "cielo_edited.jpg"
            second = photos / "mar.jpg"
            first.write_text("x")
            second.write_text("x")

            deduped = server.dedupe_photo_paths([first, second])

        self.assertEqual([path.name for path in deduped], ["cielo_edited.jpg", "mar.jpg"])


class MainTests(unittest.TestCase):
    def test_main_falls_back_to_next_free_port_when_default_is_busy(self) -> None:
        fake_server = mock.Mock()
        address_in_use = OSError(errno.EADDRINUSE, "Address already in use")

        with mock.patch.object(server, "parse_args", return_value=SimpleNamespace(host="127.0.0.1", port=8000)):
            with mock.patch.object(server, "create_server", side_effect=[address_in_use, fake_server]) as create_server_mock:
                with mock.patch.object(server, "find_available_port", return_value=8001):
                    with mock.patch("builtins.print") as print_mock:
                        result = server.main()

        self.assertEqual(result, 0)
        self.assertEqual(create_server_mock.call_args_list[0].args, ("127.0.0.1", 8000))
        self.assertEqual(create_server_mock.call_args_list[1].args, ("127.0.0.1", 8001))
        fake_server.serve_forever.assert_called_once()
        fake_server.server_close.assert_called_once()
        print_mock.assert_any_call("El puerto 8000 ya estaba en uso. Uso 8001 en su lugar.")
        print_mock.assert_any_call("Sirviendo en http://127.0.0.1:8001")

    def test_main_closes_server_cleanly_on_keyboard_interrupt(self) -> None:
        fake_server = mock.Mock()
        fake_server.serve_forever.side_effect = KeyboardInterrupt

        with mock.patch.object(server, "parse_args", return_value=SimpleNamespace(host="127.0.0.1", port=8000)):
            with mock.patch.object(server, "create_server", return_value=fake_server):
                with mock.patch("builtins.print"):
                    result = server.main()

        self.assertEqual(result, 0)
        fake_server.serve_forever.assert_called_once()
        fake_server.server_close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
