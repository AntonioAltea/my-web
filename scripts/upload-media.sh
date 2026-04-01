#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <app> <photos|music> <local-path>"
  exit 1
fi

APP_NAME="${APP_NAME:-$1}"
MEDIA_KIND="$2"
LOCAL_PATH="$3"
MACHINE_ARGS=()
UPLOAD_PATH="$LOCAL_PATH"
TMP_DIR=""

sftp_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

if [[ -n "${MACHINE_ID:-}" ]]; then
  MACHINE_ARGS=(--machine "$MACHINE_ID")
fi

if [[ "$MEDIA_KIND" != "photos" && "$MEDIA_KIND" != "music" ]]; then
  echo "The second argument must be 'photos' or 'music'."
  exit 1
fi

REMOTE_PATH="/data/${MEDIA_KIND}"

if [[ ! -e "$LOCAL_PATH" ]]; then
  echo "The local path does not exist: $LOCAL_PATH"
  exit 1
fi

if [[ "$MEDIA_KIND" == "photos" ]]; then
  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT
  upload_root="$TMP_DIR/photos-web"

  if [[ -d "$LOCAL_PATH" ]]; then
    echo "Preparing web copies of the photos..."
    python3 scripts/prepare-web-photos.py "$LOCAL_PATH" "$upload_root" >/dev/null
    UPLOAD_PATH="$upload_root"
  else
    echo "Preparing a web copy of the photo..."
    mkdir -p "$upload_root"
    python3 scripts/prepare-web-photos.py "$(dirname "$LOCAL_PATH")" "$upload_root" >/dev/null
    prepared_file="$upload_root/$(basename "$LOCAL_PATH")"
    if [[ ! -f "$prepared_file" ]]; then
      echo "Could not prepare the photo: $LOCAL_PATH"
      exit 1
    fi
    UPLOAD_PATH="$prepared_file"
  fi
fi

if [[ -d "$UPLOAD_PATH" ]]; then
  mapfile -t files < <(find "$UPLOAD_PATH" -maxdepth 1 -type f ! -name '.gitkeep' | sort)

  if [[ "${#files[@]}" -eq 0 ]]; then
    echo "There are no files to upload in: $LOCAL_PATH"
    exit 0
  fi

  {
    for file_path in "${files[@]}"; do
      file_name="$(basename "$file_path")"
      printf 'put %s %s\n' \
        "$(sftp_quote "$file_path")" \
        "$(sftp_quote "$REMOTE_PATH/$file_name")"
    done
  } | fly ssh sftp shell -a "$APP_NAME" "${MACHINE_ARGS[@]}"
else
  file_name="$(basename "$UPLOAD_PATH")"
  printf 'put %s %s\n' \
    "$(sftp_quote "$UPLOAD_PATH")" \
    "$(sftp_quote "$REMOTE_PATH/$file_name")" | fly ssh sftp shell -a "$APP_NAME" "${MACHINE_ARGS[@]}"
fi
