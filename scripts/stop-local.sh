#!/bin/bash
# =============================================================================
# Decentralized Health DB - Stop Local Development Services
#
# Stops all services started by start-local.sh
#
# Usage: ./scripts/stop-local.sh
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PIDS_DIR="${PROJECT_ROOT}/pids"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo "=============================================================="
echo "Stopping Decentralized Health DB services..."
echo "=============================================================="
echo ""

# Stop Frontend
if [ -f "${PIDS_DIR}/frontend.pid" ]; then
    PID=$(cat "${PIDS_DIR}/frontend.pid")
    if kill -0 "${PID}" 2>/dev/null; then
        log_info "Stopping Frontend (PID ${PID})..."
        kill "${PID}" 2>/dev/null || true
    fi
    rm -f "${PIDS_DIR}/frontend.pid"
fi

# Stop Backend
if [ -f "${PIDS_DIR}/backend.pid" ]; then
    PID=$(cat "${PIDS_DIR}/backend.pid")
    if kill -0 "${PID}" 2>/dev/null; then
        log_info "Stopping Backend (PID ${PID})..."
        kill "${PID}" 2>/dev/null || true
    fi
    rm -f "${PIDS_DIR}/backend.pid"
fi

# Stop pyUmbral
if [ -f "${PIDS_DIR}/pyumbral.pid" ]; then
    PID=$(cat "${PIDS_DIR}/pyumbral.pid")
    if kill -0 "${PID}" 2>/dev/null; then
        log_info "Stopping pyUmbral (PID ${PID})..."
        kill "${PID}" 2>/dev/null || true
    fi
    rm -f "${PIDS_DIR}/pyumbral.pid"
fi

# Stop Docker containers
log_info "Stopping Docker containers..."
cd "${PROJECT_ROOT}"
docker compose stop vault ipfs 2>/dev/null || true

echo ""
log_info "All services stopped"
echo "=============================================================="
