#!/bin/sh
# Serve dist/install/ over HTTP for curl-pipe install testing.
#
# Simulates the production flow:
#   curl -fsSL http://localhost:8079/install.sh | bash
#
# Usage:
#   bash tools/sea/serve-local-install.sh [OPTIONS]
#
# Options:
#   --port <port>         HTTP server port (default: 8079)
#   --cloud-url <url>     Cloud/policy server URL baked into install.sh
#   --org <id>            Org client ID baked into install.sh
#   --token <token>       Enrollment token baked into install.sh
#
set -e

PORT="${PORT:-8079}"
PREPARE_ARGS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --port)      PORT="$2"; PREPARE_ARGS="$PREPARE_ARGS --port $2"; shift 2 ;;
    --port=*)    PORT="${1#*=}"; PREPARE_ARGS="$PREPARE_ARGS $1"; shift ;;
    --cloud-url) PREPARE_ARGS="$PREPARE_ARGS --cloud-url $2"; shift 2 ;;
    --cloud-url=*) PREPARE_ARGS="$PREPARE_ARGS $1"; shift ;;
    --org)       PREPARE_ARGS="$PREPARE_ARGS --org $2"; shift 2 ;;
    --org=*)     PREPARE_ARGS="$PREPARE_ARGS $1"; shift ;;
    --token)     PREPARE_ARGS="$PREPARE_ARGS --token $2"; shift 2 ;;
    --token=*)   PREPARE_ARGS="$PREPARE_ARGS $1"; shift ;;
    *)           shift ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
INSTALL_DIR="$REPO_ROOT/dist/install"

# Always re-prepare to ensure served files are in sync with source
bash "$SCRIPT_DIR/prepare-local-install.sh" --port "$PORT" $PREPARE_ARGS
echo ""

echo "Serving dist/install/ on http://localhost:$PORT"
echo ""
echo "  Test with (download then execute — required for SentinelOne):"
echo ""
echo "    curl -fsSL http://localhost:$PORT/install.sh -o /tmp/agenshield-install.sh && bash /tmp/agenshield-install.sh"
echo ""
echo "  Note: curl|bash is blocked by SentinelOne for non-notarized local builds."
echo "  Production CI builds are notarized and support curl|bash directly."
echo ""
echo "Press Ctrl+C to stop."
echo ""

cd "$INSTALL_DIR"
python3 -m http.server "$PORT"
