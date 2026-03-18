#!/bin/sh
# Prepare libs/cli/dist/ as an npx-ready SEA package.
#
# After `yarn build:sea`, this script populates libs/cli/dist/ with
# the SEA binaries + assets so `npx agenshield install` runs the
# signed SEA binary directly.
#
# Usage:
#   bash tools/sea/prepare-npm-dist.sh              # local: name=agenshield
#   bash tools/sea/prepare-npm-dist.sh --scope       # CI: name=@agenshield/cli-{platform}-{arch}
#
set -e

SCOPED=false
while [ $# -gt 0 ]; do
  case "$1" in
    --scope) SCOPED=true; shift ;;
    *) shift ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEA_DIR="$REPO_ROOT/dist/sea"
CLI_DIST="$REPO_ROOT/libs/cli/dist"

# Colors
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; DIM='\033[2m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED='' GREEN='' CYAN='' DIM='' BOLD='' RESET=''
fi
info()  { printf "${CYAN}info${RESET}  %s\n" "$1"; }
ok()    { printf "${GREEN}  ok${RESET}  %s\n" "$1"; }
die()   { printf "${RED}error${RESET} %s\n" "$1" >&2; exit 1; }

# Check build output
[ -d "$SEA_DIR" ] || die "dist/sea/ not found. Run: yarn build:sea"
[ -f "$SEA_DIR/VERSION" ] || die "dist/sea/VERSION not found. Build may be incomplete."

VERSION="$(cat "$SEA_DIR/VERSION" | tr -d '[:space:]')"

# Detect platform/arch
OS="$(uname -s)"
case "$OS" in
  Darwin) PLATFORM="darwin" ;;
  Linux)  PLATFORM="linux" ;;
  *)      die "Unsupported OS: $OS" ;;
esac
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)             die "Unsupported arch: $ARCH" ;;
esac

# Use fresh build output from dist/sea/apps/ (not stale extracted archive)
APPS_DIR="$SEA_DIR/apps"
CLI_BIN_DIR="$APPS_DIR/cli-bin"
DAEMON_BIN_DIR="$APPS_DIR/daemon-bin"
BROKER_BIN_DIR="$APPS_DIR/broker-bin"

[ -f "$CLI_BIN_DIR/agenshield" ] || die "CLI binary not found at $CLI_BIN_DIR/agenshield"
[ -f "$DAEMON_BIN_DIR/agenshield-daemon" ] || die "Daemon binary not found"
[ -f "$BROKER_BIN_DIR/agenshield-broker" ] || die "Broker binary not found"

info "Preparing npm dist (v${VERSION}, ${PLATFORM}/${ARCH})"

# Clean and create dist structure (remove Nx build output + old SEA files, keep README/LICENSE/CHANGELOG)
rm -rf "$CLI_DIST/src" "$CLI_DIST/bin" "$CLI_DIST/native" "$CLI_DIST/workers" "$CLI_DIST/interceptor" "$CLI_DIST/client" "$CLI_DIST/ui-assets" "$CLI_DIST/AgenShield.app"
mkdir -p "$CLI_DIST/bin"

# Copy SEA binaries from fresh build output
cp "$CLI_BIN_DIR/agenshield" "$CLI_DIST/bin/agenshield"
chmod 755 "$CLI_DIST/bin/agenshield"
ok "Copied agenshield → dist/bin/"

cp "$DAEMON_BIN_DIR/agenshield-daemon" "$CLI_DIST/bin/agenshield-daemon"
chmod 755 "$CLI_DIST/bin/agenshield-daemon"
ok "Copied agenshield-daemon → dist/bin/"

cp "$BROKER_BIN_DIR/agenshield-broker" "$CLI_DIST/bin/agenshield-broker"
chmod 755 "$CLI_DIST/bin/agenshield-broker"
ok "Copied agenshield-broker → dist/bin/"

# Copy native modules
NATIVE_PATHS="
  $REPO_ROOT/node_modules/better-sqlite3/build/Release/better_sqlite3.node
  $REPO_ROOT/node_modules/better-sqlite3/prebuilds/${PLATFORM}-${ARCH}/better_sqlite3.node
"
for NATIVE_SRC in $NATIVE_PATHS; do
  if [ -f "$NATIVE_SRC" ]; then
    mkdir -p "$CLI_DIST/native"
    cp "$NATIVE_SRC" "$CLI_DIST/native/better_sqlite3.node"
    ok "Copied native modules"
    break
  fi
done

# Copy workers, interceptor, client from daemon build output
if [ -d "$DAEMON_BIN_DIR/workers" ]; then
  mkdir -p "$CLI_DIST/workers"
  cp "$DAEMON_BIN_DIR/workers/"* "$CLI_DIST/workers/" 2>/dev/null || true
  ok "Copied worker scripts"
fi

if [ -d "$DAEMON_BIN_DIR/interceptor" ]; then
  mkdir -p "$CLI_DIST/interceptor"
  cp "$DAEMON_BIN_DIR/interceptor/"* "$CLI_DIST/interceptor/" 2>/dev/null || true
  ok "Copied interceptor scripts"
fi

if [ -d "$DAEMON_BIN_DIR/client" ]; then
  mkdir -p "$CLI_DIST/client"
  cp "$DAEMON_BIN_DIR/client/"* "$CLI_DIST/client/" 2>/dev/null || true
  ok "Copied client scripts"
fi

# Copy UI assets
UI_DIST="$REPO_ROOT/dist/apps/shield-ui"
UI_TAR="$SEA_DIR/assets/ui-assets.tar.gz"
if [ -f "$UI_TAR" ]; then
  mkdir -p "$CLI_DIST/ui-assets"
  tar -xzf "$UI_TAR" -C "$CLI_DIST/ui-assets"
  ok "Copied UI assets"
elif [ -d "$UI_DIST" ]; then
  cp -R "$UI_DIST" "$CLI_DIST/ui-assets"
  ok "Copied UI assets"
fi

# Copy macOS app
MAC_APP="$REPO_ROOT/dist/apps/shield-macos/Release/AgenShield.app"
if [ -d "$MAC_APP" ]; then
  cp -R "$MAC_APP" "$CLI_DIST/AgenShield.app"
  ok "Copied AgenShield.app"
fi

# Generate package.json for npm publish
if [ "$SCOPED" = "true" ]; then
  PKG_NAME="@agenshield/cli-${PLATFORM}-${ARCH}"
else
  PKG_NAME="agenshield"
fi

cat > "$CLI_DIST/package.json" << EOF
{
  "name": "${PKG_NAME}",
  "version": "${VERSION}",
  "description": "AgenShield SEA binaries for ${PLATFORM}/${ARCH}",
  "bin": {
    "agenshield": "./bin/agenshield"
  },
  "os": ["${PLATFORM}"],
  "cpu": ["${ARCH}"],
  "license": "Apache-2.0",
  "repository": "https://github.com/agen-co/agenshield"
}
EOF
ok "Generated dist/package.json (${PKG_NAME})"

printf "\n${GREEN}${BOLD}npm dist ready!${RESET}\n\n"
printf "  ${DIM}%s/${RESET}\n" "$CLI_DIST"
printf "  Package: ${CYAN}%s@%s${RESET}\n" "$PKG_NAME" "$VERSION"
printf "\n  Test with:\n\n"
printf "    ${CYAN}%s/bin/agenshield install --force${RESET}\n\n" "$CLI_DIST"
