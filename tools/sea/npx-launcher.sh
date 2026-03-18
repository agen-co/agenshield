#!/bin/sh
# Launcher script for the `agenshield` npm wrapper package.
# Resolves the correct platform-specific binary from optionalDependencies
# and executes it with all arguments forwarded.
#
# Installed as `bin/agenshield` in the wrapper package.

set -e

# Detect platform
case "$(uname -s)" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)      echo "Unsupported platform: $(uname -s)" >&2; exit 1 ;;
esac

case "$(uname -m)" in
  x86_64|amd64)   ARCH="x64" ;;
  aarch64|arm64)   ARCH="arm64" ;;
  *)               echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

PKG="@agenshield/cli-${OS}-${ARCH}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$SCRIPT_DIR/../node_modules/$PKG"

if [ ! -d "$PKG_DIR" ]; then
  echo "Platform package $PKG not found." >&2
  echo "Your platform (${OS}/${ARCH}) may not be supported." >&2
  echo "" >&2
  echo "Supported platforms:" >&2
  echo "  - darwin/arm64  (Apple Silicon)" >&2
  echo "  - darwin/x64    (Intel Mac)" >&2
  echo "  - linux/x64     (Linux x86_64)" >&2
  exit 1
fi

exec "$PKG_DIR/bin/agenshield" "$@"
