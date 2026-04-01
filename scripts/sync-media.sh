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
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

sftp_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

log_phase() {
  echo
  echo "==> $1"
}

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
  cache_root="${PHOTO_SYNC_CACHE_DIR:-$ROOT_DIR/.cache/photo-sync}"
  cache_manifest="${PHOTO_SYNC_CACHE_MANIFEST:-$cache_root/manifest.json}"
  upload_root="$cache_root/files"
  mkdir -p "$upload_root"
  log_phase "Refreshing the photo cache"
  python3 "$ROOT_DIR/scripts/photo_cache.py" "$LOCAL_PATH" "$upload_root" "$cache_manifest" > "$local_index"
else
  log_phase "Indexing local files"
  python3 "$ROOT_DIR/scripts/media_sync_index.py" build-index "$upload_root" > "$local_index"
fi

remote_raw="$tmp_dir/remote-raw.txt"
log_phase "Reading the remote volume index"
fly ssh console -a "$APP_NAME" "${MACHINE_ARGS[@]}" -C "python3 -c \"from pathlib import Path; root = Path('$REMOTE_PATH'); root.exists() and [print(path.name, path.stat().st_size, sep=chr(9)) for path in sorted(p for p in root.iterdir() if p.is_file())]\"" > "$remote_raw"
python3 "$ROOT_DIR/scripts/media_sync_index.py" normalize-index "$remote_raw" > "$remote_index"
python3 "$ROOT_DIR/scripts/media_sync_index.py" plan "$local_index" "$remote_index" "$to_upload" "$to_delete"
echo "Planned changes ready."

delete_count=0
if [[ -s "$to_delete" ]]; then
  mapfile -t delete_names < "$to_delete"
  delete_count="${#delete_names[@]}"
  log_phase "Deleting ${delete_count} remote files that no longer exist locally"
  delete_cmd="rm -f --"
  for name in "${delete_names[@]}"; do
    delete_cmd+=" $(printf '%q' "$REMOTE_PATH/$name")"
  done
  fly ssh console -a "$APP_NAME" "${MACHINE_ARGS[@]}" -C "$delete_cmd" >/dev/null
else
  echo "No remote deletions needed."
fi

upload_count=0
if [[ -s "$to_upload" ]]; then
  mapfile -t upload_names < "$to_upload"
  upload_count="${#upload_names[@]}"
  log_phase "Uploading ${upload_count} new or changed files"

  replace_cmd="rm -f --"
  for name in "${upload_names[@]}"; do
    replace_cmd+=" $(printf '%q' "$REMOTE_PATH/$name")"
  done
  fly ssh console -a "$APP_NAME" "${MACHINE_ARGS[@]}" -C "$replace_cmd" >/dev/null

  {
    for i in "${!upload_names[@]}"; do
      name="${upload_names[$i]}"
      printf '[upload %s/%s] %s\n' "$((i + 1))" "${upload_count}" "$name" >&2
      printf 'put %s %s\n' \
        "$(sftp_quote "$upload_root/$name")" \
        "$(sftp_quote "$REMOTE_PATH/$name")"
    done
  } | fly ssh sftp shell -a "$APP_NAME" "${MACHINE_ARGS[@]}" >/dev/null
else
  echo "No uploads needed."
fi

log_phase "Sync summary"
echo "${MEDIA_KIND} sync:"
echo "- deleted remotely: ${delete_count}"
echo "- uploaded or updated: ${upload_count}"

verified_remote_raw="$tmp_dir/remote-verified-raw.txt"
verified_remote_index="$tmp_dir/remote-verified.tsv"
log_phase "Verifying that the remote volume matches the local prepared set"
fly ssh console -a "$APP_NAME" "${MACHINE_ARGS[@]}" -C "python3 -c \"from pathlib import Path; root = Path('$REMOTE_PATH'); root.exists() and [print(path.name, path.stat().st_size, sep=chr(9)) for path in sorted(p for p in root.iterdir() if p.is_file())]\"" > "$verified_remote_raw"
python3 "$ROOT_DIR/scripts/media_sync_index.py" normalize-index "$verified_remote_raw" > "$verified_remote_index"
python3 "$ROOT_DIR/scripts/media_sync_index.py" verify "$local_index" "$verified_remote_index"
