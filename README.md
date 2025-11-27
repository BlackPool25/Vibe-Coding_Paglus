# Decentralized Health Database (decen-health-db)

A blockchain-based health data management system using Hyperledger Fabric, IPFS, HashiCorp Vault, and proxy re-encryption (pyUmbral).

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Frontend     │────▶│     Backend     │────▶│  Fabric Network │
│   (React/Vite)  │     │   (Node.js 20)  │     │   (Chaincode)   │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
             ┌──────────┐  ┌──────────┐  ┌──────────┐
             │   Vault  │  │   IPFS   │  │ pyUmbral │
             │ (Secrets)│  │ (Storage)│  │  (PRE)   │
             └──────────┘  └──────────┘  └──────────┘
```

## Official Documentation References

| Component | Documentation |
|-----------|---------------|
| Hyperledger Fabric | https://hyperledger-fabric.readthedocs.io/ |
| Fabric Samples | https://github.com/hyperledger/fabric-samples |
| HashiCorp Vault | https://developer.hashicorp.com/vault/docs/get-started/developer-qs |
| IPFS (Kubo) | https://docs.ipfs.tech/ |
| pyUmbral | https://pyumbral.readthedocs.io/ |
| web3.storage | https://web3.storage/docs/ |

## Prerequisites

- **Docker** (v20.10+) and **Docker Compose** (v2.0+)
- **Git**
- **Node.js 20.x** (for local development)
- **Go 1.21+** (for Fabric chaincode)
- **Python 3.9+** (for pyUmbral service)
- **Bash** (for shell scripts; on Windows use WSL2 or Git Bash)

## Quick Start

### 1. Clone and Setup Environment

```bash
# Clone the repository
git clone <repo-url>
cd decen-health-db

# Copy environment template and configure
cp .env.example .env

# Edit .env with your values (see Environment Variables section below)
```

### 2. Start Core Infrastructure (Docker Compose)

```bash
# Start Vault, IPFS, and service stubs
docker compose up -d

# Check container status
docker compose ps

# Expected output:
# NAME                    STATUS
# decen-health-vault      running (healthy)
# decen-health-ipfs       running (healthy)
# decen-health-backend    running
# decen-health-frontend   running
```

### 3. Verify Infrastructure

#### Verify Vault (Dev Mode)

```bash
# Check Vault health endpoint
# Docs: https://developer.hashicorp.com/vault/docs/concepts/dev-server
curl http://localhost:8200/v1/sys/health

# Expected output (dev mode - unsealed):
# {
#   "initialized": true,
#   "sealed": false,
#   "standby": false,
#   "performance_standby": false,
#   "replication_performance_mode": "disabled",
#   "replication_dr_mode": "disabled",
#   "server_time_utc": ...,
#   "version": "1.15.x",
#   ...
# }
```

#### Verify IPFS Node

```bash
# Check IPFS node identity
# Docs: https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-id
docker exec decen-health-ipfs ipfs id

# Expected output (will include):
# {
#   "ID": "12D3KooW...",
#   "PublicKey": "...",
#   "Addresses": [...],
#   "AgentVersion": "kubo/0.24.0/...",
#   "Protocols": [...]
# }

# Or via API:
curl -X POST http://localhost:5001/api/v0/id
```

### 4. Start Hyperledger Fabric Test Network

```bash
# Make the script executable (Linux/macOS/WSL)
chmod +x infra/scripts/start-fabric.sh

# Run the Fabric setup script
./infra/scripts/start-fabric.sh

# The script will:
# 1. Clone fabric-samples from https://github.com/hyperledger/fabric-samples
# 2. Download Fabric binaries and Docker images
# 3. Print instructions for starting the test network

# After the script completes, start the test network:
cd fabric-samples/test-network
./network.sh up createChannel -ca

# Verify the network is running:
docker ps --filter "name=peer|orderer|ca"
```

## Environment Variables

Create a `.env` file from the template:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `VAULT_DEV_ROOT_TOKEN_ID` | Root token for Vault dev server | `dev-root-token` |
| `WEB3_STORAGE_TOKEN` | API token from https://web3.storage | (none - get from web3.storage) |
| `FABRIC_PATH` | Path to fabric-samples directory | `./fabric-samples` |

## Service Endpoints

| Service | URL | Description |
|---------|-----|-------------|
| Vault UI | http://localhost:8200/ui | Vault web interface (use root token to login) |
| Vault API | http://localhost:8200/v1/ | Vault HTTP API |
| IPFS API | http://localhost:5001 | IPFS Kubo RPC API |
| IPFS Gateway | http://localhost:8080 | IPFS HTTP Gateway |
| Backend API | http://localhost:3001 | Node.js backend (stub) |
| Frontend | http://localhost:3000 | React frontend (stub) |

## Project Structure

```
decen-health-db/
├── docker-compose.yml          # Core infrastructure (Vault, IPFS, stubs)
├── .env.example                 # Environment variables template
├── README.md                    # This file
├── backend/                     # Node.js backend service
│   ├── package.json
│   └── src/
├── frontend/                    # React frontend
│   ├── package.json
│   └── src/
├── chaincode/                   # Hyperledger Fabric chaincode
│   └── consent-chaincode/
├── pyumbral-service/            # Proxy re-encryption service
│   ├── app.py
│   └── requirements.txt
├── infra/
│   ├── fabric/                  # Fabric network config
│   └── scripts/
│       ├── start-fabric.sh      # Fabric test network setup
│       └── stop-fabric.sh       # Fabric test network teardown
├── sample-data/                 # Sample FHIR resources for testing
│   ├── fhir/
│   └── images/
└── tests/                       # Test suites
```

## Stopping Services

```bash
# Stop Docker Compose services
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v

# Stop Fabric test network
cd fabric-samples/test-network
./network.sh down
```

## Troubleshooting

### Vault not starting
- Ensure port 8200 is not in use: `netstat -an | grep 8200`
- Check logs: `docker logs decen-health-vault`

### IPFS not healthy
- IPFS may take 30-60 seconds to initialize
- Check logs: `docker logs decen-health-ipfs`
- Verify ports 4001, 5001, 8080 are available

### Fabric network issues
- Ensure Docker has at least 4GB RAM allocated
- Run `./network.sh down` before retrying `./network.sh up`
- Check Fabric docs: https://hyperledger-fabric.readthedocs.io/en/latest/test_network.html

## Next Steps

1. **Task 1**: Implement Vault secret storage for encryption keys
2. **Task 2**: Set up IPFS file upload/retrieval with CID pinning
3. **Task 3**: Deploy consent chaincode to Fabric network
4. **Task 4**: Implement pyUmbral proxy re-encryption service
5. **Task 5**: Build frontend patient portal and hospital upload pages

## License

MIT
