#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Uso: $0 <app> <photos|music> <nombre-de-fichero>"
  exit 1
fi

APP_NAME="$1"
MEDIA_KIND="$2"
FILE_NAME="$(basename "$3")"

if [[ "$MEDIA_KIND" != "photos" && "$MEDIA_KIND" != "music" ]]; then
  echo "El segundo argumento debe ser 'photos' o 'music'."
  exit 1
fi

fly ssh console -a "$APP_NAME" -C "sh -lc 'rm -f /data/${MEDIA_KIND}/${FILE_NAME} && ls /data/${MEDIA_KIND} | tail -n 5'"
