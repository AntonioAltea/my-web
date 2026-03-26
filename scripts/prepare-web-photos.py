#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from .photo_prepare import PHOTO_EXTENSIONS, optimize_photo
except ImportError:
    from photo_prepare import PHOTO_EXTENSIONS, optimize_photo


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
