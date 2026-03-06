#!/bin/bash
# Rebuild the AgenShield.app and update the committed copy in libs/sandbox/macos-app/.
# Run this from the monorepo root after making changes to shield-macos.
set -euo pipefail

echo "Building shield-macos..."
npx nx build shield-macos

SRC="dist/apps/shield-macos/Release/AgenShield.app"
DEST="libs/sandbox/macos-app/AgenShield.app"

if [ ! -d "$SRC" ]; then
  echo "ERROR: Build output not found at $SRC"
  exit 1
fi

rm -rf "$DEST"
cp -R "$SRC" "$DEST"

echo "Updated $DEST"
echo "Remember to commit this change."
