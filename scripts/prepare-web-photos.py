#!/usr/bin/env python3
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError


PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}
RESAMPLE_LANCZOS = getattr(getattr(Image, "Resampling", Image), "LANCZOS")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate optimized web copies from a photo directory."
    )
    parser.add_argument("source")
    parser.add_argument("target")
    parser.add_argument("--max-dim", type=int, default=2200)
    parser.add_argument("--jpeg-quality", type=int, default=82)
    parser.add_argument("--webp-quality", type=int, default=80)
    return parser.parse_args()


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


def main() -> int:
    args = parse_args()
    source_dir = Path(args.source).resolve()
    target_dir = Path(args.target).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)

    if not source_dir.exists():
        print(f"Source directory does not exist: {source_dir}")
        return 1

    photo_sources = [
        source
        for source in sorted(source_dir.iterdir())
        if source.is_file() and source.name != ".gitkeep" and source.suffix.lower() in PHOTO_EXTENSIONS
    ]

    total = len(photo_sources)
    if total == 0:
        print("There are no photos to prepare.", file=sys.stderr)
        return 0

    for index, source in enumerate(photo_sources, start=1):

        target = target_dir / source.name
        optimize_photo(
            source,
            target,
            max_dim=args.max_dim,
            jpeg_quality=args.jpeg_quality,
            webp_quality=args.webp_quality,
        )
        print(f"[{index}/{total}] {source.name}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
