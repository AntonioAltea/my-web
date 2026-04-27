#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

try:
    from .photo_prepare import (
        PHOTO_EXTENSIONS,
        PHOTO_MANIFEST_NAME,
        PHOTO_VARIANT_MAX_DIMS,
        PREPARE_VERSION,
        optimize_photo_set,
    )
except ImportError:
    from photo_prepare import (
        PHOTO_EXTENSIONS,
        PHOTO_MANIFEST_NAME,
        PHOTO_VARIANT_MAX_DIMS,
        PREPARE_VERSION,
        optimize_photo_set,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build and reuse a persistent cache of web-ready photos."
    )
    parser.add_argument("source")
    parser.add_argument("cache_dir")
    parser.add_argument("manifest")
    parser.add_argument("--max-dim", type=int, default=PHOTO_VARIANT_MAX_DIMS[-1])
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


def output_names(entry: dict) -> set[str]:
    outputs = entry.get("outputs", [])
    if not isinstance(outputs, list):
        return set()

    names = set()
    for output in outputs:
        if not isinstance(output, dict):
            continue
        name = output.get("name")
        if isinstance(name, str) and name:
            names.add(name)
    return names


def public_manifest_payload(files: dict[str, dict]) -> dict[str, object]:
    photos: dict[str, dict[str, object]] = {}

    for file_name, entry in sorted(files.items(), key=lambda item: item[0].lower()):
        source = entry.get("source", {})
        outputs = entry.get("outputs", [])
        if not isinstance(source, dict) or not isinstance(outputs, list):
            continue

        version = f"{source.get('mtime_ns', 0)}-{source.get('size', 0)}"
        candidates = []
        for output in outputs:
            if not isinstance(output, dict):
                continue
            name = output.get("name")
            width = output.get("width")
            if not isinstance(name, str) or not name:
                continue
            candidate: dict[str, object] = {"name": name}
            if isinstance(width, int) and width > 0:
                candidate["width"] = width
            candidates.append(candidate)

        if not candidates:
            continue

        photos[file_name] = {
            "sources": candidates,
            "version": version,
        }

    return {
        "schema_version": 1,
        "photos": photos,
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
        for output_name in output_names(previous_files.get(stale_name, {})):
            stale_path = cache_dir / output_name
            if stale_path.exists():
                stale_path.unlink()
        stats["removed"] += 1

    for index, source in enumerate(photo_sources, start=1):
        signature = file_signature(source)
        previous_entry = previous_files.get(source.name, {})
        previous_outputs = output_names(previous_entry)
        can_reuse = (
            not settings_changed
            and previous_entry.get("source") == signature
            and previous_outputs
            and all(
                (cache_dir / output_name).exists() for output_name in previous_outputs
            )
        )

        if can_reuse:
            outputs = previous_entry.get("outputs", [])
            stats["reused"] += 1
        else:
            outputs = optimize_photo_set(
                source,
                cache_dir,
                max_dims=tuple(
                    dim for dim in PHOTO_VARIANT_MAX_DIMS if dim < args.max_dim
                )
                + (args.max_dim,),
                jpeg_quality=args.jpeg_quality,
                webp_quality=args.webp_quality,
            )
            current_output_names = {str(output["name"]) for output in outputs}
            for stale_output_name in previous_outputs - current_output_names:
                stale_path = cache_dir / stale_output_name
                if stale_path.exists():
                    stale_path.unlink()
            stats["regenerated"] += 1

        if total <= 12 or index == total or index % 25 == 0 or not can_reuse:
            action = "reuse" if can_reuse else "regenerate"
            print(
                f"[cache {index}/{total}] {action} {source.name}",
                file=os.sys.stderr,
            )

        next_files[source.name] = {
            "outputs": outputs,
            "source": signature,
        }
        for output in outputs:
            output_name = str(output["name"])
            output_index[output_name] = int(output["output_size"])

    public_manifest_path = cache_dir / PHOTO_MANIFEST_NAME
    public_manifest = public_manifest_payload(next_files)
    save_manifest(public_manifest_path, public_manifest)
    output_index[PHOTO_MANIFEST_NAME] = public_manifest_path.stat().st_size

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
