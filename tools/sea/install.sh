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
#   AGENSHIELD_TOKEN      - Enrollment token for automatic cloud setup (MDM)
#   AGENSHIELD_CLOUD_URL  - Cloud API URL for automatic setup (requires AGENSHIELD_TOKEN or AGENSHIELD_ORG)
#   AGENSHIELD_ORG        - Org client ID for MDM enrollment (device code flow on daemon start)
#   AGENSHIELD_CODESIGN_IDENTITY - Apple Developer ID signing identity (default: ad-hoc)
#   AGENSHIELD_SKIP_SERVICES - Set to "1" to skip macOS LaunchDaemon/LaunchAgent install
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

# Resolve the codesign bundle identifier for a binary by its filename.
resolve_codesign_id() {
  case "$(basename "$1")" in
    agenshield)          echo "com.frontegg.agenshield.cli" ;;
    agenshield-daemon)   echo "com.frontegg.agenshield.daemon" ;;
    agenshield-broker)   echo "com.frontegg.agenshield.broker" ;;
    better_sqlite3.node) echo "com.frontegg.agenshield.native.better-sqlite3" ;;
    *)                   echo "" ;;
  esac
}

# Sign a binary with hardened runtime (macOS Sequoia requirement)
# Uses AGENSHIELD_CODESIGN_IDENTITY for Developer ID signing if set, otherwise ad-hoc.
sign_binary_hardened() {
  _BINARY="$1"
  _IDENTITY="${AGENSHIELD_CODESIGN_IDENTITY:-}"
  _IDENTIFIER="$(resolve_codesign_id "$_BINARY")"
  _ID_FLAG=""
  if [ -n "$_IDENTIFIER" ]; then
    _ID_FLAG="--identifier $_IDENTIFIER"
  fi
  _ENT_FILE=$(mktemp /tmp/agenshield-ent.XXXXXX.plist)
  cat > "$_ENT_FILE" << 'ENTEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.cs.allow-jit</key><true/>
<key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
<key>com.apple.security.cs.disable-library-validation</key><true/>
<key>com.apple.security.network.client</key><true/>
<key>com.apple.security.network.server</key><true/>
</dict></plist>
ENTEOF
  if [ -n "$_IDENTITY" ]; then
    codesign --force --sign "$_IDENTITY" $_ID_FLAG --timestamp --options runtime --entitlements "$_ENT_FILE" "$_BINARY" 2>/dev/null || \
      codesign --force --sign - $_ID_FLAG --options runtime --entitlements "$_ENT_FILE" "$_BINARY" 2>/dev/null || \
      codesign --force --sign - $_ID_FLAG "$_BINARY" 2>/dev/null || true
  else
    codesign --force --sign - $_ID_FLAG --options runtime --entitlements "$_ENT_FILE" "$_BINARY" 2>/dev/null || \
      codesign --force --sign - $_ID_FLAG "$_BINARY" 2>/dev/null || true
  fi
  rm -f "$_ENT_FILE"
}

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
    # macOS: remove quarantine and re-sign with hardened runtime
    if [ "$PLATFORM" = "darwin" ]; then
      xattr -d com.apple.quarantine "$BIN_DIR/$CLI_BINARY" 2>/dev/null || true
      sign_binary_hardened "$BIN_DIR/$CLI_BINARY"
      if [ -n "${AGENSHIELD_CODESIGN_IDENTITY:-}" ]; then
        info "Re-signed $CLI_BINARY (Developer ID, hardened runtime)"
      else
        info "Re-signed $CLI_BINARY (ad-hoc, hardened runtime)"
      fi
    fi
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

  # macOS: remove quarantine and re-sign with hardened runtime for LaunchDaemon compatibility
  if [ "$PLATFORM" = "darwin" ]; then
    for BINARY in $INTERNAL_BINARIES; do
      if [ -f "$INSTALL_DIR/libexec/$BINARY" ]; then
        xattr -d com.apple.quarantine "$INSTALL_DIR/libexec/$BINARY" 2>/dev/null || true
        sign_binary_hardened "$INSTALL_DIR/libexec/$BINARY"
        if [ -n "${AGENSHIELD_CODESIGN_IDENTITY:-}" ]; then
          info "Re-signed $BINARY (Developer ID, hardened runtime)"
        else
          info "Re-signed $BINARY (ad-hoc, hardened runtime)"
        fi
      fi
    done
    # If running with sudo/root, set proper ownership for system LaunchDaemons
    if [ "$(id -u)" = "0" ] || command -v sudo >/dev/null 2>&1; then
      sudo chown -R root:wheel "$INSTALL_DIR/libexec" 2>/dev/null || true
    fi
  fi

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

  # Install shield-client script
  if [ -d "$EXTRACT_DIR/client" ]; then
    mkdir -p "$LIB_DIR/client"
    cp "$EXTRACT_DIR/client/"* "$LIB_DIR/client/" 2>/dev/null || true
    ok "Installed shield-client script"
  fi

  # Install UI assets
  if [ -d "$EXTRACT_DIR/ui-assets" ]; then
    mkdir -p "$LIB_DIR/ui-assets"
    cp -R "$EXTRACT_DIR/ui-assets/." "$LIB_DIR/ui-assets/" 2>/dev/null || true
    ok "Installed UI assets"
  fi

  # Install macOS menu bar app (if present in archive)
  if [ -d "$EXTRACT_DIR/AgenShield.app" ]; then
    APPS_DIR="$INSTALL_DIR/apps"
    mkdir -p "$APPS_DIR"
    rm -rf "$APPS_DIR/AgenShield.app" 2>/dev/null || true
    cp -R "$EXTRACT_DIR/AgenShield.app" "$APPS_DIR/AgenShield.app"
    if [ "$PLATFORM" = "darwin" ]; then
      xattr -d com.apple.quarantine "$APPS_DIR/AgenShield.app" 2>/dev/null || true
    fi
    ok "Installed AgenShield.app → apps/"

    # Copy to /Applications for notification permissions, Login Items icon, and discoverability
    if sudo cp -R "$APPS_DIR/AgenShield.app" /Applications/AgenShield.app 2>/dev/null; then
      sudo chown -R root:wheel /Applications/AgenShield.app 2>/dev/null || true
      ok "Copied AgenShield.app → /Applications/"
    else
      warn "Could not copy AgenShield.app to /Applications/ (sudo may be required)."
    fi
  fi

  # Write version stamp for SEA extraction check
  echo "${VERSION}:wius" > "$LIB_DIR/.extracted"

  # macOS: verify code signing (informational, non-blocking)
  if [ "$PLATFORM" = "darwin" ] && command -v codesign >/dev/null 2>&1; then
    if codesign --verify --verbose=0 "$BIN_DIR/$CLI_BINARY" 2>/dev/null; then
      SIGN_INFO=$(codesign -dv "$BIN_DIR/$CLI_BINARY" 2>&1 | grep "Authority=" | head -1 || true)
      if echo "$SIGN_INFO" | grep -q "Developer ID"; then
        ok "Code signature verified (Developer ID)"
      else
        info "Binary is ad-hoc signed (community build)"
      fi
    else
      info "Binary is unsigned (community build)"
    fi
  fi

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

  # ── Best-effort macOS service installation ──────────────────────────────
  if [ "$PLATFORM" = "darwin" ] && [ "${AGENSHIELD_SKIP_SERVICES:-}" != "1" ]; then
    info "Installing macOS services..."

    # LaunchDaemon (requires sudo)
    if [ -f "$INSTALL_DIR/libexec/agenshield-daemon" ]; then
      if "$BIN_DIR/$CLI_BINARY" service install 2>/dev/null; then
        ok "Installed LaunchDaemon service"
      else
        warn "Could not install LaunchDaemon (sudo may be required)."
        warn "Run later: sudo agenshield service install"
      fi
    fi

    # Menu bar LaunchAgent (no sudo)
    if [ -d "$INSTALL_DIR/apps/AgenShield.app" ]; then
      if "$BIN_DIR/$CLI_BINARY" service menubar install 2>/dev/null; then
        ok "Installed menu bar agent"
      else
        warn "Could not install menu bar agent."
      fi
    fi
  fi

  # ── Automatic cloud setup via token (MDM) ──────────────────────────────
  SETUP_DONE=false
  TOKEN="${AGENSHIELD_TOKEN:-}"
  if [ -n "$TOKEN" ]; then
    info "Enrollment token detected — running automatic setup..."
    SETUP_ARGS="--token $TOKEN"
    CLOUD_URL="${AGENSHIELD_CLOUD_URL:-}"
    if [ -n "$CLOUD_URL" ]; then
      SETUP_ARGS="$SETUP_ARGS --cloud-url $CLOUD_URL"
    fi

    # Use the freshly installed binary (PATH may not be sourced yet)
    if "$BIN_DIR/$CLI_BINARY" setup $SETUP_ARGS; then
      ok "Automatic setup completed"
      SETUP_DONE=true
    else
      SETUP_EXIT=$?
      warn "Automatic setup failed (exit code $SETUP_EXIT)"
      warn "You can retry manually: agenshield setup --token <token>"
    fi
  fi

  # ── Automatic org-based setup via AGENSHIELD_ORG (MDM) ───────────────────
  ORG="${AGENSHIELD_ORG:-}"
  if [ -n "$ORG" ] && [ "$SETUP_DONE" = "false" ]; then
    CLOUD_URL="${AGENSHIELD_CLOUD_URL:-}"
    if [ -z "$CLOUD_URL" ]; then
      warn "AGENSHIELD_ORG requires AGENSHIELD_CLOUD_URL to be set — skipping org setup"
    else
      info "Org client ID detected — writing MDM config and running org setup..."

      # Write MDM config directly (in case CLI setup fails)
      MDM_DIR="$HOME/.agenshield"
      mkdir -p "$MDM_DIR"
      tee "$MDM_DIR/mdm.json" > /dev/null << MDMEOF
{
  "orgClientId": "$ORG",
  "cloudUrl": "$CLOUD_URL",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
MDMEOF
      ok "Wrote MDM config to $MDM_DIR/mdm.json"

      # Run setup --org
      if "$BIN_DIR/$CLI_BINARY" setup --org "$ORG" --cloud-url "$CLOUD_URL"; then
        ok "Org setup completed"
        SETUP_DONE=true
      else
        SETUP_EXIT=$?
        warn "Org setup failed (exit code $SETUP_EXIT)"
        warn "MDM config is written — the daemon will retry enrollment on next start."
      fi
    fi
  fi

  printf "\n${GREEN}${BOLD}Installation complete!${RESET}\n\n"
  if [ "$SETUP_DONE" = "true" ]; then
    printf "  AgenShield is installed and enrolled.\n\n"
  else
    printf "  Run:\n\n"
    printf "    ${CYAN}source %s${RESET}\n" "$RC_FILE"
    printf "    ${CYAN}agenshield setup${RESET}\n\n"
  fi
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
