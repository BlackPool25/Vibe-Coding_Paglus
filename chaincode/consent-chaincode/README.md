# Consent Chaincode

Hyperledger Fabric chaincode for healthcare consent management. This chaincode stores **only metadata** (no PHI - Protected Health Information). All actual health data is stored off-chain (IPFS) and referenced by CID.

## References

- **Fabric Chaincode Node API**: https://hyperledger.github.io/fabric-chaincode-node/main/api/
- **Fabric Chaincode Developer Guide**: https://hyperledger-fabric.readthedocs.io/en/latest/chaincode4ade.html
- **Fabric Samples**: https://github.com/hyperledger/fabric-samples

## Functions

| Function | Description |
|----------|-------------|
| `registerOrg(orgId, orgMeta)` | Register a new organization |
| `uploadMeta(resourceId, ownerOrgId, cid, sha256, fhirType)` | Upload resource metadata (IPFS CID reference) |
| `grantAccess(resourceId, granteeOrgId, expiryTimestamp, accessType)` | Grant access to a resource |
| `revokeAccess(resourceId, granteeOrgId)` | Revoke access to a resource |
| `logAccess(resourceId, actorOrgId, action, timestamp)` | Log an access event |
| `queryResource(resourceId)` | Query resource metadata |
| `queryOrg(orgId)` | Query organization |
| `queryAccess(resourceId, granteeOrgId)` | Query access grant |
| `checkAccess(resourceId, orgId)` | Check if org has valid access |

## Events

The chaincode emits the following events:
- `AccessGranted` - When access is granted
- `AccessRevoked` - When access is revoked
- `AccessLogged` - When an access event is logged

## Development

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

### Install Dependencies

```bash
cd chaincode/consent-chaincode
npm install
```

### Run Unit Tests

```bash
npm test
```

## Deployment to Fabric Test Network

### Prerequisites

1. Clone fabric-samples repository:
   ```bash
   git clone https://github.com/hyperledger/fabric-samples.git
   cd fabric-samples
   ```

2. Install Fabric binaries and Docker images (Reference: https://hyperledger-fabric.readthedocs.io/en/latest/install.html):
   ```bash
   curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.0 1.5.5
   ```

3. Start the test network (Reference: https://hyperledger-fabric.readthedocs.io/en/latest/test_network.html):
   ```bash
   cd test-network
   ./network.sh up createChannel -c mychannel -ca
   ```

### Deploy Chaincode

Reference: https://github.com/hyperledger/fabric-samples/tree/main/test-network#deploy-chaincode

From the `fabric-samples/test-network` directory, deploy the chaincode:

```bash
# Deploy the consent chaincode
# -ccn: chaincode name
# -ccp: chaincode path (relative to test-network directory)
# -ccl: chaincode language (node/javascript)
# -ccv: chaincode version
# -ccs: chaincode sequence

./network.sh deployCC \
  -ccn consent \
  -ccp ../../decen-health-db/chaincode/consent-chaincode \
  -ccl javascript \
  -ccv 1.0 \
  -ccs 1
```

### Invoke Chaincode

After deployment, you can invoke the chaincode using peer CLI:

```bash
# Set environment for Org1
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051

# Initialize ledger (optional)
peer chaincode invoke -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --tls --cafile "${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
  -C mychannel -n consent \
  --peerAddresses localhost:7051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" \
  -c '{"function":"initLedger","Args":[]}'

# Register an organization
peer chaincode invoke -o localhost:7050 \
  --ordererTLSHostnameOverride orderer.example.com \
  --tls --cafile "${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
  -C mychannel -n consent \
  --peerAddresses localhost:7051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" \
  -c '{"function":"registerOrg","Args":["hospital-001", "{\"name\":\"General Hospital\",\"type\":\"hospital\"}"]}'

# Query organization
peer chaincode query -C mychannel -n consent -c '{"Args":["queryOrg","hospital-001"]}'
```

### Tear Down

```bash
./network.sh down
```

## Package Versions

| Package | Version | Documentation |
|---------|---------|---------------|
| fabric-contract-api | 2.5.8 | https://www.npmjs.com/package/fabric-contract-api |
| fabric-shim | 2.5.8 | https://www.npmjs.com/package/fabric-shim |
| mocha | 10.2.0 | https://mochajs.org/ |
| chai | 4.3.10 | https://www.chaijs.com/ |
| sinon | 17.0.1 | https://sinonjs.org/ |

## License

Apache-2.0
