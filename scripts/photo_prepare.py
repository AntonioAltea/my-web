from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError


PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
PREPARE_VERSION = 1
RESAMPLE_LANCZOS = getattr(getattr(Image, "Resampling", Image), "LANCZOS")


def resize_image(image: Image.Image, max_dim: int) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    width, height = image.size
    longest = max(width, height)
    if longest <= max_dim:
        return image

    scale = max_dim / longest
    next_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return image.resize(next_size, RESAMPLE_LANCZOS)


def optimize_photo(source: Path, target: Path, max_dim: int, jpeg_quality: int, webp_quality: int) -> None:
    suffix = source.suffix.lower()

    if suffix in {".gif", ".avif"}:
        shutil.copy2(source, target)
        return

    try:
        with Image.open(source) as image:
            image = resize_image(image, max_dim)

            if suffix in {".jpg", ".jpeg"}:
                if image.mode not in {"RGB", "L"}:
                    image = image.convert("RGB")
                image.save(
                    target,
                    quality=jpeg_quality,
                    optimize=True,
                    progressive=True,
                )
                return

            if suffix == ".webp":
                if image.mode not in {"RGB", "RGBA"}:
                    image = image.convert("RGB")
                image.save(
                    target,
                    format="WEBP",
                    quality=webp_quality,
                    method=6,
                )
                return

            if suffix == ".png":
                image.save(target, optimize=True)
                return

    except (OSError, UnidentifiedImageError):
        shutil.copy2(source, target)
        return

    shutil.copy2(source, target)
