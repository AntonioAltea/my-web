#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Uso: $0 <app> <photos|music> <ruta-local>"
  exit 1
fi

APP_NAME="$1"
MEDIA_KIND="$2"
LOCAL_PATH="$3"

if [[ "$MEDIA_KIND" != "photos" && "$MEDIA_KIND" != "music" ]]; then
  echo "El segundo argumento debe ser 'photos' o 'music'."
  exit 1
fi

REMOTE_PATH="/data/${MEDIA_KIND}"

fly ssh sftp put "$LOCAL_PATH" "$REMOTE_PATH" --app "$APP_NAME" --recursive
