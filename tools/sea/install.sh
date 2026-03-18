#!/bin/sh
# AgenShield Installer
#
# Downloads and installs the AgenShield SEA binaries for the current platform.
#
# Multi-binary layout:
#   ~/.agenshield/bin/agenshield              (CLI — on PATH)
#   ~/.agenshield/libexec/agenshield-daemon   (Daemon — internal)
#   ~/.agenshield/libexec/agenshield-broker   (Broker — internal)
#   ~/.agenshield/lib/v{VERSION}/native/      (Native addons)
#
# Usage:
#   curl -fsSL https://get.agenshield.com/install.sh | sh
#   curl -fsSL https://get.agenshield.com/install.sh | bash -s -- --cloud-url https://cloud.example.com --org my-org
#
# CLI arguments (override environment variables):
#   --cloud-url <url>     Cloud/policy server URL for automatic enrollment
#   --org <id>            Org client ID for MDM enrollment (device code flow on daemon start)
#   --token <token>       Enrollment token for automatic cloud setup (MDM)
#   --version <ver>       Install a specific version (default: latest)
#   --skip-services       Skip macOS LaunchDaemon/LaunchAgent install
#   -h, --help            Show usage and exit
#
# Environment variables:
#   AGENSHIELD_VERSION    - Install a specific version (default: latest)
#   AGENSHIELD_GITHUB_REPO - GitHub repo for downloads (default: agen-co/agenshield)
#   AGENSHIELD_TOKEN      - Enrollment token for automatic cloud setup (MDM)
#   AGENSHIELD_CLOUD_URL  - Cloud API URL for automatic setup (requires AGENSHIELD_TOKEN or AGENSHIELD_ORG)
#   AGENSHIELD_ORG        - Org client ID for MDM enrollment (device code flow on daemon start)
#   AGENSHIELD_BASE_URL   - Base URL for downloading archive and checksums (overrides GitHub)
#   AGENSHIELD_SKIP_SERVICES - Set to "1" to skip macOS LaunchDaemon/LaunchAgent install
#
set -e

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

GITHUB_REPO="${AGENSHIELD_GITHUB_REPO:-agen-co/agenshield}"
CLI_BINARY="agenshield"

# Colors (disabled if not a terminal or NO_COLOR is set)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  DIM='\033[2m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' CYAN='' DIM='' BOLD='' RESET=''
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()  { printf "${CYAN}info${RESET}  %s\n" "$1"; }
ok()    { printf "${GREEN}  ok${RESET}  %s\n" "$1"; }
warn()  { printf "${YELLOW}warn${RESET}  %s\n" "$1"; }
error() { printf "${RED}error${RESET} %s\n" "$1" >&2; }
die()   { error "$1"; exit 1; }

# Detect the platform
detect_platform() {
  OS="$(uname -s)"
  case "$OS" in
    Darwin) PLATFORM="darwin" ;;
    Linux)  PLATFORM="linux" ;;
    *)      die "Unsupported operating system: $OS" ;;
  esac
}

# Detect the architecture
detect_arch() {
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64)   ARCH="x64" ;;
    aarch64|arm64)   ARCH="arm64" ;;
    *)               die "Unsupported architecture: $ARCH" ;;
  esac
}

# Find a download utility
detect_downloader() {
  if command -v curl >/dev/null 2>&1; then
    DOWNLOAD_CMD="curl"
  elif command -v wget >/dev/null 2>&1; then
    DOWNLOAD_CMD="wget"
  else
    die "Neither curl nor wget found. Please install one."
  fi
}

# Download a URL to a file
download() {
  url="$1"
  dest="$2"
  if [ "$DOWNLOAD_CMD" = "curl" ]; then
    curl -fsSL -o "$dest" "$url"
  else
    wget -qO "$dest" "$url"
  fi
}

# Download a URL and print to stdout
download_text() {
  url="$1"
  if [ "$DOWNLOAD_CMD" = "curl" ]; then
    curl -fsSL "$url"
  else
    wget -qO- "$url"
  fi
}

# Resolve the latest version from GitHub Releases API
resolve_latest_version() {
  info "Checking latest version..."
  LATEST_JSON=$(download_text "https://api.github.com/repos/$GITHUB_REPO/releases/latest" 2>/dev/null || true)

  if [ -z "$LATEST_JSON" ]; then
    die "Failed to query GitHub Releases API. Check your internet connection."
  fi

  # Extract tag_name (format: vX.Y.Z)
  VERSION=$(echo "$LATEST_JSON" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\(v[^"]*\)".*/\1/' | sed 's/^v//')

  if [ -z "$VERSION" ]; then
    die "Could not determine latest version from GitHub."
  fi
}

# Verify SHA-256 checksum
verify_checksum() {
  archive="$1"
  expected_checksum="$2"

  if command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$archive" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$archive" | awk '{print $1}')
  else
    warn "Neither shasum nor sha256sum found — skipping checksum verification"
    return 0
  fi

  if [ "$actual" != "$expected_checksum" ]; then
    die "Checksum mismatch!\n  Expected: $expected_checksum\n  Actual:   $actual"
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  # Parse CLI arguments (override environment variables)
  while [ $# -gt 0 ]; do
    case "$1" in
      --cloud-url)
        AGENSHIELD_CLOUD_URL="$2"; shift 2 ;;
      --cloud-url=*)
        AGENSHIELD_CLOUD_URL="${1#*=}"; shift ;;
      --org)
        AGENSHIELD_ORG="$2"; shift 2 ;;
      --org=*)
        AGENSHIELD_ORG="${1#*=}"; shift ;;
      --token)
        AGENSHIELD_TOKEN="$2"; shift 2 ;;
      --token=*)
        AGENSHIELD_TOKEN="${1#*=}"; shift ;;
      --version)
        AGENSHIELD_VERSION="$2"; shift 2 ;;
      --version=*)
        AGENSHIELD_VERSION="${1#*=}"; shift ;;
      --skip-services)
        AGENSHIELD_SKIP_SERVICES="1"; shift ;;
      -h|--help)
        printf "AgenShield Installer\n\n"
        printf "Usage:\n"
        printf "  curl -fsSL https://get.agenshield.com/install.sh | sh\n"
        printf "  curl -fsSL https://get.agenshield.com/install.sh | bash -s -- [OPTIONS]\n\n"
        printf "Options:\n"
        printf "  --cloud-url <url>   Cloud/policy server URL for automatic enrollment\n"
        printf "  --org <id>          Org client ID for MDM enrollment\n"
        printf "  --token <token>     Enrollment token for automatic cloud setup\n"
        printf "  --version <ver>     Install a specific version (default: latest)\n"
        printf "  --skip-services     Skip macOS LaunchDaemon/LaunchAgent install\n"
        printf "  -h, --help          Show this help message\n"
        exit 0
        ;;
      *)
        warn "Unknown option: $1"; shift ;;
    esac
  done

  # Validate: --org requires --cloud-url
  if [ -n "${AGENSHIELD_ORG:-}" ] && [ -z "${AGENSHIELD_CLOUD_URL:-}" ]; then
    die "--org requires --cloud-url to be specified"
  fi

  printf "\n${BOLD}AgenShield Installer${RESET}\n\n"

  detect_platform
  detect_arch
  detect_downloader

  info "Platform: $PLATFORM/$ARCH"

  # Determine version
  VERSION="${AGENSHIELD_VERSION:-}"
  if [ -z "$VERSION" ]; then
    resolve_latest_version
  fi
  info "Version:  $VERSION"

  # Construct download URL
  ARCHIVE_NAME="agenshield-${VERSION}-${PLATFORM}-${ARCH}.tar.gz"
  BASE_URL="${AGENSHIELD_BASE_URL:-}"
  if [ -n "$BASE_URL" ]; then
    DOWNLOAD_URL="${BASE_URL}/${ARCHIVE_NAME}"
    CHECKSUM_URL="${BASE_URL}/checksums.sha256"
    info "Using base URL: $BASE_URL"
  else
    DOWNLOAD_URL="https://github.com/$GITHUB_REPO/releases/download/v${VERSION}/${ARCHIVE_NAME}"
    CHECKSUM_URL="https://github.com/$GITHUB_REPO/releases/download/v${VERSION}/checksums.sha256"
  fi

  # Detect script directory for local archive mode
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

  # Create temp directory
  TMPDIR_INSTALL="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR_INSTALL"' EXIT

  # Download or copy archive
  if [ -f "$SCRIPT_DIR/$ARCHIVE_NAME" ]; then
    info "Using local archive: $SCRIPT_DIR/$ARCHIVE_NAME"
    cp "$SCRIPT_DIR/$ARCHIVE_NAME" "$TMPDIR_INSTALL/$ARCHIVE_NAME"
    ok "Copied local $ARCHIVE_NAME"
  else
    info "Downloading $ARCHIVE_NAME..."
    download "$DOWNLOAD_URL" "$TMPDIR_INSTALL/$ARCHIVE_NAME" || \
      die "Failed to download $DOWNLOAD_URL"
    ok "Downloaded $ARCHIVE_NAME"
  fi

  # Verify checksum
  info "Verifying checksum..."
  if [ -f "$SCRIPT_DIR/checksums.sha256" ]; then
    CHECKSUMS=$(cat "$SCRIPT_DIR/checksums.sha256")
  else
    CHECKSUMS=$(download_text "$CHECKSUM_URL" 2>/dev/null || true)
  fi
  if [ -n "$CHECKSUMS" ]; then
    EXPECTED=$(echo "$CHECKSUMS" | grep "$ARCHIVE_NAME" | awk '{print $1}')
    if [ -n "$EXPECTED" ]; then
      verify_checksum "$TMPDIR_INSTALL/$ARCHIVE_NAME" "$EXPECTED"
      ok "Checksum verified"
    else
      warn "Archive not found in checksums file — skipping verification"
    fi
  else
    warn "Could not download checksums — skipping verification"
  fi

  # ── Installation directories ─────────────────────────────────────────────
  INSTALL_DIR="${AGENSHIELD_INSTALL_DIR:-$HOME/.agenshield}"
  BIN_DIR="$INSTALL_DIR/bin"
  LIB_DIR="$INSTALL_DIR/lib/v${VERSION}"

  mkdir -p "$BIN_DIR"
  mkdir -p "$INSTALL_DIR/libexec"
  mkdir -p "$INSTALL_DIR/logs"

  # Extract archive to temp directory
  EXTRACT_DIR="$TMPDIR_INSTALL/extract"
  mkdir -p "$EXTRACT_DIR"
  info "Extracting..."
  tar -xzf "$TMPDIR_INSTALL/$ARCHIVE_NAME" -C "$EXTRACT_DIR"

  # ── Copy binaries (no execution — avoids SentinelOne process-tree kill) ──
  # CLI binary → bin/
  if [ -f "$EXTRACT_DIR/$CLI_BINARY" ]; then
    cp "$EXTRACT_DIR/$CLI_BINARY" "$BIN_DIR/$CLI_BINARY"
    chmod 755 "$BIN_DIR/$CLI_BINARY"
    ok "Installed $CLI_BINARY → $BIN_DIR/"
  fi

  # Daemon + broker → libexec/
  for BINARY in agenshield-daemon agenshield-broker; do
    if [ -f "$EXTRACT_DIR/$BINARY" ]; then
      cp "$EXTRACT_DIR/$BINARY" "$INSTALL_DIR/libexec/$BINARY"
      chmod 755 "$INSTALL_DIR/libexec/$BINARY"
      ok "Installed $BINARY → libexec/"
    fi
  done

  # Native modules
  if [ -d "$EXTRACT_DIR/native" ]; then
    mkdir -p "$LIB_DIR/native"
    cp "$EXTRACT_DIR/native/"* "$LIB_DIR/native/" 2>/dev/null || true
    ok "Installed native modules"
  fi

  # Worker scripts
  if [ -d "$EXTRACT_DIR/workers" ]; then
    mkdir -p "$LIB_DIR/workers"
    cp "$EXTRACT_DIR/workers/"* "$LIB_DIR/workers/" 2>/dev/null || true
    ok "Installed worker scripts"
  fi

  # Interceptor scripts
  if [ -d "$EXTRACT_DIR/interceptor" ]; then
    mkdir -p "$LIB_DIR/interceptor"
    cp "$EXTRACT_DIR/interceptor/"* "$LIB_DIR/interceptor/" 2>/dev/null || true
    ok "Installed interceptor scripts"
  fi

  # Client scripts
  if [ -d "$EXTRACT_DIR/client" ]; then
    mkdir -p "$LIB_DIR/client"
    cp "$EXTRACT_DIR/client/"* "$LIB_DIR/client/" 2>/dev/null || true
    ok "Installed client scripts"
  fi

  # UI assets
  if [ -d "$EXTRACT_DIR/ui-assets" ]; then
    mkdir -p "$LIB_DIR/ui-assets"
    cp -R "$EXTRACT_DIR/ui-assets/." "$LIB_DIR/ui-assets/" 2>/dev/null || true
    ok "Installed UI assets"
  fi

  # macOS menu bar app
  if [ -d "$EXTRACT_DIR/AgenShield.app" ]; then
    APPS_DIR="$INSTALL_DIR/apps"
    mkdir -p "$APPS_DIR"
    rm -rf "$APPS_DIR/AgenShield.app" 2>/dev/null || true
    cp -R "$EXTRACT_DIR/AgenShield.app" "$APPS_DIR/AgenShield.app"
    ok "Installed AgenShield.app → apps/"
  fi

  # Write version stamp
  mkdir -p "$LIB_DIR"
  echo "${VERSION}:wius" > "$LIB_DIR/.extracted"

  # ── macOS: remove quarantine from all installed files ───────────────────
  if [ "$PLATFORM" = "darwin" ]; then
    xattr -dr com.apple.quarantine "$INSTALL_DIR" 2>/dev/null || true
    ok "Removed quarantine attributes"
  fi

  # ── Add to PATH ────────────────────────────────────────────────────────
  SHELL_NAME="$(basename "${SHELL:-/bin/sh}")"
  case "$SHELL_NAME" in
    zsh)  RC_FILE="$HOME/.zshrc" ;;
    bash)
      if [ -f "$HOME/.bash_profile" ]; then
        RC_FILE="$HOME/.bash_profile"
      else
        RC_FILE="$HOME/.bashrc"
      fi
      ;;
    *)    RC_FILE="$HOME/.profile" ;;
  esac

  if [ -f "$RC_FILE" ] && grep -q '.agenshield/bin' "$RC_FILE" 2>/dev/null; then
    ok "PATH already configured in $RC_FILE"
  else
    printf '\n# AgenShield CLI\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$RC_FILE"
    ok "Added PATH to $RC_FILE"
  fi

  # ── Build the agenshield install command for the user ──────────────────
  INSTALL_CMD="agenshield install --force"
  if [ -n "${AGENSHIELD_CLOUD_URL:-}" ]; then
    INSTALL_CMD="$INSTALL_CMD --policy-url \"$AGENSHIELD_CLOUD_URL\" --cloud-url \"$AGENSHIELD_CLOUD_URL\""
  fi
  if [ -n "${AGENSHIELD_ORG:-}" ]; then
    INSTALL_CMD="$INSTALL_CMD --org \"$AGENSHIELD_ORG\""
  fi
  if [ -n "${AGENSHIELD_TOKEN:-}" ]; then
    INSTALL_CMD="$INSTALL_CMD --token \"$AGENSHIELD_TOKEN\""
  fi
  if [ "${AGENSHIELD_SKIP_SERVICES:-}" = "1" ]; then
    INSTALL_CMD="$INSTALL_CMD --skip-services"
  fi

  printf "\n${GREEN}${BOLD}Files installed!${RESET}\n\n"
  printf "  To complete setup, run:\n\n"
  printf "    ${CYAN}source %s && %s${RESET}\n\n" "$RC_FILE" "$INSTALL_CMD"
  printf "  Installation directory: ${DIM}%s${RESET}\n\n" "$INSTALL_DIR"
}

main "$@"
