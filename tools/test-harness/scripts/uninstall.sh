#!/bin/bash
#
# Uninstall dummy OpenClaw
#
# Usage: ./uninstall.sh [--git-clone /path/to/clone]
#

set -e

# Parse arguments
GIT_CLONE_PATH=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --git-clone)
      GIT_CLONE_PATH="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

echo "Uninstalling dummy OpenClaw..."

# Unlink npm global
echo "Removing npm global link..."
npm unlink -g dummy-openclaw 2>/dev/null || echo "  (not installed as npm global)"

# Remove git clone if specified
if [ -n "$GIT_CLONE_PATH" ]; then
  echo "Removing git clone at $GIT_CLONE_PATH..."
  if [ -d "$GIT_CLONE_PATH" ]; then
    rm -rf "$GIT_CLONE_PATH"
    echo "  Removed $GIT_CLONE_PATH"
  else
    echo "  (directory not found)"
  fi
fi

echo ""
echo "Done!"
