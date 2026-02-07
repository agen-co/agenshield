#!/bin/bash
# uninstall-openclaw.sh
#
# Removes the dummy OpenClaw installed by install-as-openclaw.sh.
# Does NOT touch ~/.openclaw/ config unless --clean-config is passed.

set -euo pipefail

CLEAN_CONFIG=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --clean-config)
      CLEAN_CONFIG=true
      shift
      ;;
    -h|--help)
      echo "Usage: uninstall-openclaw.sh [--clean-config]"
      echo ""
      echo "  --clean-config   Also remove ~/.openclaw/ directory"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

NPM_ROOT="$(npm root -g)"
NPM_BIN="$(npm prefix -g)/bin"

PACKAGE_DIR="${NPM_ROOT}/openclaw"
BINARY_PATH="${NPM_BIN}/openclaw"
CONFIG_DIR="${HOME}/.openclaw"

echo "Uninstalling dummy OpenClaw..."
echo ""

# ── Remove package directory ────────────────────────────────────────
if [ -d "$PACKAGE_DIR" ]; then
  if grep -q '"1.0.0-dummy"' "${PACKAGE_DIR}/package.json" 2>/dev/null; then
    echo "→ Removing ${PACKAGE_DIR}"
    rm -rf "$PACKAGE_DIR"
  else
    echo "⚠  ${PACKAGE_DIR} does NOT look like a dummy install — skipping"
  fi
else
  echo "  (${PACKAGE_DIR} not found)"
fi

# ── Remove binary ──────────────────────────────────────────────────
if [ -f "$BINARY_PATH" ]; then
  if grep -q "dummy-openclaw" "$BINARY_PATH" 2>/dev/null; then
    echo "→ Removing ${BINARY_PATH}"
    rm -f "$BINARY_PATH"
  else
    echo "⚠  ${BINARY_PATH} does NOT look like a dummy wrapper — skipping"
  fi
else
  echo "  (${BINARY_PATH} not found)"
fi

# ── Optionally clean config ────────────────────────────────────────
if [ "$CLEAN_CONFIG" = true ]; then
  if [ -d "$CONFIG_DIR" ]; then
    echo "→ Removing ${CONFIG_DIR}"
    rm -rf "$CONFIG_DIR"
  else
    echo "  (${CONFIG_DIR} not found)"
  fi
else
  echo ""
  echo "  ~/.openclaw/ left intact. Pass --clean-config to remove it."
fi

echo ""
echo "✓ Done!"
