from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image

from scripts import photo_prepare


class PhotoPrepareTests(unittest.TestCase):
    def test_resize_image_keeps_small_image_size(self) -> None:
        image = Image.new("RGB", (640, 480), color=(20, 30, 40))

        resized = photo_prepare.resize_image(image, 1000)

        self.assertEqual(resized.size, (640, 480))

    def test_resize_image_scales_down_longest_side(self) -> None:
        image = Image.new("RGB", (4000, 2000), color=(20, 30, 40))

        resized = photo_prepare.resize_image(image, 1000)

        self.assertEqual(resized.size, (1000, 500))

    def test_optimize_photo_copies_gif_without_reencoding(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "anim.gif"
            target = root / "copy.gif"
            source.write_bytes(b"GIF89a test")

            photo_prepare.optimize_photo(
                source, target, max_dim=2200, jpeg_quality=82, webp_quality=80
            )

            self.assertEqual(target.read_bytes(), b"GIF89a test")

    def test_optimize_photo_saves_jpeg_as_rgb(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "input.jpg"
            target = root / "output.jpg"
            Image.new("RGB", (120, 80), color=(220, 50, 30)).save(source, format="JPEG")

            photo_prepare.optimize_photo(
                source, target, max_dim=2200, jpeg_quality=82, webp_quality=80
            )

            with Image.open(target) as saved:
                self.assertEqual(saved.mode, "RGB")

    def test_optimize_photo_saves_webp(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "input.webp"
            target = root / "output.webp"
            Image.new("RGB", (120, 80), color=(10, 90, 160)).save(source, format="WEBP")

            photo_prepare.optimize_photo(
                source, target, max_dim=2200, jpeg_quality=82, webp_quality=80
            )

            with Image.open(target) as saved:
                self.assertEqual(saved.format, "WEBP")

    def test_optimize_photo_saves_png(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "input.png"
            target = root / "output.png"
            Image.new("RGBA", (120, 80), color=(10, 90, 160, 180)).save(source)

            photo_prepare.optimize_photo(
                source, target, max_dim=2200, jpeg_quality=82, webp_quality=80
            )

            with Image.open(target) as saved:
                self.assertEqual(saved.format, "PNG")

    def test_optimize_photo_falls_back_to_copy_when_open_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "broken.jpg"
            target = root / "copy.jpg"
            source.write_bytes(b"not an image")

            with mock.patch("scripts.photo_prepare.Image.open", side_effect=OSError):
                photo_prepare.optimize_photo(
                    source, target, max_dim=2200, jpeg_quality=82, webp_quality=80
                )

            self.assertEqual(target.read_bytes(), b"not an image")

    def test_optimize_photo_copies_unknown_extension_after_opening(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            real_source = root / "input.png"
            source = root / "input.bmp"
            target = root / "output.bmp"
            Image.new("RGB", (80, 80), color=(1, 2, 3)).save(real_source)
            source.write_bytes(real_source.read_bytes())

            photo_prepare.optimize_photo(
                source, target, max_dim=2200, jpeg_quality=82, webp_quality=80
            )

            self.assertEqual(target.read_bytes(), source.read_bytes())


if __name__ == "__main__":
    unittest.main()
