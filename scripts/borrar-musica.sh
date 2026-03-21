#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-manturon}"

if [[ $# -lt 1 ]]; then
  echo "Uso: $0 <nombre-o-ruta-de-pista>"
  exit 1
fi

bash "$ROOT_DIR/scripts/delete-media.sh" "$APP_NAME" music "$1"
