#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist-firefox"
RELEASE_DIR="$ROOT_DIR/release"
ZIP_PATH="$RELEASE_DIR/silence-translator-firefox-addons.zip"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required but was not found in PATH." >&2
  exit 1
fi

echo "Building Firefox extension..."
npm --prefix "$ROOT_DIR" run build:firefox

if [ ! -f "$DIST_DIR/manifest.json" ]; then
  echo "Build output is missing dist-firefox/manifest.json." >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"
rm -f "$ZIP_PATH"

# Firefox Add-ons uploads expect manifest.json at the ZIP root, so we archive
# the contents of dist-firefox/ rather than the folder itself.
(
  cd "$DIST_DIR"
  zip -qr "$ZIP_PATH" . -x '.DS_Store' '.DS_Store/*' '.vite/*'
)

echo
echo "Firefox Add-ons package ready:"
echo "  $ZIP_PATH"
echo
echo "Upload that ZIP file directly in the Firefox Add-ons dashboard."
