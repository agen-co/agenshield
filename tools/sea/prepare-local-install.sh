#!/bin/sh
# Prepare a self-contained dist/install/ directory for local testing.
#
# Copies the SEA archive, checksums, and install.sh from the build output
# so you can run `bash dist/install/install.sh` without network access,
# or serve it via `serve-local-install.sh` for curl-pipe testing.
#
# Prerequisites: run `node --experimental-strip-types tools/sea/build-all.mts` first.
#
# Usage:
#   bash tools/sea/prepare-local-install.sh [OPTIONS]
#
# Options:
#   --port <port>         HTTP server port (default: 8079)
#   --cloud-url <url>     Cloud/policy server URL to bake into install.sh
#   --org <id>            Org client ID to bake into install.sh
#   --token <token>       Enrollment token to bake into install.sh
#
# Then test:
#   bash dist/install/install.sh
#   yarn sea:serve → curl -fsSL http://localhost:8079/install.sh | bash
#
set -e

PORT="${PORT:-8079}"
CLOUD_URL=""
ORG=""
TOKEN=""

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    --cloud-url) CLOUD_URL="$2"; shift 2 ;;
    --cloud-url=*) CLOUD_URL="${1#*=}"; shift ;;
    --org) ORG="$2"; shift 2 ;;
    --org=*) ORG="${1#*=}"; shift ;;
    --token) TOKEN="$2"; shift 2 ;;
    --token=*) TOKEN="${1#*=}"; shift ;;
    *) shift ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEA_DIR="$REPO_ROOT/dist/sea"
INSTALL_DIR="$REPO_ROOT/dist/install"

# Colors
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; DIM='\033[2m'; BOLD='\033[1m'; RESET='\033[0m'
else
  RED='' GREEN='' CYAN='' DIM='' BOLD='' RESET=''
fi
info()  { printf "${CYAN}info${RESET}  %s\n" "$1"; }
ok()    { printf "${GREEN}  ok${RESET}  %s\n" "$1"; }
die()   { printf "${RED}error${RESET} %s\n" "$1" >&2; exit 1; }

# Check build output exists
[ -d "$SEA_DIR" ] || die "dist/sea/ not found. Run: node --experimental-strip-types tools/sea/build-all.mts"
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

ARCHIVE_NAME="agenshield-${VERSION}-${PLATFORM}-${ARCH}.tar.gz"

[ -f "$SEA_DIR/$ARCHIVE_NAME" ] || die "Archive not found: dist/sea/$ARCHIVE_NAME"

# Prepare dist/install/
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

info "Assembling dist/install/ (v${VERSION}, ${PLATFORM}/${ARCH})"

# Copy archive
cp "$SEA_DIR/$ARCHIVE_NAME" "$INSTALL_DIR/$ARCHIVE_NAME"
ok "Copied $ARCHIVE_NAME"

# Generate fresh checksum from the copied archive
(cd "$INSTALL_DIR" && shasum -a 256 "$ARCHIVE_NAME") > "$INSTALL_DIR/checksums.sha256"
ok "Generated checksums.sha256"

# Copy install.sh with baked-in defaults for local/server testing
{
  printf '#!/bin/sh\n'
  printf '# Auto-generated for local testing — defaults to local server at port %s\n' "$PORT"
  printf 'AGENSHIELD_BASE_URL="${AGENSHIELD_BASE_URL:-http://localhost:%s}"\n' "$PORT"
  printf 'AGENSHIELD_VERSION="${AGENSHIELD_VERSION:-%s}"\n' "$VERSION"
  if [ -n "$CLOUD_URL" ]; then
    printf 'AGENSHIELD_CLOUD_URL="${AGENSHIELD_CLOUD_URL:-%s}"\n' "$CLOUD_URL"
  fi
  if [ -n "$ORG" ]; then
    printf 'AGENSHIELD_ORG="${AGENSHIELD_ORG:-%s}"\n' "$ORG"
  fi
  if [ -n "$TOKEN" ]; then
    printf 'AGENSHIELD_TOKEN="${AGENSHIELD_TOKEN:-%s}"\n' "$TOKEN"
  fi
  # Append the original install.sh, skipping its shebang line
  tail -n +2 "$REPO_ROOT/tools/sea/install.sh"
} > "$INSTALL_DIR/install.sh"
chmod +x "$INSTALL_DIR/install.sh"

BAKED_OPTS="BASE_URL=http://localhost:$PORT, VERSION=$VERSION"
[ -n "$CLOUD_URL" ] && BAKED_OPTS="$BAKED_OPTS, CLOUD_URL=$CLOUD_URL"
[ -n "$ORG" ] && BAKED_OPTS="$BAKED_OPTS, ORG=$ORG"
[ -n "$TOKEN" ] && BAKED_OPTS="$BAKED_OPTS, TOKEN=***"
ok "Generated install.sh ($BAKED_OPTS)"

printf "\n${GREEN}${BOLD}Ready!${RESET}\n\n"
printf "  ${DIM}%s/${RESET}\n" "$INSTALL_DIR"
ls -lh "$INSTALL_DIR" | tail -n +2 | while IFS= read -r line; do
  printf "    ${DIM}%s${RESET}\n" "$line"
done
printf "\n  Run directly:\n\n"
printf "    ${CYAN}bash dist/install/install.sh${RESET}\n\n"
printf "  Or serve + curl:\n\n"
printf "    ${CYAN}yarn sea:serve${RESET}\n"
printf "    ${CYAN}curl -fsSL http://localhost:%s/install.sh | bash${RESET}\n\n" "$PORT"
