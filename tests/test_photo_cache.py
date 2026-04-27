from __future__ import annotations

import tempfile
import unittest
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from scripts import photo_cache


def make_args(source: Path, cache_dir: Path, manifest: Path) -> SimpleNamespace:
    return SimpleNamespace(
        source=str(source),
        cache_dir=str(cache_dir),
        manifest=str(manifest),
        max_dim=2200,
        jpeg_quality=82,
        webp_quality=80,
    )


class PhotoCacheTests(unittest.TestCase):
    @staticmethod
    def fake_outputs(base_name: str) -> list[dict[str, int | str]]:
        stem = Path(base_name).stem
        suffix = Path(base_name).suffix
        return [
            {
                "height": 540,
                "max_dim": 960,
                "name": f"{stem}--w960{suffix}",
                "output_size": len(b"small"),
                "width": 960,
            },
            {
                "height": 900,
                "max_dim": 2200,
                "name": base_name,
                "output_size": len(b"base"),
                "width": 1600,
            },
        ]

    def test_parse_args_accepts_custom_values(self) -> None:
        with mock.patch(
            "sys.argv",
            [
                "photo_cache.py",
                "photos",
                "cache",
                "manifest.json",
                "--max-dim",
                "1800",
                "--jpeg-quality",
                "70",
                "--webp-quality",
                "65",
            ],
        ):
            args = photo_cache.parse_args()

        self.assertEqual(args.source, "photos")
        self.assertEqual(args.cache_dir, "cache")
        self.assertEqual(args.manifest, "manifest.json")
        self.assertEqual(args.max_dim, 1800)
        self.assertEqual(args.jpeg_quality, 70)
        self.assertEqual(args.webp_quality, 65)

    def test_load_manifest_returns_empty_payload_for_missing_invalid_and_wrong_shape(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            missing = root / "missing.json"
            self.assertEqual(
                photo_cache.load_manifest(missing), {"settings": {}, "files": {}}
            )

            broken = root / "broken.json"
            broken.write_text("{not json", encoding="utf-8")
            self.assertEqual(
                photo_cache.load_manifest(broken), {"settings": {}, "files": {}}
            )

            wrong_shape = root / "wrong-shape.json"
            wrong_shape.write_text('{"settings": [], "files": "bad"}', encoding="utf-8")
            self.assertEqual(
                photo_cache.load_manifest(wrong_shape), {"settings": {}, "files": {}}
            )

    def test_save_manifest_writes_pretty_json(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "nested" / "manifest.json"

            photo_cache.save_manifest(
                path, {"settings": {"b": 2}, "files": {"a.jpg": {"size": 1}}}
            )

            saved = path.read_text(encoding="utf-8")

        self.assertTrue(saved.endswith("\n"))
        self.assertIn('\n  "files": {', saved)

    def test_file_signature_and_current_settings_return_expected_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "frame.jpg"
            path.write_bytes(b"abc")

            signature = photo_cache.file_signature(path)

        self.assertEqual(signature["size"], 3)
        self.assertIn("mtime_ns", signature)
        self.assertEqual(
            photo_cache.current_settings(
                SimpleNamespace(max_dim=1800, jpeg_quality=70, webp_quality=65)
            ),
            {
                "prepare_version": photo_cache.PREPARE_VERSION,
                "max_dim": 1800,
                "jpeg_quality": 70,
                "webp_quality": 65,
            },
        )

    def test_build_photo_cache_reuses_unchanged_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source"
            cache_dir = root / "cache"
            manifest = root / "manifest.json"
            source.mkdir()
            (source / "frame.jpg").write_bytes(b"original")
            args = make_args(source, cache_dir, manifest)

            def write_outputs(
                src: Path, target_dir: Path, **_: object
            ) -> list[dict[str, int | str]]:
                (target_dir / f"{src.stem}--w960{src.suffix}").write_bytes(b"small")
                (target_dir / src.name).write_bytes(b"base")
                return self.fake_outputs(src.name)

            with mock.patch.object(
                photo_cache,
                "optimize_photo_set",
                side_effect=write_outputs,
            ) as optimize_mock:
                index, stats = photo_cache.build_photo_cache(args)

            self.assertEqual(
                index,
                {
                    ".photo-manifest.json": (cache_dir / ".photo-manifest.json")
                    .stat()
                    .st_size,
                    "frame--w960.jpg": len(b"small"),
                    "frame.jpg": len(b"base"),
                },
            )
            self.assertEqual(stats, {"reused": 0, "regenerated": 1, "removed": 0})
            optimize_mock.assert_called_once()

            with mock.patch.object(photo_cache, "optimize_photo_set") as optimize_mock:
                index, stats = photo_cache.build_photo_cache(args)

            self.assertEqual(
                index,
                {
                    ".photo-manifest.json": (cache_dir / ".photo-manifest.json")
                    .stat()
                    .st_size,
                    "frame--w960.jpg": len(b"small"),
                    "frame.jpg": len(b"base"),
                },
            )
            self.assertEqual(stats, {"reused": 1, "regenerated": 0, "removed": 0})
            optimize_mock.assert_not_called()

    def test_build_photo_cache_removes_stale_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source"
            cache_dir = root / "cache"
            manifest = root / "manifest.json"
            source.mkdir()
            file_path = source / "old.jpg"
            file_path.write_bytes(b"original")
            args = make_args(source, cache_dir, manifest)

            def write_outputs(
                src: Path, target_dir: Path, **_: object
            ) -> list[dict[str, int | str]]:
                (target_dir / f"{src.stem}--w960{src.suffix}").write_bytes(b"small")
                (target_dir / src.name).write_bytes(b"base")
                return self.fake_outputs(src.name)

            with mock.patch.object(
                photo_cache,
                "optimize_photo_set",
                side_effect=write_outputs,
            ):
                photo_cache.build_photo_cache(args)

            file_path.unlink()

            with mock.patch.object(photo_cache, "optimize_photo_set") as optimize_mock:
                index, stats = photo_cache.build_photo_cache(args)

            self.assertEqual(
                index,
                {
                    ".photo-manifest.json": (cache_dir / ".photo-manifest.json")
                    .stat()
                    .st_size
                },
            )
            self.assertEqual(stats, {"reused": 0, "regenerated": 0, "removed": 1})
            self.assertFalse((cache_dir / "old.jpg").exists())
            self.assertFalse((cache_dir / "old--w960.jpg").exists())
            optimize_mock.assert_not_called()

    def test_build_photo_cache_cleans_temp_file_when_optimization_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source"
            cache_dir = root / "cache"
            manifest = root / "manifest.json"
            source.mkdir()
            (source / "frame.jpg").write_bytes(b"original")
            args = make_args(source, cache_dir, manifest)

            def fail_to_prepare(
                _src: Path, _target_dir: Path, **_: object
            ) -> list[dict[str, int | str]]:
                raise RuntimeError("boom")

            with mock.patch.object(
                photo_cache, "optimize_photo_set", side_effect=fail_to_prepare
            ):
                with self.assertRaises(RuntimeError):
                    photo_cache.build_photo_cache(args)

            self.assertEqual(list(cache_dir.iterdir()), [])

    def test_write_index_sorts_output_case_insensitively(self) -> None:
        with mock.patch("sys.stdout", new=StringIO()) as stdout:
            photo_cache.write_index({"zeta.jpg": 3, "Alpha.jpg": 1, "beta.jpg": 2})

        self.assertEqual(stdout.getvalue(), "Alpha.jpg\t1\nbeta.jpg\t2\nzeta.jpg\t3\n")

    def test_main_prints_summary_and_index(self) -> None:
        args = SimpleNamespace(
            source="photos", cache_dir="cache", manifest="manifest.json"
        )

        with mock.patch.object(photo_cache, "parse_args", return_value=args):
            with mock.patch.object(
                photo_cache,
                "build_photo_cache",
                return_value=(
                    {"frame.jpg": 4},
                    {"reused": 1, "regenerated": 2, "removed": 3},
                ),
            ) as build_mock:
                with mock.patch.object(photo_cache, "write_index") as write_index_mock:
                    with mock.patch("builtins.print") as print_mock:
                        result = photo_cache.main()

        self.assertEqual(result, 0)
        build_mock.assert_called_once_with(args)
        write_index_mock.assert_called_once_with({"frame.jpg": 4})
        self.assertIn(
            "Photo cache ready: reused 1, regenerated 2, removed 3.",
            print_mock.call_args_list[0].args[0],
        )

    def test_public_manifest_payload_lists_responsive_sources(self) -> None:
        payload = photo_cache.public_manifest_payload(
            {
                "frame.jpg": {
                    "outputs": self.fake_outputs("frame.jpg"),
                    "source": {"mtime_ns": 12, "size": 34},
                }
            }
        )

        self.assertEqual(payload["schema_version"], 1)
        self.assertEqual(payload["photos"]["frame.jpg"]["version"], "12-34")
        self.assertEqual(
            payload["photos"]["frame.jpg"]["sources"],
            [
                {"name": "frame--w960.jpg", "width": 960},
                {"name": "frame.jpg", "width": 1600},
            ],
        )


if __name__ == "__main__":
    unittest.main()
