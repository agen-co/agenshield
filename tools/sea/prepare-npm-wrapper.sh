#!/bin/sh
# Prepare the `agenshield` wrapper npm package for publishing.
#
# This creates a thin wrapper that has optionalDependencies pointing
# to platform-specific packages (@agenshield/cli-{platform}-{arch}).
# npm resolves the correct one per platform.
#
# Usage:
#   bash tools/sea/prepare-npm-wrapper.sh
#
set -e

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEA_DIR="$REPO_ROOT/dist/sea"
WRAPPER_DIST="$REPO_ROOT/dist/npm-wrapper"

# Colors
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
else
  GREEN='' CYAN='' BOLD='' RESET=''
fi
ok()    { printf "${GREEN}  ok${RESET}  %s\n" "$1"; }
die()   { printf "\033[0;31merror\033[0m %s\n" "$1" >&2; exit 1; }

[ -f "$SEA_DIR/VERSION" ] || die "dist/sea/VERSION not found. Run: yarn build:sea"
VERSION="$(cat "$SEA_DIR/VERSION" | tr -d '[:space:]')"

# Clean and create wrapper dist
rm -rf "$WRAPPER_DIST"
mkdir -p "$WRAPPER_DIST/bin"

# Copy launcher script
cp "$REPO_ROOT/tools/sea/npx-launcher.sh" "$WRAPPER_DIST/bin/agenshield"
chmod 755 "$WRAPPER_DIST/bin/agenshield"
ok "Copied launcher script"

# Generate wrapper package.json
cat > "$WRAPPER_DIST/package.json" << EOF
{
  "name": "agenshield",
  "version": "${VERSION}",
  "description": "AgenShield - Security CLI for AI agents",
  "bin": {
    "agenshield": "./bin/agenshield"
  },
  "optionalDependencies": {
    "@agenshield/cli-darwin-arm64": "${VERSION}",
    "@agenshield/cli-darwin-x64": "${VERSION}",
    "@agenshield/cli-linux-x64": "${VERSION}"
  },
  "license": "Apache-2.0",
  "repository": "https://github.com/agen-co/agenshield",
  "homepage": "https://agenshield.com"
}
EOF
ok "Generated wrapper package.json (v${VERSION})"

printf "\n${GREEN}${BOLD}Wrapper package ready!${RESET}\n\n"
printf "  ${CYAN}%s/${RESET}\n" "$WRAPPER_DIST"
printf "\n  Publish with:\n\n"
printf "    ${CYAN}npm publish %s --access public${RESET}\n\n" "$WRAPPER_DIST"
