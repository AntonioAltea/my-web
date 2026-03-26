#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path


def build_index(root: Path) -> dict[str, int]:
    items: dict[str, int] = {}
    for path in sorted(root.iterdir(), key=lambda item: item.name.lower()):
        if not path.is_file() or path.name == ".gitkeep":
            continue
        items[path.name] = path.stat().st_size
    return items


def read_index(path: Path) -> dict[str, int]:
    items: dict[str, int] = {}
    if not path.exists():
        return items

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or "\t" not in line:
            continue

        name, size = line.split("\t", 1)
        try:
            items[name] = int(size)
        except ValueError:
            continue

    return items


def write_index(index: dict[str, int], out: object = sys.stdout) -> None:
    for name, size in sorted(index.items(), key=lambda item: item[0].lower()):
        print(f"{name}\t{size}", file=out)


def sync_plan(local_files: dict[str, int], remote_files: dict[str, int]) -> tuple[list[str], list[str]]:
    upload_names = sorted(
        name for name, size in local_files.items()
        if remote_files.get(name) != size
    )
    delete_names = sorted(
        name for name in remote_files
        if name not in local_files
    )
    return upload_names, delete_names


def cmd_build_index(args: argparse.Namespace) -> int:
    write_index(build_index(Path(args.directory)))
    return 0


def cmd_normalize_index(args: argparse.Namespace) -> int:
    write_index(read_index(Path(args.index_file)))
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    local_files = read_index(Path(args.local_index))
    remote_files = read_index(Path(args.remote_index))
    upload_names, delete_names = sync_plan(local_files, remote_files)

    Path(args.to_upload).write_text("\n".join(upload_names), encoding="utf-8")
    Path(args.to_delete).write_text("\n".join(delete_names), encoding="utf-8")
    return 0


def cmd_verify(args: argparse.Namespace) -> int:
    local_files = read_index(Path(args.local_index))
    remote_files = read_index(Path(args.remote_index))

    missing_remote = sorted(name for name in local_files if remote_files.get(name) != local_files[name])
    extra_remote = sorted(name for name in remote_files if name not in local_files)

    if not missing_remote and not extra_remote:
        print("Sync verification OK: local prepared files match the remote volume.")
        return 0

    print("Sync verification failed.")
    if missing_remote:
        print("Missing or different on remote:")
        for name in missing_remote[:20]:
            print(name)
        if len(missing_remote) > 20:
            print(f"... ({len(missing_remote)} total)")

    if extra_remote:
        print("Extra on remote:")
        for name in extra_remote[:20]:
            print(name)
        if len(extra_remote) > 20:
            print(f"... ({len(extra_remote)} total)")

    return 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Helpers for media sync index generation and comparison.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    build_index_parser = subparsers.add_parser("build-index")
    build_index_parser.add_argument("directory")
    build_index_parser.set_defaults(func=cmd_build_index)

    normalize_index_parser = subparsers.add_parser("normalize-index")
    normalize_index_parser.add_argument("index_file")
    normalize_index_parser.set_defaults(func=cmd_normalize_index)

    plan_parser = subparsers.add_parser("plan")
    plan_parser.add_argument("local_index")
    plan_parser.add_argument("remote_index")
    plan_parser.add_argument("to_upload")
    plan_parser.add_argument("to_delete")
    plan_parser.set_defaults(func=cmd_plan)

    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("local_index")
    verify_parser.add_argument("remote_index")
    verify_parser.set_defaults(func=cmd_verify)

    return parser.parse_args()


def main() -> int:
    args = parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
