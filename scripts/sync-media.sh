#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <app> <photos|music> <local-path>"
  exit 1
fi

APP_NAME="${APP_NAME:-$1}"
MEDIA_KIND="$2"
LOCAL_PATH="$3"
REMOTE_PATH="/data/${MEDIA_KIND}"
MACHINE_ARGS=()

if [[ -n "${MACHINE_ID:-}" ]]; then
  MACHINE_ARGS=(--machine "$MACHINE_ID")
fi

if [[ "$MEDIA_KIND" != "photos" && "$MEDIA_KIND" != "music" ]]; then
  echo "The second argument must be 'photos' or 'music'."
  exit 1
fi

if [[ ! -d "$LOCAL_PATH" ]]; then
  echo "The local path must be a directory: $LOCAL_PATH"
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

local_index="$tmp_dir/local.tsv"
remote_index="$tmp_dir/remote.tsv"
to_upload="$tmp_dir/upload.tsv"
to_delete="$tmp_dir/delete.txt"
upload_root="$LOCAL_PATH"

if [[ "$MEDIA_KIND" == "photos" ]]; then
  upload_root="$tmp_dir/photos-web"
  echo "Preparing web copies of the photos..."
  python3 scripts/prepare-web-photos.py "$LOCAL_PATH" "$upload_root" >/dev/null
fi

python3 - "$upload_root" > "$local_index" <<'PY'
from pathlib import Path
import sys

root = Path(sys.argv[1])
for path in sorted(p for p in root.iterdir() if p.is_file() and p.name != ".gitkeep"):
    print(f"{path.name}\t{path.stat().st_size}")
PY

fly ssh console -a "$APP_NAME" "${MACHINE_ARGS[@]}" -C "python3 - <<'PY'
from pathlib import Path
root = Path('$REMOTE_PATH')
if root.exists():
    for path in sorted(p for p in root.iterdir() if p.is_file()):
        print(f'{path.name}\t{path.stat().st_size}')
PY" > "$remote_index"

python3 - "$local_index" "$remote_index" "$to_upload" "$to_delete" <<'PY'
from pathlib import Path
import sys

local_index = Path(sys.argv[1])
remote_index = Path(sys.argv[2])
to_upload = Path(sys.argv[3])
to_delete = Path(sys.argv[4])

def read_index(path: Path) -> dict[str, int]:
    items: dict[str, int] = {}
    if not path.exists():
        return items
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        name, size = line.split("\t", 1)
        items[name] = int(size)
    return items

local_files = read_index(local_index)
remote_files = read_index(remote_index)

upload_names = sorted(
    name for name, size in local_files.items()
    if remote_files.get(name) != size
)
delete_names = sorted(name for name in remote_files if name not in local_files)

to_upload.write_text("\n".join(upload_names), encoding="utf-8")
to_delete.write_text("\n".join(delete_names), encoding="utf-8")
PY

delete_count=0
if [[ -s "$to_delete" ]]; then
  mapfile -t delete_names < "$to_delete"
  delete_count="${#delete_names[@]}"
  echo "Deleting ${delete_count} remote files that no longer exist locally..."
  delete_cmd="rm -f --"
  for name in "${delete_names[@]}"; do
    delete_cmd+=" $(printf '%q' "$REMOTE_PATH/$name")"
  done
  fly ssh console -a "$APP_NAME" "${MACHINE_ARGS[@]}" -C "$delete_cmd" >/dev/null
fi

upload_count=0
if [[ -s "$to_upload" ]]; then
  mapfile -t upload_names < "$to_upload"
  upload_count="${#upload_names[@]}"
  echo "Replacing ${upload_count} remote files..."

  replace_cmd="rm -f --"
  for name in "${upload_names[@]}"; do
    replace_cmd+=" $(printf '%q' "$REMOTE_PATH/$name")"
  done
  fly ssh console -a "$APP_NAME" "${MACHINE_ARGS[@]}" -C "$replace_cmd" >/dev/null

  {
    for i in "${!upload_names[@]}"; do
      name="${upload_names[$i]}"
      printf '[%s/%s] %s\n' "$((i + 1))" "${upload_count}" "$name" >&2
      printf 'put %s %s/%s\n' "$upload_root/$name" "$REMOTE_PATH" "$name"
    done
  } | fly ssh sftp shell -a "$APP_NAME" "${MACHINE_ARGS[@]}" >/dev/null
fi

echo "${MEDIA_KIND} sync:"
echo "- deleted remotely: ${delete_count}"
echo "- uploaded or updated: ${upload_count}"
