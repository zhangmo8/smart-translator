#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
RELEASE_DIR="$ROOT_DIR/release"
ZIP_PATH="$RELEASE_DIR/silence-translator-chrome-web-store.zip"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required but was not found in PATH." >&2
  exit 1
fi

echo "Building Chrome extension..."
npm --prefix "$ROOT_DIR" run build

if [ ! -f "$DIST_DIR/manifest.json" ]; then
  echo "Build output is missing dist/manifest.json." >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"
rm -f "$ZIP_PATH"

# Chrome Web Store uploads expect manifest.json at the ZIP root, so we archive
# the contents of dist/ rather than the dist/ folder itself.
(
  cd "$DIST_DIR"
  zip -qr "$ZIP_PATH" . -x '.DS_Store' '.DS_Store/*' '.vite/*'
)

echo
echo "Chrome Web Store package ready:"
echo "  $ZIP_PATH"
echo
echo "Upload that ZIP file directly in the Chrome Web Store dashboard."
