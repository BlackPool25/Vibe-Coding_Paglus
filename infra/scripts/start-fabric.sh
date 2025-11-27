#!/bin/bash
# =============================================================================
# Hyperledger Fabric Test Network Startup Script
# 
# Official Repository: https://github.com/hyperledger/fabric-samples
# Documentation: https://hyperledger-fabric.readthedocs.io/en/latest/test_network.html
# 
# Prerequisites (per official docs):
# - Docker and Docker Compose
# - Go 1.21.x (for chaincode)
# - Node.js 18+ (for Node.js chaincode/SDK)
# - Git
# =============================================================================

set -e

# Configuration
FABRIC_SAMPLES_REPO="https://github.com/hyperledger/fabric-samples.git"
FABRIC_SAMPLES_TAG="v2.5.4"  # Pin to specific release for reproducibility
FABRIC_PATH="${FABRIC_PATH:-$(pwd)/fabric-samples}"

echo "=============================================================="
echo "Hyperledger Fabric Test Network Setup"
echo "=============================================================="
echo ""
echo "Using fabric-samples repo: ${FABRIC_SAMPLES_REPO}"
echo "Tag/Version: ${FABRIC_SAMPLES_TAG}"
echo "Target path: ${FABRIC_PATH}"
echo ""

# Check prerequisites
check_prereqs() {
    echo "[1/4] Checking prerequisites..."
    
    if ! command -v docker &> /dev/null; then
        echo "ERROR: Docker is not installed. Please install Docker first."
        echo "See: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    if ! command -v git &> /dev/null; then
        echo "ERROR: Git is not installed. Please install Git first."
        exit 1
    fi
    
    echo "  ✓ Docker: $(docker --version)"
    echo "  ✓ Git: $(git --version)"
    echo ""
}

# Clone fabric-samples if not present
clone_fabric_samples() {
    echo "[2/4] Cloning fabric-samples repository..."
    
    if [ -d "${FABRIC_PATH}" ]; then
        echo "  fabric-samples already exists at ${FABRIC_PATH}"
        echo "  To re-clone, remove the directory first: rm -rf ${FABRIC_PATH}"
    else
        # Clone with specific tag per official docs
        # https://hyperledger-fabric.readthedocs.io/en/latest/install.html
        git clone --depth 1 --branch "${FABRIC_SAMPLES_TAG}" "${FABRIC_SAMPLES_REPO}" "${FABRIC_PATH}"
        echo "  ✓ Cloned fabric-samples ${FABRIC_SAMPLES_TAG}"
    fi
    echo ""
}

# Download Fabric binaries and Docker images
download_fabric_binaries() {
    echo "[3/4] Downloading Fabric binaries and Docker images..."
    echo "  This uses the official bootstrap script from fabric-samples."
    echo "  Docs: https://hyperledger-fabric.readthedocs.io/en/latest/install.html"
    echo ""
    
    cd "${FABRIC_PATH}"
    
    # The bootstrap.sh script downloads binaries and pulls Docker images
    # Usage: ./install-fabric.sh [docker|binary|samples] [version]
    # For v2.5.x, use the install-fabric.sh script
    if [ -f "install-fabric.sh" ]; then
        # New method (v2.5+)
        chmod +x install-fabric.sh
        ./install-fabric.sh docker binary
    elif [ -f "scripts/bootstrap.sh" ]; then
        # Legacy method
        chmod +x scripts/bootstrap.sh
        ./scripts/bootstrap.sh
    else
        echo "  Downloading install script..."
        curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
        chmod +x install-fabric.sh
        ./install-fabric.sh docker binary
    fi
    
    echo "  ✓ Fabric binaries and Docker images downloaded"
    echo ""
}

# Print instructions for starting the test network
print_instructions() {
    echo "[4/4] Fabric Test Network Ready!"
    echo ""
    echo "=============================================================="
    echo "TO START THE FABRIC TEST NETWORK:"
    echo "=============================================================="
    echo ""
    echo "  cd ${FABRIC_PATH}/test-network"
    echo ""
    echo "  # Bring up the network with Certificate Authorities and create a channel"
    echo "  # Docs: https://hyperledger-fabric.readthedocs.io/en/latest/test_network.html"
    echo "  ./network.sh up createChannel -ca"
    echo ""
    echo "  # To deploy chaincode (e.g., JavaScript chaincode):"
    echo "  ./network.sh deployCC -ccn basic -ccp ../asset-transfer-basic/chaincode-javascript -ccl javascript"
    echo ""
    echo "  # To bring down the network:"
    echo "  ./network.sh down"
    echo ""
    echo "=============================================================="
    echo "ENVIRONMENT VARIABLES FOR SDK:"
    echo "=============================================================="
    echo ""
    echo "  export FABRIC_PATH=${FABRIC_PATH}"
    echo "  export PATH=\${FABRIC_PATH}/bin:\$PATH"
    echo "  export FABRIC_CFG_PATH=\${FABRIC_PATH}/config"
    echo ""
    echo "=============================================================="
}

# Main execution
main() {
    check_prereqs
    clone_fabric_samples
    download_fabric_binaries
    print_instructions
}

# Run if executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
