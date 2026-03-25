#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from PIL import Image, UnidentifiedImageError


PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Load all photos and remove the ones that cannot be read."
    )
    parser.add_argument(
        "directory",
        nargs="?",
        default="assets/photos",
        help="Photo directory. Default: assets/photos",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only show what would be deleted, without deleting anything.",
    )
    return parser.parse_args()


def pillow_loads(path: Path) -> bool:
    try:
        with Image.open(path) as image:
            image.load()
        return True
    except (OSError, UnidentifiedImageError):
        return False


def identify_loads(path: Path) -> bool:
    result = subprocess.run(
        ["identify", str(path)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return result.returncode == 0


def can_load(path: Path) -> bool:
    return pillow_loads(path) or identify_loads(path)


def main() -> int:
    args = parse_args()
    directory = Path(args.directory).resolve()

    if not directory.exists():
        print(f"Directory does not exist: {directory}")
        return 1

    photo_paths = sorted(
        path for path in directory.iterdir()
        if path.is_file() and path.suffix.lower() in PHOTO_EXTENSIONS
    )

    if not photo_paths:
        print(f"There are no photos in {directory}")
        return 0

    broken = []

    for path in photo_paths:
        if can_load(path):
            print(f"OK     {path.name}")
            continue
        broken.append(path)
        print(f"DELETE {path.name}")

    if not broken:
        print(f"All good. Checked: {len(photo_paths)}")
        return 0

    if args.dry_run:
        print(f"Detected {len(broken)} broken photos. Nothing was deleted.")
        return 0

    for path in broken:
        path.unlink(missing_ok=True)

    print(f"Deleted {len(broken)} broken photos out of {len(photo_paths)} checked.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
