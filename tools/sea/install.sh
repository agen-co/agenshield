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
#
# Environment variables:
#   AGENSHIELD_VERSION    - Install a specific version (default: latest)
#   AGENSHIELD_INSTALL_DIR - Installation directory (default: ~/.agenshield)
#   AGENSHIELD_GITHUB_REPO - GitHub repo for downloads (default: agen-co/agenshield)
#
set -e

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

GITHUB_REPO="${AGENSHIELD_GITHUB_REPO:-agen-co/agenshield}"
INSTALL_DIR="${AGENSHIELD_INSTALL_DIR:-$HOME/.agenshield}"
BIN_DIR="$INSTALL_DIR/bin"
CLI_BINARY="agenshield"
INTERNAL_BINARIES="agenshield-daemon agenshield-broker"

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

# Add bin dir to PATH in shell rc
ensure_path() {
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
    fish) RC_FILE="$HOME/.config/fish/config.fish" ;;
    *)    RC_FILE="$HOME/.profile" ;;
  esac

  EXPORT_LINE="export PATH=\"$BIN_DIR:\$PATH\""

  if [ -f "$RC_FILE" ] && grep -q '.agenshield/bin' "$RC_FILE" 2>/dev/null; then
    ok "PATH already configured in $RC_FILE"
    return
  fi

  if [ "$SHELL_NAME" = "fish" ]; then
    warn "Fish shell detected — please add manually:"
    printf "  ${DIM}set -gx PATH %s \$PATH${RESET}\n" "$BIN_DIR"
    return
  fi

  printf '\n# AgenShield CLI\n%s\n' "$EXPORT_LINE" >> "$RC_FILE"
  ok "Added PATH to $RC_FILE"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
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
  DOWNLOAD_URL="https://github.com/$GITHUB_REPO/releases/download/v${VERSION}/${ARCHIVE_NAME}"
  CHECKSUM_URL="https://github.com/$GITHUB_REPO/releases/download/v${VERSION}/checksums.sha256"

  # Create temp directory
  TMPDIR_INSTALL="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR_INSTALL"' EXIT

  # Download archive
  info "Downloading $ARCHIVE_NAME..."
  download "$DOWNLOAD_URL" "$TMPDIR_INSTALL/$ARCHIVE_NAME" || \
    die "Failed to download $DOWNLOAD_URL"
  ok "Downloaded $ARCHIVE_NAME"

  # Download and verify checksum
  info "Verifying checksum..."
  CHECKSUMS=$(download_text "$CHECKSUM_URL" 2>/dev/null || true)
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

  # Create installation directories
  mkdir -p "$BIN_DIR"
  mkdir -p "$INSTALL_DIR/libexec"
  mkdir -p "$INSTALL_DIR/logs"

  # Extract archive to temp directory
  EXTRACT_DIR="$TMPDIR_INSTALL/extract"
  mkdir -p "$EXTRACT_DIR"
  info "Extracting to $INSTALL_DIR..."
  tar -xzf "$TMPDIR_INSTALL/$ARCHIVE_NAME" -C "$EXTRACT_DIR"

  # Install CLI binary (on PATH)
  if [ -f "$EXTRACT_DIR/$CLI_BINARY" ]; then
    cp "$EXTRACT_DIR/$CLI_BINARY" "$BIN_DIR/$CLI_BINARY"
    chmod 755 "$BIN_DIR/$CLI_BINARY"
    ok "Installed $CLI_BINARY → $BIN_DIR/"
  fi

  # Install internal binaries (not on PATH)
  for BINARY in $INTERNAL_BINARIES; do
    if [ -f "$EXTRACT_DIR/$BINARY" ]; then
      cp "$EXTRACT_DIR/$BINARY" "$INSTALL_DIR/libexec/$BINARY"
      chmod 755 "$INSTALL_DIR/libexec/$BINARY"
      ok "Installed $BINARY → libexec/"
    fi
  done

  # Install native modules
  LIB_DIR="$INSTALL_DIR/lib/v${VERSION}"
  if [ -d "$EXTRACT_DIR/native" ]; then
    mkdir -p "$LIB_DIR/native"
    cp "$EXTRACT_DIR/native/"* "$LIB_DIR/native/" 2>/dev/null || true
    ok "Installed native modules to $LIB_DIR/native/"
  fi

  # Install worker scripts
  if [ -d "$EXTRACT_DIR/workers" ]; then
    mkdir -p "$LIB_DIR/workers"
    cp "$EXTRACT_DIR/workers/"* "$LIB_DIR/workers/" 2>/dev/null || true
    ok "Installed worker scripts"
  fi

  # Install interceptor scripts
  if [ -d "$EXTRACT_DIR/interceptor" ]; then
    mkdir -p "$LIB_DIR/interceptor"
    cp "$EXTRACT_DIR/interceptor/"* "$LIB_DIR/interceptor/" 2>/dev/null || true
    ok "Installed interceptor scripts"
  fi

  # Install UI assets
  if [ -d "$EXTRACT_DIR/ui-assets" ]; then
    mkdir -p "$LIB_DIR/ui-assets"
    cp -R "$EXTRACT_DIR/ui-assets/." "$LIB_DIR/ui-assets/" 2>/dev/null || true
    ok "Installed UI assets"
  fi

  # Write version stamp for SEA extraction check
  echo "${VERSION}:wiu" > "$LIB_DIR/.extracted"

  # Write version.json
  cat > "$INSTALL_DIR/version.json" << EOF
{
  "version": "$VERSION",
  "channel": "stable",
  "format": "sea",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  ok "Wrote version.json"

  # Add to PATH
  ensure_path

  printf "\n${GREEN}${BOLD}Installation complete!${RESET}\n\n"
  printf "  Run:\n\n"
  printf "    ${CYAN}source %s${RESET}\n" "$RC_FILE"
  printf "    ${CYAN}agenshield setup${RESET}\n\n"
  printf "  Installation directory: ${DIM}%s${RESET}\n" "$INSTALL_DIR"
  printf "  Binaries:\n"
  if [ -f "$BIN_DIR/$CLI_BINARY" ]; then
    printf "    ${DIM}%s/%s${RESET}  (PATH)\n" "$BIN_DIR" "$CLI_BINARY"
  fi
  for BINARY in $INTERNAL_BINARIES; do
    if [ -f "$INSTALL_DIR/libexec/$BINARY" ]; then
      printf "    ${DIM}%s/libexec/%s${RESET}\n" "$INSTALL_DIR" "$BINARY"
    fi
  done
  printf "\n"
}

main "$@"
