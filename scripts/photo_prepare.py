from __future__ import annotations

import re
import shutil
import tempfile
import os
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError


PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
PHOTO_VARIANT_MAX_DIMS = (960, 1600, 2200)
PHOTO_MANIFEST_NAME = ".photo-manifest.json"
PREPARE_VERSION = 2
PHOTO_VARIANT_PATTERN = re.compile(r"^(?P<stem>.+)--w(?P<max_dim>\d+)$")
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


def photo_variant_name(file_name: str, max_dim: int) -> str:
    path = Path(file_name)
    return f"{path.stem}--w{max_dim}{path.suffix}"


def is_photo_variant_name(file_name: str) -> bool:
    return PHOTO_VARIANT_PATTERN.match(Path(file_name).stem) is not None


def optimize_photo(
    source: Path, target: Path, max_dim: int, jpeg_quality: int, webp_quality: int
) -> None:
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


def output_dimensions(path: Path) -> tuple[int | None, int | None]:
    try:
        with Image.open(path) as image:
            image = ImageOps.exif_transpose(image)
            return image.size
    except (OSError, UnidentifiedImageError):
        return None, None


def optimize_photo_set(
    source: Path,
    target_dir: Path,
    *,
    max_dims: tuple[int, ...] = PHOTO_VARIANT_MAX_DIMS,
    jpeg_quality: int,
    webp_quality: int,
) -> list[dict[str, int | str]]:
    target_dir.mkdir(parents=True, exist_ok=True)

    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image)
            longest_side = max(image.size)
    except (OSError, UnidentifiedImageError):
        longest_side = None

    largest_max_dim = max_dims[-1]
    candidate_max_dims = [
        max_dim for max_dim in max_dims[:-1] if longest_side and longest_side > max_dim
    ]
    candidate_max_dims.append(largest_max_dim)

    outputs: list[dict[str, int | str]] = []
    for max_dim in candidate_max_dims:
        target_name = (
            source.name
            if max_dim == largest_max_dim
            else photo_variant_name(source.name, max_dim)
        )
        target_path = target_dir / target_name
        fd, temp_path_str = tempfile.mkstemp(
            prefix=f"{source.stem}-",
            suffix=source.suffix,
            dir=target_dir,
        )
        os.close(fd)
        temp_path = Path(temp_path_str)
        try:
            optimize_photo(
                source,
                temp_path,
                max_dim=max_dim,
                jpeg_quality=jpeg_quality,
                webp_quality=webp_quality,
            )
            temp_path.replace(target_path)
        finally:
            if temp_path.exists():
                temp_path.unlink()
        width, height = output_dimensions(target_path)
        outputs.append(
            {
                "height": height or 0,
                "max_dim": max_dim,
                "name": target_name,
                "output_size": target_path.stat().st_size,
                "width": width or 0,
            }
        )

    outputs.sort(key=lambda item: (int(item["width"]), str(item["name"]).lower()))
    return outputs
