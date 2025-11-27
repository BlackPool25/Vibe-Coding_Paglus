#!/bin/bash
# =============================================================================
# Decentralized Health DB - Local Development Startup Script
#
# Starts all services for local development:
# 1. Docker containers (Vault, IPFS)
# 2. Fabric test network (if available)
# 3. Backend (Node.js)
# 4. pyUmbral service (FastAPI)
# 5. Frontend (Vite dev server)
#
# Usage: ./scripts/start-local.sh
#
# References:
# - Docker Compose: https://docs.docker.com/compose/
# - Vault Dev Server: https://developer.hashicorp.com/vault/docs/concepts/dev-server
# - IPFS Docker: https://docs.ipfs.tech/install/run-ipfs-inside-docker/
# =============================================================================

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
PIDS_DIR="${PROJECT_ROOT}/pids"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Ensure pids directory exists
mkdir -p "${PIDS_DIR}"

echo "=============================================================="
echo "Decentralized Health DB - Local Development Startup"
echo "=============================================================="
echo ""

# =============================================================================
# Step 1: Start Docker containers (Vault, IPFS)
# =============================================================================
log_info "Starting Docker containers (Vault, IPFS)..."

cd "${PROJECT_ROOT}"

if ! command -v docker &> /dev/null; then
    log_error "Docker is not installed. Please install Docker first."
    exit 1
fi

# Start Vault and IPFS containers
docker compose up -d vault ipfs

# Wait for Vault to be ready
log_info "Waiting for Vault to be ready..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:8200/v1/sys/health > /dev/null 2>&1; then
        log_info "Vault is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        log_error "Vault failed to start within 30 seconds"
        exit 1
    fi
    sleep 1
done

# Wait for IPFS to be ready
log_info "Waiting for IPFS to be ready..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:5001/api/v0/id > /dev/null 2>&1; then
        log_info "IPFS is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        log_warn "IPFS not ready (may use web3.storage fallback)"
    fi
    sleep 1
done

# =============================================================================
# Step 2: Start Fabric test network (optional)
# =============================================================================
log_info "Checking Fabric test network..."

FABRIC_SCRIPT="${PROJECT_ROOT}/infra/scripts/start-fabric.sh"
if [ -f "${FABRIC_SCRIPT}" ]; then
    log_info "Fabric startup script found. Run manually if needed:"
    echo "    cd infra && bash scripts/start-fabric.sh"
    echo ""
else
    log_warn "Fabric scripts not found. Backend will use stub chaincode."
fi

# =============================================================================
# Step 3: Start pyUmbral service
# =============================================================================
log_info "Starting pyUmbral service..."

PYUMBRAL_DIR="${PROJECT_ROOT}/pyumbral-service"
PYUMBRAL_PID_FILE="${PIDS_DIR}/pyumbral.pid"
PYUMBRAL_LOG="${PIDS_DIR}/pyumbral.log"

if [ -f "${PYUMBRAL_PID_FILE}" ]; then
    EXISTING_PID=$(cat "${PYUMBRAL_PID_FILE}")
    if kill -0 "${EXISTING_PID}" 2>/dev/null; then
        log_info "pyUmbral already running (PID ${EXISTING_PID})"
    else
        rm -f "${PYUMBRAL_PID_FILE}"
    fi
fi

if [ ! -f "${PYUMBRAL_PID_FILE}" ]; then
    cd "${PYUMBRAL_DIR}"
    
    # Check if venv exists, create if not
    if [ ! -d "venv" ]; then
        log_info "Creating Python virtual environment..."
        python -m venv venv
        source venv/bin/activate
        pip install -r requirements.txt
    else
        source venv/bin/activate
    fi
    
    # Start pyUmbral with uvicorn
    export VAULT_ADDR="http://127.0.0.1:8200"
    export VAULT_TOKEN="dev-root-token"
    
    nohup uvicorn app:app --host 0.0.0.0 --port 8000 > "${PYUMBRAL_LOG}" 2>&1 &
    echo $! > "${PYUMBRAL_PID_FILE}"
    
    log_info "pyUmbral started (PID $(cat ${PYUMBRAL_PID_FILE}))"
    log_info "  Log: ${PYUMBRAL_LOG}"
    log_info "  URL: http://127.0.0.1:8000"
    
    deactivate
fi

# =============================================================================
# Step 4: Start Backend
# =============================================================================
log_info "Starting Backend..."

cd "${PROJECT_ROOT}/backend"

# Set environment variables
export VAULT_TOKEN="dev-root-token"
export VAULT_ADDR="http://127.0.0.1:8200"
export IPFS_API="http://127.0.0.1:5001"
export PYUMBRAL_SERVICE_URL="http://127.0.0.1:8000"
export LOG_LEVEL="debug"
export PORT="4000"

# Use the background start script
node scripts/start-background.js

# Wait for backend health check
log_info "Waiting for backend to be ready..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:4000/health > /dev/null 2>&1; then
        log_info "Backend is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        log_error "Backend failed to start within 30 seconds"
        log_error "Check logs: ${PIDS_DIR}/backend.log"
        exit 1
    fi
    sleep 1
done

# =============================================================================
# Step 5: Start Frontend
# =============================================================================
log_info "Starting Frontend..."

FRONTEND_DIR="${PROJECT_ROOT}/frontend"
FRONTEND_PID_FILE="${PIDS_DIR}/frontend.pid"
FRONTEND_LOG="${PIDS_DIR}/frontend.log"

if [ -f "${FRONTEND_PID_FILE}" ]; then
    EXISTING_PID=$(cat "${FRONTEND_PID_FILE}")
    if kill -0 "${EXISTING_PID}" 2>/dev/null; then
        log_info "Frontend already running (PID ${EXISTING_PID})"
    else
        rm -f "${FRONTEND_PID_FILE}"
    fi
fi

if [ ! -f "${FRONTEND_PID_FILE}" ]; then
    cd "${FRONTEND_DIR}"
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        log_info "Installing frontend dependencies..."
        npm install
    fi
    
    # Start Vite dev server
    nohup npm run dev > "${FRONTEND_LOG}" 2>&1 &
    echo $! > "${FRONTEND_PID_FILE}"
    
    log_info "Frontend started (PID $(cat ${FRONTEND_PID_FILE}))"
    log_info "  Log: ${FRONTEND_LOG}"
    log_info "  URL: http://localhost:3000"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=============================================================="
echo "All services started!"
echo "=============================================================="
echo ""
echo "Services:"
echo "  Vault:     http://127.0.0.1:8200"
echo "  IPFS API:  http://127.0.0.1:5001"
echo "  IPFS GW:   http://127.0.0.1:8080"
echo "  pyUmbral:  http://127.0.0.1:8000"
echo "  Backend:   http://127.0.0.1:4000"
echo "  Frontend:  http://localhost:3000"
echo ""
echo "Quick commands:"
echo "  Health:    curl http://localhost:4000/health"
echo "  Status:    curl http://localhost:4000/debug/status"
echo "  Stop all:  ./scripts/stop-local.sh"
echo ""
echo "PID files stored in: ${PIDS_DIR}"
echo "=============================================================="
