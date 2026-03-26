#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

try:
    from .photo_prepare import PHOTO_EXTENSIONS, PREPARE_VERSION, optimize_photo
except ImportError:
    from photo_prepare import PHOTO_EXTENSIONS, PREPARE_VERSION, optimize_photo


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build and reuse a persistent cache of web-ready photos."
    )
    parser.add_argument("source")
    parser.add_argument("cache_dir")
    parser.add_argument("manifest")
    parser.add_argument("--max-dim", type=int, default=2200)
    parser.add_argument("--jpeg-quality", type=int, default=82)
    parser.add_argument("--webp-quality", type=int, default=80)
    return parser.parse_args()


def load_manifest(path: Path) -> dict:
    if not path.exists():
        return {"settings": {}, "files": {}}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"settings": {}, "files": {}}

    settings = data.get("settings")
    files = data.get("files")
    if not isinstance(settings, dict) or not isinstance(files, dict):
        return {"settings": {}, "files": {}}
    return {"settings": settings, "files": files}


def save_manifest(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def file_signature(path: Path) -> dict[str, int]:
    stat = path.stat()
    return {
        "size": stat.st_size,
        "mtime_ns": stat.st_mtime_ns,
    }


def current_settings(args: argparse.Namespace) -> dict[str, int]:
    return {
        "prepare_version": PREPARE_VERSION,
        "max_dim": args.max_dim,
        "jpeg_quality": args.jpeg_quality,
        "webp_quality": args.webp_quality,
    }


def build_photo_cache(
    args: argparse.Namespace,
) -> tuple[dict[str, int], dict[str, int]]:
    source_dir = Path(args.source).resolve()
    cache_dir = Path(args.cache_dir).resolve()
    manifest_path = Path(args.manifest).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)

    photo_sources = [
        source
        for source in sorted(source_dir.iterdir(), key=lambda item: item.name.lower())
        if source.is_file()
        and source.name != ".gitkeep"
        and source.suffix.lower() in PHOTO_EXTENSIONS
    ]

    manifest = load_manifest(manifest_path)
    settings = current_settings(args)
    settings_changed = manifest.get("settings") != settings
    previous_files = manifest.get("files", {})

    next_files: dict[str, dict] = {}
    output_index: dict[str, int] = {}
    stats = {"reused": 0, "regenerated": 0, "removed": 0}
    source_names = {source.name for source in photo_sources}
    total = len(photo_sources)

    for stale_name in sorted(set(previous_files) - source_names):
        stale_path = cache_dir / stale_name
        if stale_path.exists():
            stale_path.unlink()
        stats["removed"] += 1

    for index, source in enumerate(photo_sources, start=1):
        signature = file_signature(source)
        target = cache_dir / source.name
        previous_entry = previous_files.get(source.name, {})
        can_reuse = (
            not settings_changed
            and previous_entry.get("source") == signature
            and target.exists()
        )

        if can_reuse:
            stats["reused"] += 1
        else:
            fd, temp_path_str = tempfile.mkstemp(
                prefix=f"{source.stem}-", suffix=source.suffix, dir=cache_dir
            )
            os.close(fd)
            temp_path = Path(temp_path_str)
            try:
                optimize_photo(
                    source,
                    temp_path,
                    max_dim=args.max_dim,
                    jpeg_quality=args.jpeg_quality,
                    webp_quality=args.webp_quality,
                )
                temp_path.replace(target)
            finally:
                if temp_path.exists():
                    temp_path.unlink()
            stats["regenerated"] += 1

        if total <= 12 or index == total or index % 25 == 0 or not can_reuse:
            action = "reuse" if can_reuse else "regenerate"
            print(
                f"[cache {index}/{total}] {action} {source.name}",
                file=os.sys.stderr,
            )

        output_size = target.stat().st_size
        output_index[source.name] = output_size
        next_files[source.name] = {
            "source": signature,
            "output_size": output_size,
        }

    save_manifest(
        manifest_path,
        {
            "settings": settings,
            "files": next_files,
        },
    )
    return output_index, stats


def write_index(index: dict[str, int]) -> None:
    for name, size in sorted(index.items(), key=lambda item: item[0].lower()):
        print(f"{name}\t{size}")


def main() -> int:
    args = parse_args()
    index, stats = build_photo_cache(args)
    print(
        f"Photo cache ready: reused {stats['reused']}, regenerated {stats['regenerated']}, removed {stats['removed']}.",
        file=os.sys.stderr,
    )
    write_index(index)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
