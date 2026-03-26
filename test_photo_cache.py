from __future__ import annotations

import tempfile
import unittest
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
    def test_build_photo_cache_reuses_unchanged_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source"
            cache_dir = root / "cache"
            manifest = root / "manifest.json"
            source.mkdir()
            (source / "frame.jpg").write_bytes(b"original")
            args = make_args(source, cache_dir, manifest)

            with mock.patch.object(
                photo_cache,
                "optimize_photo",
                side_effect=lambda src, target, **_: Path(target).write_bytes(b"prepared"),
            ) as optimize_mock:
                index, stats = photo_cache.build_photo_cache(args)

            self.assertEqual(index, {"frame.jpg": len(b"prepared")})
            self.assertEqual(stats, {"reused": 0, "regenerated": 1, "removed": 0})
            optimize_mock.assert_called_once()

            with mock.patch.object(photo_cache, "optimize_photo") as optimize_mock:
                index, stats = photo_cache.build_photo_cache(args)

            self.assertEqual(index, {"frame.jpg": len(b"prepared")})
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

            with mock.patch.object(
                photo_cache,
                "optimize_photo",
                side_effect=lambda src, target, **_: Path(target).write_bytes(b"prepared"),
            ):
                photo_cache.build_photo_cache(args)

            file_path.unlink()

            with mock.patch.object(photo_cache, "optimize_photo") as optimize_mock:
                index, stats = photo_cache.build_photo_cache(args)

            self.assertEqual(index, {})
            self.assertEqual(stats, {"reused": 0, "regenerated": 0, "removed": 1})
            self.assertFalse((cache_dir / "old.jpg").exists())
            optimize_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
