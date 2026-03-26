from __future__ import annotations

import tempfile
import unittest
from io import StringIO
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

        upload_names, delete_names = media_sync_index.sync_plan(
            local_files, remote_files
        )

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
                    SimpleNamespace(
                        local_index=str(local_index), remote_index=str(remote_index)
                    )
                )

        self.assertEqual(result, 1)
        printed = "\n".join(
            str(call.args[0]) for call in print_mock.call_args_list if call.args
        )
        self.assertIn("Sync verification failed.", printed)
        self.assertIn("a.jpg", printed)
        self.assertIn("b.jpg", printed)

    def test_read_index_returns_empty_when_file_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            missing = Path(temp_dir) / "missing.tsv"
            self.assertEqual(media_sync_index.read_index(missing), {})

    def test_write_index_sorts_case_insensitively(self) -> None:
        out = StringIO()

        media_sync_index.write_index(
            {"zeta.jpg": 3, "Alpha.jpg": 1, "beta.jpg": 2}, out=out
        )

        self.assertEqual(
            out.getvalue(),
            "Alpha.jpg\t1\nbeta.jpg\t2\nzeta.jpg\t3\n",
        )

    def test_cmd_build_index_prints_directory_index(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "b.jpg").write_bytes(b"12")
            (root / "A.jpg").write_bytes(b"1")
            args = SimpleNamespace(directory=str(root))

            with mock.patch.object(media_sync_index, "write_index") as write_index_mock:
                result = media_sync_index.cmd_build_index(args)

        self.assertEqual(result, 0)
        write_index_mock.assert_called_once_with({"A.jpg": 1, "b.jpg": 2})

    def test_cmd_normalize_index_prints_sorted_normalized_index(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            index_file = Path(temp_dir) / "remote.tsv"
            index_file.write_text("b.jpg\t2\nbad\nA.jpg\t1\n", encoding="utf-8")
            args = SimpleNamespace(index_file=str(index_file))

            with mock.patch.object(media_sync_index, "write_index") as write_index_mock:
                result = media_sync_index.cmd_normalize_index(args)

        self.assertEqual(result, 0)
        write_index_mock.assert_called_once_with({"A.jpg": 1, "b.jpg": 2})

    def test_cmd_plan_writes_upload_and_delete_lists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            local_index = root / "local.tsv"
            remote_index = root / "remote.tsv"
            to_upload = root / "to-upload.txt"
            to_delete = root / "to-delete.txt"
            local_index.write_text(
                "same.jpg\t1\nnew.jpg\t4\nreplace.jpg\t7\n", encoding="utf-8"
            )
            remote_index.write_text(
                "same.jpg\t1\nreplace.jpg\t9\nold.jpg\t3\n", encoding="utf-8"
            )

            result = media_sync_index.cmd_plan(
                SimpleNamespace(
                    local_index=str(local_index),
                    remote_index=str(remote_index),
                    to_upload=str(to_upload),
                    to_delete=str(to_delete),
                )
            )

            self.assertEqual(result, 0)
            self.assertEqual(
                to_upload.read_text(encoding="utf-8"), "new.jpg\nreplace.jpg"
            )
            self.assertEqual(to_delete.read_text(encoding="utf-8"), "old.jpg")

    def test_verify_returns_success_when_indexes_match(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            local_index = Path(temp_dir) / "local.tsv"
            remote_index = Path(temp_dir) / "remote.tsv"
            local_index.write_text("a.jpg\t10\n", encoding="utf-8")
            remote_index.write_text("a.jpg\t10\n", encoding="utf-8")

            with mock.patch("builtins.print") as print_mock:
                result = media_sync_index.cmd_verify(
                    SimpleNamespace(
                        local_index=str(local_index), remote_index=str(remote_index)
                    )
                )

        self.assertEqual(result, 0)
        self.assertEqual(
            print_mock.call_args_list[0].args[0],
            "Sync verification OK: local prepared files match the remote volume.",
        )

    def test_verify_truncates_long_difference_lists(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            local_index = Path(temp_dir) / "local.tsv"
            remote_index = Path(temp_dir) / "remote.tsv"
            local_index.write_text(
                "\n".join(f"local-{index:02d}.jpg\t1" for index in range(25)) + "\n",
                encoding="utf-8",
            )
            remote_index.write_text(
                "\n".join(f"remote-{index:02d}.jpg\t2" for index in range(25)) + "\n",
                encoding="utf-8",
            )

            with mock.patch("builtins.print") as print_mock:
                result = media_sync_index.cmd_verify(
                    SimpleNamespace(
                        local_index=str(local_index), remote_index=str(remote_index)
                    )
                )

        self.assertEqual(result, 1)
        printed = "\n".join(
            str(call.args[0]) for call in print_mock.call_args_list if call.args
        )
        self.assertIn("... (25 total)", printed)

    def test_parse_args_accepts_build_index_command(self) -> None:
        with mock.patch(
            "sys.argv", ["media_sync_index.py", "build-index", "/tmp/photos"]
        ):
            args = media_sync_index.parse_args()

        self.assertEqual(args.command, "build-index")
        self.assertEqual(args.directory, "/tmp/photos")
        self.assertIs(args.func, media_sync_index.cmd_build_index)

    def test_main_dispatches_to_selected_command(self) -> None:
        expected_args = SimpleNamespace(func=mock.Mock(return_value=7))

        with mock.patch.object(
            media_sync_index, "parse_args", return_value=expected_args
        ):
            result = media_sync_index.main()

        self.assertEqual(result, 7)
        expected_args.func.assert_called_once_with(expected_args)


if __name__ == "__main__":
    unittest.main()
