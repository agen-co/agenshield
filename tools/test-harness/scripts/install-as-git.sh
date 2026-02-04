#!/bin/bash
#
# Install dummy OpenClaw as if it were a git clone
# This simulates: git clone https://github.com/example/openclaw.git
#
# Usage: ./install-as-git.sh [target-directory]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="$(dirname "$SCRIPT_DIR")"
TARGET="${1:-/tmp/openclaw-clone}"

echo "Installing dummy OpenClaw as git clone..."
echo "Source: $HARNESS_DIR"
echo "Target: $TARGET"
echo ""

# Create target directory
mkdir -p "$TARGET"

# Copy files
cp -r "$HARNESS_DIR"/* "$TARGET/"

# Make binary executable
chmod +x "$TARGET/bin/dummy-openclaw.js"

# Install dependencies
cd "$TARGET"
npm install

echo ""
echo "Done! Installed to $TARGET"
echo ""
echo "Test with:"
echo "  $TARGET/bin/dummy-openclaw.js --version"
echo "  $TARGET/bin/dummy-openclaw.js status"
echo "  $TARGET/bin/dummy-openclaw.js run --test-network"
echo ""
echo "Or add to PATH:"
echo "  export PATH=\"$TARGET/bin:\$PATH\""
