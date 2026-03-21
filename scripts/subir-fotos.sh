#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="${APP_NAME:-manturon}"
SOURCE_PATH="${1:-$ROOT_DIR/assets/photos}"

bash "$ROOT_DIR/scripts/upload-media.sh" "$APP_NAME" photos "$SOURCE_PATH"
