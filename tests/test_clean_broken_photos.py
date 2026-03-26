from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "scripts" / "clean-broken-photos.py"
SPEC = importlib.util.spec_from_file_location("clean_broken_photos", MODULE_PATH)
clean_broken_photos = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(clean_broken_photos)


class CleanBrokenPhotosTests(unittest.TestCase):
    def test_parse_args_uses_defaults(self) -> None:
        with mock.patch("sys.argv", ["clean-broken-photos.py"]):
            args = clean_broken_photos.parse_args()

        self.assertEqual(args.directory, "assets/photos")
        self.assertEqual(args.dry_run, False)

    def test_parse_args_accepts_directory_and_dry_run(self) -> None:
        with mock.patch(
            "sys.argv", ["clean-broken-photos.py", "/tmp/photos", "--dry-run"]
        ):
            args = clean_broken_photos.parse_args()

        self.assertEqual(args.directory, "/tmp/photos")
        self.assertEqual(args.dry_run, True)

    def test_pillow_loads_returns_true_for_valid_photo(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "photo.jpg"
            Image.new("RGB", (10, 10), color=(1, 2, 3)).save(path)

            self.assertEqual(clean_broken_photos.pillow_loads(path), True)

    def test_pillow_loads_returns_false_for_invalid_photo(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "photo.jpg"
            path.write_bytes(b"broken")

            self.assertEqual(clean_broken_photos.pillow_loads(path), False)

    def test_identify_loads_checks_subprocess_result(self) -> None:
        with mock.patch.object(
            clean_broken_photos.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=0),
        ):
            self.assertEqual(
                clean_broken_photos.identify_loads(Path("/tmp/photo.jpg")), True
            )

        with mock.patch.object(
            clean_broken_photos.subprocess,
            "run",
            return_value=SimpleNamespace(returncode=1),
        ):
            self.assertEqual(
                clean_broken_photos.identify_loads(Path("/tmp/photo.jpg")), False
            )

    def test_can_load_uses_identify_when_pillow_fails(self) -> None:
        with mock.patch.object(clean_broken_photos, "pillow_loads", return_value=False):
            with mock.patch.object(
                clean_broken_photos, "identify_loads", return_value=True
            ):
                self.assertEqual(
                    clean_broken_photos.can_load(Path("/tmp/photo.jpg")), True
                )

    def test_main_returns_error_when_directory_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            missing = Path(temp_dir) / "missing"
            args = SimpleNamespace(directory=str(missing), dry_run=False)

            with mock.patch.object(
                clean_broken_photos, "parse_args", return_value=args
            ):
                with mock.patch("builtins.print") as print_mock:
                    result = clean_broken_photos.main()

        self.assertEqual(result, 1)
        self.assertIn("Directory does not exist", print_mock.call_args_list[0].args[0])

    def test_main_returns_zero_when_directory_has_no_photos(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / "notes.txt").write_text("skip", encoding="utf-8")
            args = SimpleNamespace(directory=str(root), dry_run=False)

            with mock.patch.object(
                clean_broken_photos, "parse_args", return_value=args
            ):
                with mock.patch("builtins.print") as print_mock:
                    result = clean_broken_photos.main()

        self.assertEqual(result, 0)
        self.assertIn("There are no photos", print_mock.call_args_list[0].args[0])

    def test_main_reports_all_good_when_every_photo_loads(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            good = root / "a.jpg"
            also_good = root / "b.png"
            good.write_bytes(b"a")
            also_good.write_bytes(b"b")
            args = SimpleNamespace(directory=str(root), dry_run=False)

            with mock.patch.object(
                clean_broken_photos, "parse_args", return_value=args
            ):
                with mock.patch.object(
                    clean_broken_photos, "can_load", return_value=True
                ):
                    with mock.patch("builtins.print") as print_mock:
                        result = clean_broken_photos.main()

        self.assertEqual(result, 0)
        printed = "\n".join(
            str(call.args[0]) for call in print_mock.call_args_list if call.args
        )
        self.assertIn("OK     a.jpg", printed)
        self.assertIn("OK     b.png", printed)
        self.assertIn("All good. Checked: 2", printed)

    def test_main_dry_run_reports_broken_without_deleting(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            broken = root / "broken.jpg"
            broken.write_bytes(b"broken")
            args = SimpleNamespace(directory=str(root), dry_run=True)

            with mock.patch.object(
                clean_broken_photos, "parse_args", return_value=args
            ):
                with mock.patch.object(
                    clean_broken_photos, "can_load", return_value=False
                ):
                    with mock.patch("builtins.print") as print_mock:
                        result = clean_broken_photos.main()

            self.assertEqual(result, 0)
            self.assertTrue(broken.exists())
            printed = "\n".join(
                str(call.args[0]) for call in print_mock.call_args_list if call.args
            )
            self.assertIn("DELETE broken.jpg", printed)
            self.assertIn("Detected 1 broken photos. Nothing was deleted.", printed)

    def test_main_deletes_broken_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            broken = root / "broken.jpg"
            broken.write_bytes(b"broken")
            args = SimpleNamespace(directory=str(root), dry_run=False)

            with mock.patch.object(
                clean_broken_photos, "parse_args", return_value=args
            ):
                with mock.patch.object(
                    clean_broken_photos, "can_load", return_value=False
                ):
                    with mock.patch("builtins.print") as print_mock:
                        result = clean_broken_photos.main()

        self.assertEqual(result, 0)
        self.assertFalse(broken.exists())
        self.assertIn(
            "Deleted 1 broken photos out of 1 checked.",
            print_mock.call_args_list[-1].args[0],
        )


if __name__ == "__main__":
    unittest.main()
