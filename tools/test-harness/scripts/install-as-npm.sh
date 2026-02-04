#!/bin/bash
#
# Install dummy OpenClaw as if it were an npm global package
# This simulates: npm install -g openclaw
#
# Usage: ./install-as-npm.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="$(dirname "$SCRIPT_DIR")"

echo "Installing dummy OpenClaw as npm global package..."
echo "Directory: $HARNESS_DIR"
echo ""

# Install dependencies first
cd "$HARNESS_DIR"
npm install

# Create global link
npm link

echo ""
echo "Done! You can now use 'openclaw' command globally."
echo ""
echo "Test with:"
echo "  openclaw --version"
echo "  openclaw status"
echo "  openclaw run --test-network"
echo ""
echo "To uninstall:"
echo "  npm unlink -g dummy-openclaw"
