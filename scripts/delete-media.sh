#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Usage: $0 <app> <photos|music> <file-name>"
  exit 1
fi

APP_NAME="$1"
MEDIA_KIND="$2"
FILE_NAME="$(basename "$3")"
MACHINE_ARGS=()

if [[ -n "${MACHINE_ID:-}" ]]; then
  MACHINE_ARGS=(--machine "$MACHINE_ID")
fi

if [[ "$MEDIA_KIND" != "photos" && "$MEDIA_KIND" != "music" ]]; then
  echo "The second argument must be 'photos' or 'music'."
  exit 1
fi

fly ssh console -a "$APP_NAME" "${MACHINE_ARGS[@]}" -C "sh -lc 'rm -f /data/${MEDIA_KIND}/${FILE_NAME} && ls /data/${MEDIA_KIND} | tail -n 5'"
