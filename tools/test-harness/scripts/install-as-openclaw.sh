#!/bin/bash
# install-as-openclaw.sh
#
# Installs the dummy OpenClaw at the exact npm global paths where
# detect.ts expects to find a real OpenClaw. This lets us test the
# full detection → migration → execution pipeline without a real install.
#
# What it does:
#   1. Copies harness into ${NPM_ROOT}/openclaw/  (with name: "openclaw")
#   2. Creates a shell wrapper at ${NPM_BIN}/openclaw
#   3. Copies skills + config into ~/.openclaw/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARNESS_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"

# ── Resolve npm global paths (same logic as detect.ts) ──────────────
NPM_ROOT="$(npm root -g)"
NPM_BIN="$(npm prefix -g)/bin"

PACKAGE_DIR="${NPM_ROOT}/openclaw"
BINARY_PATH="${NPM_BIN}/openclaw"
CONFIG_DIR="${HOME}/.openclaw"
SKILLS_SOURCE="${PROJECT_ROOT}/tmp/dev-agent/.openclaw"

echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Install Dummy OpenClaw (for detect.ts testing)         ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "  npm root:       ${NPM_ROOT}"
echo "  npm bin:        ${NPM_BIN}"
echo "  package dir:    ${PACKAGE_DIR}"
echo "  binary:         ${BINARY_PATH}"
echo "  config dir:     ${CONFIG_DIR}"
echo "  skills source:  ${SKILLS_SOURCE}"
echo ""

# ── Guard: don't clobber a real openclaw ────────────────────────────
if [ -d "$PACKAGE_DIR" ]; then
  # Check if it's already our dummy
  if grep -q '"1.0.0-dummy"' "${PACKAGE_DIR}/package.json" 2>/dev/null; then
    echo "⚠  Existing dummy openclaw detected — removing first..."
    rm -rf "$PACKAGE_DIR"
  else
    echo "ERROR: ${PACKAGE_DIR} already exists and does NOT look like a dummy."
    echo "       Refusing to overwrite. Remove it manually if intended."
    exit 1
  fi
fi

if [ -f "$BINARY_PATH" ]; then
  if grep -q "dummy-openclaw" "$BINARY_PATH" 2>/dev/null; then
    rm -f "$BINARY_PATH"
  else
    echo "ERROR: ${BINARY_PATH} already exists and does NOT look like a dummy."
    echo "       Refusing to overwrite. Remove it manually if intended."
    exit 1
  fi
fi

# ── 1. Copy harness into npm global root ────────────────────────────
echo "→ Copying harness to ${PACKAGE_DIR}..."
mkdir -p "$PACKAGE_DIR"
cp -R "$HARNESS_DIR/bin"  "$PACKAGE_DIR/bin"
cp -R "$HARNESS_DIR/src"  "$PACKAGE_DIR/src"

# Write a package.json with name "openclaw" so detect.ts and migration.ts
# read the correct package name, bin field, and version.
cat > "${PACKAGE_DIR}/package.json" <<'PKGJSON'
{
  "name": "openclaw",
  "version": "1.0.0-dummy",
  "description": "Dummy OpenClaw for AgenShield detection testing",
  "main": "src/index.js",
  "bin": {
    "openclaw": "./bin/dummy-openclaw.js"
  },
  "dependencies": {
    "commander": "^12.0.0"
  }
}
PKGJSON

echo "→ Installing production dependencies..."
(cd "$PACKAGE_DIR" && npm install --production --silent 2>&1)

chmod +x "${PACKAGE_DIR}/bin/dummy-openclaw.js"

# ── 2. Create shell wrapper in npm bin ──────────────────────────────
echo "→ Creating binary at ${BINARY_PATH}..."
mkdir -p "$NPM_BIN"
cat > "$BINARY_PATH" <<WRAPPER
#!/bin/sh
# Dummy OpenClaw wrapper — installed by install-as-openclaw.sh
exec node "${PACKAGE_DIR}/bin/dummy-openclaw.js" "\$@"
WRAPPER
chmod +x "$BINARY_PATH"

# ── 3. Copy config + skills into ~/.openclaw/ ──────────────────────
echo "→ Setting up ${CONFIG_DIR}..."
mkdir -p "${CONFIG_DIR}/skills"

if [ -d "$SKILLS_SOURCE" ]; then
  # Copy config if not already present
  if [ -f "${SKILLS_SOURCE}/openclaw.json" ] && [ ! -f "${CONFIG_DIR}/openclaw.json" ]; then
    echo "  copying openclaw.json"
    cp "${SKILLS_SOURCE}/openclaw.json" "${CONFIG_DIR}/openclaw.json"
  elif [ -f "${CONFIG_DIR}/openclaw.json" ]; then
    echo "  openclaw.json already exists — skipping"
  fi

  # Copy skills
  if [ -d "${SKILLS_SOURCE}/skills" ]; then
    for skill_dir in "${SKILLS_SOURCE}/skills"/*/; do
      skill_name="$(basename "$skill_dir")"
      echo "  copying skill: ${skill_name}"
      rm -rf "${CONFIG_DIR}/skills/${skill_name}"
      cp -R "$skill_dir" "${CONFIG_DIR}/skills/${skill_name}"
    done
  fi
else
  echo "  ⚠  Skills source not found at ${SKILLS_SOURCE}"
  echo "     Skipping config/skills copy. You can populate ~/.openclaw/ manually."
fi

# ── Done ────────────────────────────────────────────────────────────
echo ""
echo "✓ Dummy OpenClaw installed successfully!"
echo ""
echo "Verify with:"
echo "  openclaw --version                      # → 1.0.0-dummy"
echo "  openclaw status                         # → environment info"
echo "  ls ${PACKAGE_DIR}/package.json          # → package present"
echo "  ls ${BINARY_PATH}                       # → binary present"
echo "  ls ~/.openclaw/skills/                  # → skills present"
echo ""
echo "Test detection (from project root):"
echo "  npx nx run shield-sandbox:test          # if tests exist"
echo ""
echo "To uninstall:"
echo "  ${SCRIPT_DIR}/uninstall-openclaw.sh"
