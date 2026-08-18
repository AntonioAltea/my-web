#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

try:
    from .zine_prepare import prepare_zine_set, save_zine_manifest
except ImportError:
    from zine_prepare import prepare_zine_set, save_zine_manifest


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = PROJECT_ROOT / "src" / "static" / "data" / "zines.json"
DEFAULT_TARGET = PROJECT_ROOT / "assets" / "zines"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Slice one-sheet zine PDFs into web page images."
    )
    parser.add_argument("source", help="Directory holding the zine PDFs.")
    parser.add_argument("target", nargs="?", default=str(DEFAULT_TARGET))
    parser.add_argument("--config", default=str(DEFAULT_CONFIG))
    parser.add_argument("--jpeg-quality", type=int, default=82)
    return parser.parse_args()


def load_entries(config_path: Path) -> list[dict[str, object]]:
    entries = json.loads(config_path.read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise ValueError(f"{config_path} must hold a list of zines")
    return entries


def main() -> int:
    args = parse_args()
    source_root = Path(args.source).resolve()
    target_root = Path(args.target).resolve()
    config_path = Path(args.config).resolve()

    if not source_root.exists():
        print(f"Source directory does not exist: {source_root}", file=sys.stderr)
        return 1

    if not config_path.exists():
        print(f"Zine list does not exist: {config_path}", file=sys.stderr)
        return 1

    entries = load_entries(config_path)
    if not entries:
        print("There are no zines to prepare.", file=sys.stderr)
        return 0

    payload = prepare_zine_set(
        entries,
        source_root,
        target_root,
        jpeg_quality=args.jpeg_quality,
    )

    for zine in payload["zines"]:
        print(f"{zine['slug']}: {len(zine['pages'])} pages")

    manifest_path = save_zine_manifest(target_root, payload)
    print(f"Manifest written to {manifest_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
