#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "Uso: $0 <app> <photos|music> <ruta-local>"
  exit 1
fi

APP_NAME="${APP_NAME:-$1}"
MEDIA_KIND="$2"
LOCAL_PATH="$3"

if [[ "$MEDIA_KIND" != "photos" && "$MEDIA_KIND" != "music" ]]; then
  echo "El segundo argumento debe ser 'photos' o 'music'."
  exit 1
fi

REMOTE_PATH="/data/${MEDIA_KIND}"

if [[ ! -e "$LOCAL_PATH" ]]; then
  echo "La ruta local no existe: $LOCAL_PATH"
  exit 1
fi

if [[ -d "$LOCAL_PATH" ]]; then
  mapfile -t files < <(find "$LOCAL_PATH" -maxdepth 1 -type f ! -name '.gitkeep' | sort)

  if [[ "${#files[@]}" -eq 0 ]]; then
    echo "No hay archivos para subir en: $LOCAL_PATH"
    exit 0
  fi

  {
    for file_path in "${files[@]}"; do
      file_name="$(basename "$file_path")"
      printf 'put %s %s/%s\n' "$file_path" "$REMOTE_PATH" "$file_name"
    done
  } | fly ssh sftp shell -a "$APP_NAME"
else
  file_name="$(basename "$LOCAL_PATH")"
  printf 'put %s %s/%s\n' "$LOCAL_PATH" "$REMOTE_PATH" "$file_name" | fly ssh sftp shell -a "$APP_NAME"
fi
