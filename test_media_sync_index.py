from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from scripts import media_sync_index


class MediaSyncIndexTests(unittest.TestCase):
    def test_build_index_ignores_gitkeep_and_directories(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / ".gitkeep").write_text("")
            (root / "photo-b.JPG").write_bytes(b"12345")
            (root / "photo-a.JPG").write_bytes(b"123")
            (root / "nested").mkdir()

            index = media_sync_index.build_index(root)

        self.assertEqual(index, {"photo-a.JPG": 3, "photo-b.JPG": 5})

    def test_read_index_ignores_fly_banner_and_invalid_lines(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            index_file = Path(temp_dir) / "remote.tsv"
            index_file.write_text(
                "\n".join(
                    [
                        "Connecting to fdaa:3:5415:a7b:169:4ffb:ffcf:2...",
                        "good-a.jpg\t120",
                        "bad-line-without-tab",
                        "good-b.jpg\tnot-a-number",
                        "good-c.jpg\t450",
                    ]
                ),
                encoding="utf-8",
            )

            index = media_sync_index.read_index(index_file)

        self.assertEqual(index, {"good-a.jpg": 120, "good-c.jpg": 450})

    def test_sync_plan_returns_expected_uploads_and_deletes(self) -> None:
        local_files = {
            "keep-same.jpg": 10,
            "replace-size.jpg": 20,
            "new-file.jpg": 30,
        }
        remote_files = {
            "keep-same.jpg": 10,
            "replace-size.jpg": 99,
            "old-file.jpg": 5,
        }

        upload_names, delete_names = media_sync_index.sync_plan(local_files, remote_files)

        self.assertEqual(upload_names, ["new-file.jpg", "replace-size.jpg"])
        self.assertEqual(delete_names, ["old-file.jpg"])

    def test_verify_returns_error_when_remote_differs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            local_index = Path(temp_dir) / "local.tsv"
            remote_index = Path(temp_dir) / "remote.tsv"
            local_index.write_text("a.jpg\t10\n", encoding="utf-8")
            remote_index.write_text("b.jpg\t10\n", encoding="utf-8")

            with mock.patch("builtins.print") as print_mock:
                result = media_sync_index.cmd_verify(
                    SimpleNamespace(local_index=str(local_index), remote_index=str(remote_index))
                )

        self.assertEqual(result, 1)
        printed = "\n".join(str(call.args[0]) for call in print_mock.call_args_list if call.args)
        self.assertIn("Sync verification failed.", printed)
        self.assertIn("a.jpg", printed)
        self.assertIn("b.jpg", printed)


if __name__ == "__main__":
    unittest.main()
