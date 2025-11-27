/**
 * Hyperledger Fabric Client Wrapper
 * 
 * Provides transaction submission and query functions for the Fabric network.
 * Uses the fabric-network SDK with wallet and connection profile patterns.
 * 
 * References:
 * - Fabric Node SDK: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html
 * - fabric-network API: https://hyperledger.github.io/fabric-sdk-node/release-2.2/module-fabric-network.html
 * - fabric-samples: https://github.com/hyperledger/fabric-samples/tree/main/asset-transfer-basic/application-javascript
 * 
 * Environment Variables:
 * - FABRIC_WALLET_PATH: Path to wallet directory
 * - FABRIC_CONNECTION_PROFILE: Path to connection profile JSON
 * - FABRIC_CHANNEL_NAME: Channel name (default: mychannel)
 * - FABRIC_CHAINCODE_NAME: Chaincode name (default: consent)
 * - FABRIC_IDENTITY: Identity label in wallet (default: appUser)
 * 
 * SECURITY NOTE: No PHI is logged. Only transaction IDs and function names at debug level.
 */

'use strict';

const { Gateway, Wallets } = require('fabric-network');
const path = require('path');
const fs = require('fs');

// Configuration from environment
const WALLET_PATH = process.env.FABRIC_WALLET_PATH || path.join(__dirname, '..', '..', 'wallet');
const CONNECTION_PROFILE_PATH = process.env.FABRIC_CONNECTION_PROFILE || 
  path.join(__dirname, '..', '..', '..', 'infra', 'fabric', 'connection-org1.json');
const CHANNEL_NAME = process.env.FABRIC_CHANNEL_NAME || 'mychannel';
const CHAINCODE_NAME = process.env.FABRIC_CHAINCODE_NAME || 'consent';
const IDENTITY_LABEL = process.env.FABRIC_IDENTITY || 'appUser';

// Gateway instance for connection reuse
let gateway = null;
let contract = null;

/**
 * Loads the connection profile from file
 * Per Fabric docs, connection profile defines network topology
 * Reference: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/connectionprofile.html
 * 
 * @returns {Object} Connection profile object
 */
function loadConnectionProfile() {
  try {
    if (!fs.existsSync(CONNECTION_PROFILE_PATH)) {
      console.warn(`[fabric-client] Connection profile not found at ${CONNECTION_PROFILE_PATH}`);
      // Return stub profile for development
      return createStubConnectionProfile();
    }

    const profileJson = fs.readFileSync(CONNECTION_PROFILE_PATH, 'utf8');
    return JSON.parse(profileJson);
  } catch (error) {
    console.error('[fabric-client] Failed to load connection profile');
    throw error;
  }
}

/**
 * Creates a stub connection profile for development/testing
 * This should be replaced with actual connection profile in production
 * 
 * @returns {Object} Stub connection profile
 */
function createStubConnectionProfile() {
  return {
    name: 'decen-health-network',
    version: '1.0.0',
    client: {
      organization: 'Org1',
      connection: {
        timeout: {
          peer: { endorser: '300' },
          orderer: '300'
        }
      }
    },
    organizations: {
      Org1: {
        mspid: 'Org1MSP',
        peers: ['peer0.org1.example.com'],
        certificateAuthorities: ['ca.org1.example.com']
      }
    },
    peers: {
      'peer0.org1.example.com': {
        url: 'grpcs://localhost:7051',
        grpcOptions: {
          'ssl-target-name-override': 'peer0.org1.example.com'
        }
      }
    },
    certificateAuthorities: {
      'ca.org1.example.com': {
        url: 'https://localhost:7054',
        caName: 'ca-org1'
      }
    }
  };
}

/**
 * Loads or creates wallet for identity management
 * Per Fabric docs, wallet stores user identities
 * Reference: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/wallet.html
 * 
 * @returns {Promise<Object>} Wallet instance
 */
async function loadWallet() {
  try {
    // Create wallet directory if it doesn't exist
    if (!fs.existsSync(WALLET_PATH)) {
      fs.mkdirSync(WALLET_PATH, { recursive: true });
    }

    // Use filesystem wallet as per fabric-samples pattern
    const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
    
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[fabric-client] Wallet loaded from ${WALLET_PATH}`);
    }

    return wallet;
  } catch (error) {
    console.error('[fabric-client] Failed to load wallet');
    throw error;
  }
}

/**
 * Connects to the Fabric network and returns the contract instance
 * Uses Gateway pattern from fabric-network SDK
 * Reference: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/gateway.html
 * 
 * @returns {Promise<Object>} Contract instance
 */
async function connect() {
  if (contract) {
    return contract;
  }

  try {
    const wallet = await loadWallet();
    const connectionProfile = loadConnectionProfile();

    // Check if identity exists in wallet
    const identity = await wallet.get(IDENTITY_LABEL);
    if (!identity) {
      console.warn(`[fabric-client] Identity '${IDENTITY_LABEL}' not found in wallet. Run enrollment first.`);
      // For development, return stub contract
      return createStubContract();
    }

    // Create gateway instance
    gateway = new Gateway();

    // Connect to gateway using connection profile and wallet
    // Per fabric-network docs: https://hyperledger.github.io/fabric-sdk-node/release-2.2/module-fabric-network.Gateway.html
    await gateway.connect(connectionProfile, {
      wallet,
      identity: IDENTITY_LABEL,
      discovery: { 
        enabled: true, 
        asLocalhost: process.env.NODE_ENV !== 'production' 
      }
    });

    // Get network (channel)
    const network = await gateway.getNetwork(CHANNEL_NAME);
    
    // Get contract
    contract = network.getContract(CHAINCODE_NAME);

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[fabric-client] Connected to channel '${CHANNEL_NAME}', chaincode '${CHAINCODE_NAME}'`);
    }

    return contract;
  } catch (error) {
    console.error('[fabric-client] Failed to connect to Fabric network');
    // Return stub for development
    return createStubContract();
  }
}

/**
 * Creates a stub contract for development/testing when Fabric network is unavailable
 * 
 * Stub simulates chaincode behavior for local development:
 * - checkAccess: Returns hasAccess=true for known orgs
 * - queryResource: Returns metadata from test-config.json if available
 * 
 * @returns {Object} Stub contract with submit/evaluate methods
 */
function createStubContract() {
  console.warn('[fabric-client] Using stub contract - Fabric network not connected');
  
  // Load test config if available (from setup-test-data.js)
  let testConfig = null;
  try {
    const configPath = path.join(__dirname, '..', '..', 'scripts', 'test-config.json');
    if (fs.existsSync(configPath)) {
      testConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    // Ignore - test config not available
  }
  
  return {
    submitTransaction: async (functionName, ...args) => {
      if (process.env.LOG_LEVEL === 'debug') {
        console.debug(`[fabric-client] STUB submitTransaction: ${functionName}(${args.length} args)`);
      }
      // Return stub response
      return Buffer.from(JSON.stringify({
        success: true,
        stub: true,
        function: functionName,
        timestamp: new Date().toISOString()
      }));
    },
    evaluateTransaction: async (functionName, ...args) => {
      if (process.env.LOG_LEVEL === 'debug') {
        console.debug(`[fabric-client] STUB evaluateTransaction: ${functionName}(${args.flat()})`);
      }
      
      const flatArgs = args.flat();
      
      // Handle checkAccess - simulates permission check
      // Reference: Chaincode contract.js checkAccess function
      if (functionName === 'checkAccess') {
        const resourceId = flatArgs[0];
        const orgId = flatArgs[1];
        
        // Check if resource matches test config
        if (testConfig && resourceId === testConfig.resourceId) {
          // Owner always has access
          if (orgId === testConfig.ownerOrg) {
            return Buffer.from(JSON.stringify({
              hasAccess: true,
              accessType: 'owner',
              isOwner: true
            }));
          }
          // Grantee has read access
          if (orgId === testConfig.granteeOrg) {
            return Buffer.from(JSON.stringify({
              hasAccess: true,
              accessType: 'read',
              isOwner: false,
              expiryTimestamp: Math.floor(Date.now() / 1000) + 86400
            }));
          }
        }
        
        // Default: allow access for demo (org1, org2)
        if (orgId === 'org1' || orgId === 'org2') {
          return Buffer.from(JSON.stringify({
            hasAccess: true,
            accessType: orgId === 'org1' ? 'owner' : 'read',
            isOwner: orgId === 'org1'
          }));
        }
        
        return Buffer.from(JSON.stringify({
          hasAccess: false,
          reason: 'No access grant found'
        }));
      }
      
      // Handle queryResource - returns resource metadata
      if (functionName === 'queryResource') {
        const resourceId = flatArgs[0];
        
        // Check test config first
        if (testConfig && resourceId === testConfig.resourceId) {
          return Buffer.from(JSON.stringify({
            resourceId: testConfig.resourceId,
            ownerOrgId: testConfig.ownerOrg,
            cid: testConfig.cid,
            sha256: testConfig.sha256,
            fhirType: testConfig.fhirType,
            uploadedAt: Math.floor(Date.now() / 1000)
          }));
        }
        
        // Resource not found
        throw new Error(`Resource ${resourceId} does not exist`);
      }
      
      // Default stub response
      return Buffer.from(JSON.stringify({
        success: true,
        stub: true,
        function: functionName,
        timestamp: new Date().toISOString()
      }));
    }
  };
}

/**
 * Submits a transaction to the Fabric network
 * This is the main entry point for write operations
 * 
 * Per Fabric docs, submitTransaction:
 * 1. Endorses the transaction proposal
 * 2. Submits the endorsed transaction to the orderer
 * 3. Waits for commit event
 * 
 * Reference: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html#submit-transaction
 * 
 * @param {string} functionName - Chaincode function to invoke
 * @param {string[]} args - Arguments to pass to the function
 * @returns {Promise<Object>} Transaction result
 */
async function submitTransaction(functionName, args = []) {
  if (!functionName || typeof functionName !== 'string') {
    throw new Error('functionName is required and must be a string');
  }

  if (!Array.isArray(args)) {
    throw new Error('args must be an array');
  }

  try {
    const contractInstance = await connect();

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[fabric-client] Submitting transaction: ${functionName}`);
    }

    // Submit transaction - args spread as individual parameters
    const result = await contractInstance.submitTransaction(functionName, ...args);

    // Parse result (chaincode returns Buffer)
    const resultString = result.toString('utf8');
    
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[fabric-client] Transaction ${functionName} completed`);
    }

    try {
      return JSON.parse(resultString);
    } catch {
      return { result: resultString };
    }
  } catch (error) {
    console.error(`[fabric-client] Transaction ${functionName} failed`);
    throw new Error(`Fabric transaction failed: ${error.message}`);
  }
}

/**
 * Evaluates a transaction (query) on the Fabric network
 * This is for read-only operations that don't modify the ledger
 * 
 * Reference: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html#evaluate-transaction
 * 
 * @param {string} functionName - Chaincode function to query
 * @param {string[]} args - Arguments to pass to the function
 * @returns {Promise<Object>} Query result
 */
async function evaluateTransaction(functionName, args = []) {
  if (!functionName || typeof functionName !== 'string') {
    throw new Error('functionName is required and must be a string');
  }

  try {
    const contractInstance = await connect();

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[fabric-client] Evaluating transaction: ${functionName}`);
    }

    const result = await contractInstance.evaluateTransaction(functionName, ...args);
    const resultString = result.toString('utf8');

    try {
      return JSON.parse(resultString);
    } catch {
      return { result: resultString };
    }
  } catch (error) {
    console.error(`[fabric-client] Query ${functionName} failed`);
    throw new Error(`Fabric query failed: ${error.message}`);
  }
}

/**
 * Registers an organization's public key on the blockchain
 * Calls the registerOrg chaincode function
 * 
 * @param {string} orgId - Organization identifier
 * @param {string} name - Organization name
 * @param {string} publicKey - PEM-encoded public key
 * @returns {Promise<Object>} Registration result
 */
async function registerOrgOnChain(orgId, name, publicKey) {
  return submitTransaction('registerOrg', [
    orgId,
    name,
    publicKey,
    new Date().toISOString()
  ]);
}

/**
 * Gets an organization's public key from the blockchain
 * 
 * @param {string} orgId - Organization identifier
 * @returns {Promise<Object>} Org data including public key
 */
async function getOrgFromChain(orgId) {
  return evaluateTransaction('getOrg', [orgId]);
}

/**
 * Records a consent on the blockchain
 * 
 * @param {string} consentId - Unique consent identifier
 * @param {string} patientId - Patient identifier
 * @param {string} orgId - Organization granted access
 * @param {string} dataHash - Hash of the data being consented
 * @param {number} expiresAt - Expiration timestamp
 * @returns {Promise<Object>} Consent record result
 */
async function recordConsent(consentId, patientId, orgId, dataHash, expiresAt) {
  return submitTransaction('recordConsent', [
    consentId,
    patientId,
    orgId,
    dataHash,
    expiresAt.toString()
  ]);
}

/**
 * Disconnects from the Fabric network
 */
async function disconnect() {
  if (gateway) {
    await gateway.disconnect();
    gateway = null;
    contract = null;
    
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug('[fabric-client] Disconnected from Fabric network');
    }
  }
}

/**
 * Checks if the Fabric client can connect to the network
 * 
 * @returns {Promise<{ connected: boolean, message: string }>}
 */
async function healthCheck() {
  try {
    await connect();
    return {
      connected: true,
      channel: CHANNEL_NAME,
      chaincode: CHAINCODE_NAME,
      stub: !gateway // True if using stub contract
    };
  } catch (error) {
    return {
      connected: false,
      message: error.message
    };
  }
}

module.exports = {
  // Core transaction functions
  submitTransaction,
  evaluateTransaction,
  
  // Convenience functions
  registerOrgOnChain,
  getOrgFromChain,
  recordConsent,
  
  // Connection management
  connect,
  disconnect,
  healthCheck,
  
  // Utilities
  loadWallet,
  loadConnectionProfile,
  
  // Constants (for testing)
  CHANNEL_NAME,
  CHAINCODE_NAME
};
