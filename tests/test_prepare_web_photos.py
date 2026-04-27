from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


ROOT = Path(__file__).resolve().parent.parent
MODULE_PATH = ROOT / "scripts" / "prepare-web-photos.py"
SCRIPTS_DIR = str(ROOT / "scripts")
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)
SPEC = importlib.util.spec_from_file_location("prepare_web_photos", MODULE_PATH)
prepare_web_photos = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(prepare_web_photos)


class PrepareWebPhotosTests(unittest.TestCase):
    def test_parse_args_accepts_custom_values(self) -> None:
        with mock.patch(
            "sys.argv",
            [
                "prepare-web-photos.py",
                "photos",
                "out",
                "--max-dim",
                "1400",
                "--jpeg-quality",
                "70",
                "--webp-quality",
                "65",
            ],
        ):
            args = prepare_web_photos.parse_args()

        self.assertEqual(args.source, "photos")
        self.assertEqual(args.target, "out")
        self.assertEqual(args.max_dim, 1400)
        self.assertEqual(args.jpeg_quality, 70)
        self.assertEqual(args.webp_quality, 65)

    def test_main_returns_error_when_source_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            missing = Path(temp_dir) / "missing"
            target = Path(temp_dir) / "target"
            args = SimpleNamespace(
                source=str(missing),
                target=str(target),
                max_dim=2200,
                jpeg_quality=82,
                webp_quality=80,
            )

            with mock.patch.object(prepare_web_photos, "parse_args", return_value=args):
                with mock.patch("builtins.print") as print_mock:
                    result = prepare_web_photos.main()

        self.assertEqual(result, 1)
        self.assertIn(
            "Source directory does not exist", print_mock.call_args_list[0].args[0]
        )

    def test_main_returns_zero_when_no_photos_exist(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "source"
            target = Path(temp_dir) / "target"
            source.mkdir()
            (source / "note.txt").write_text("hola", encoding="utf-8")
            args = SimpleNamespace(
                source=str(source),
                target=str(target),
                max_dim=2200,
                jpeg_quality=82,
                webp_quality=80,
            )

            with mock.patch.object(prepare_web_photos, "parse_args", return_value=args):
                with mock.patch("sys.stderr") as stderr:
                    result = prepare_web_photos.main()

        self.assertEqual(result, 0)
        stderr.write.assert_called()

    def test_main_optimizes_supported_photos_in_sorted_order(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "source"
            target = Path(temp_dir) / "target"
            source.mkdir()
            (source / "b.webp").write_bytes(b"webp")
            (source / "A.JPG").write_bytes(b"jpg")
            (source / ".gitkeep").write_text("", encoding="utf-8")
            (source / "notes.txt").write_text("skip", encoding="utf-8")
            args = SimpleNamespace(
                source=str(source),
                target=str(target),
                max_dim=1800,
                jpeg_quality=70,
                webp_quality=60,
            )

            calls: list[tuple[str, tuple[int, ...], int, int]] = []

            def fake_optimize_set(
                source_path: Path,
                target_path: Path,
                *,
                max_dims: tuple[int, ...],
                jpeg_quality: int,
                webp_quality: int,
            ) -> list[dict[str, object]]:
                calls.append(
                    (
                        source_path.name,
                        max_dims,
                        jpeg_quality,
                        webp_quality,
                    )
                )
                (target_path / source_path.name).write_bytes(b"prepared")
                return [
                    {
                        "name": source_path.name,
                        "output_size": 8,
                        "width": 120,
                        "height": 80,
                    }
                ]

            with mock.patch.object(prepare_web_photos, "parse_args", return_value=args):
                with mock.patch.object(
                    prepare_web_photos,
                    "optimize_photo_set",
                    side_effect=fake_optimize_set,
                ):
                    result = prepare_web_photos.main()

            self.assertEqual(result, 0)
            self.assertEqual(
                calls,
                [
                    ("A.JPG", (960, 1600, 1800), 70, 60),
                    ("b.webp", (960, 1600, 1800), 70, 60),
                ],
            )
            self.assertTrue((target / "A.JPG").exists())
            self.assertTrue((target / "b.webp").exists())


if __name__ == "__main__":
    unittest.main()
