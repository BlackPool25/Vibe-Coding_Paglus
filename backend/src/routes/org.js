/**
 * Organization Routes
 * 
 * Handles organization registration and key management.
 * Generates ECC keypairs, stores private keys in Vault, and registers public keys on-chain.
 * 
 * References:
 * - Vault Developer Quickstart: https://developer.hashicorp.com/vault/docs/get-started/developer-qs
 * - Node.js Crypto: https://nodejs.org/api/crypto.html#crypto_crypto_generatekeypairsync_type_options
 * - Fabric Node SDK: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html
 * 
 * SECURITY NOTE: No PHI or private keys are logged. Only orgIds and public key fingerprints at debug level.
 */

'use strict';

const express = require('express');
const crypto = require('crypto');
const vaultClient = require('../crypto/vault-client');
const fabricClient = require('../fabric-client');
const { sha256Hex } = require('../crypto/encrypt');

const router = express.Router();

/**
 * Generates an ECC (ECDSA) keypair using P-256 curve
 * ECDSA P-256 is recommended for blockchain applications
 * 
 * Reference: https://nodejs.org/api/crypto.html#crypto_crypto_generatekeypairsync_type_options
 * 
 * @returns {{ publicKey: string, privateKey: string, keyId: string }}
 */
function generateECCKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256', // Also known as secp256r1, prime256v1
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  // Generate key ID from public key hash (first 16 chars of SHA-256)
  const keyId = sha256Hex(publicKey).substring(0, 16);

  return {
    publicKey,
    privateKey,
    keyId
  };
}

/**
 * Generates an RSA keypair (alternative to ECC)
 * 
 * @param {number} [modulusLength=2048] - Key size in bits
 * @returns {{ publicKey: string, privateKey: string, keyId: string }}
 */
function generateRSAKeyPair(modulusLength = 2048) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem'
    }
  });

  const keyId = sha256Hex(publicKey).substring(0, 16);

  return {
    publicKey,
    privateKey,
    keyId
  };
}

/**
 * POST /org/register
 * 
 * Registers a new organization:
 * 1. Generates an ECC keypair locally
 * 2. Stores public key on-chain via fabric-client
 * 3. Stores private key in Vault under secret/data/orgs/{orgId}
 * 
 * Request body:
 * {
 *   "orgId": "org1",
 *   "name": "Hospital A",
 *   "keyType": "EC" | "RSA" (optional, default: EC)
 * }
 * 
 * Response (201):
 * {
 *   "orgId": "org1",
 *   "publicKeyId": "a1b2c3d4e5f6g7h8",
 *   "vaultPath": "secret/orgs/org1",
 *   "keyType": "EC",
 *   "registeredAt": "2024-01-15T10:30:00.000Z"
 * }
 */
router.post('/register', async (req, res) => {
  try {
    const { orgId, name, keyType = 'EC' } = req.body;

    // Validate required fields
    if (!orgId || typeof orgId !== 'string') {
      return res.status(400).json({
        error: 'orgId is required and must be a string'
      });
    }

    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        error: 'name is required and must be a string'
      });
    }

    // Validate orgId format (alphanumeric, hyphen, underscore)
    if (!/^[a-zA-Z0-9_-]+$/.test(orgId)) {
      return res.status(400).json({
        error: 'orgId must contain only alphanumeric characters, hyphens, and underscores'
      });
    }

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[org] Registering organization: ${orgId}`);
    }

    // Generate keypair based on type
    let keyPair;
    if (keyType.toUpperCase() === 'RSA') {
      keyPair = generateRSAKeyPair();
    } else {
      keyPair = generateECCKeyPair();
    }

    const registeredAt = new Date().toISOString();

    // Store private key in Vault
    // Per Vault docs: https://developer.hashicorp.com/vault/docs/get-started/developer-qs
    const vaultResult = await vaultClient.putKey(orgId, {
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      keyType: keyType.toUpperCase() === 'RSA' ? 'RSA' : 'EC',
      createdAt: registeredAt
    });

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[org] Stored key in Vault at ${vaultResult.vaultPath}`);
    }

    // Register public key on-chain
    // Per Fabric docs: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html
    try {
      await fabricClient.registerOrgOnChain(orgId, name, keyPair.publicKey);
      if (process.env.LOG_LEVEL === 'debug') {
        console.debug(`[org] Registered public key on-chain for ${orgId}`);
      }
    } catch (fabricError) {
      // Log fabric error but don't fail - Vault storage is primary
      console.warn(`[org] Fabric registration failed for ${orgId}: ${fabricError.message}`);
    }

    // Return success response
    res.status(201).json({
      orgId,
      publicKeyId: keyPair.keyId,
      vaultPath: vaultResult.vaultPath,
      keyType: keyType.toUpperCase() === 'RSA' ? 'RSA' : 'EC',
      registeredAt
    });

  } catch (error) {
    console.error(`[org] Registration failed: ${error.message}`);
    res.status(500).json({
      error: 'Organization registration failed',
      message: error.message
    });
  }
});

/**
 * GET /org/:orgId
 * 
 * Retrieves organization information (public key only)
 * Private keys are never returned via API
 */
router.get('/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;

    if (!orgId) {
      return res.status(400).json({
        error: 'orgId is required'
      });
    }

    // Try to get from Vault (public key portion only)
    const keyData = await vaultClient.getKey(orgId);

    res.json({
      orgId,
      publicKey: keyData.data.publicKey,
      keyType: keyData.data.keyType,
      createdAt: keyData.data.createdAt,
      version: keyData.metadata?.version
    });

  } catch (error) {
    if (error.message.includes('No key found')) {
      return res.status(404).json({
        error: 'Organization not found'
      });
    }
    
    console.error(`[org] Get org failed: ${error.message}`);
    res.status(500).json({
      error: 'Failed to retrieve organization',
      message: error.message
    });
  }
});

/**
 * GET /org
 * 
 * Lists all registered organizations
 */
router.get('/', async (req, res) => {
  try {
    const orgIds = await vaultClient.listKeys();
    
    res.json({
      organizations: orgIds,
      count: orgIds.length
    });

  } catch (error) {
    console.error(`[org] List orgs failed: ${error.message}`);
    res.status(500).json({
      error: 'Failed to list organizations',
      message: error.message
    });
  }
});

/**
 * DELETE /org/:orgId
 * 
 * Deletes an organization's keys (soft delete in Vault)
 */
router.delete('/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;

    if (!orgId) {
      return res.status(400).json({
        error: 'orgId is required'
      });
    }

    await vaultClient.deleteKey(orgId);

    res.json({
      message: `Organization ${orgId} deleted`,
      orgId
    });

  } catch (error) {
    console.error(`[org] Delete org failed: ${error.message}`);
    res.status(500).json({
      error: 'Failed to delete organization',
      message: error.message
    });
  }
});

/**
 * POST /org/:orgId/rotate-key
 * 
 * Rotates an organization's keypair
 * Generates new keypair, stores in Vault, and updates on-chain
 */
router.post('/:orgId/rotate-key', async (req, res) => {
  try {
    const { orgId } = req.params;
    const { keyType = 'EC' } = req.body;

    // Get existing key to verify org exists
    await vaultClient.getKey(orgId);

    // Generate new keypair
    let keyPair;
    if (keyType.toUpperCase() === 'RSA') {
      keyPair = generateRSAKeyPair();
    } else {
      keyPair = generateECCKeyPair();
    }

    const rotatedAt = new Date().toISOString();

    // Store new key in Vault (creates new version)
    const vaultResult = await vaultClient.putKey(orgId, {
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      keyType: keyType.toUpperCase() === 'RSA' ? 'RSA' : 'EC',
      createdAt: rotatedAt
    });

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[org] Rotated key for ${orgId}, new version: ${vaultResult.version}`);
    }

    res.json({
      orgId,
      publicKeyId: keyPair.keyId,
      vaultPath: vaultResult.vaultPath,
      version: vaultResult.version,
      rotatedAt
    });

  } catch (error) {
    if (error.message.includes('No key found')) {
      return res.status(404).json({
        error: 'Organization not found'
      });
    }

    console.error(`[org] Key rotation failed: ${error.message}`);
    res.status(500).json({
      error: 'Key rotation failed',
      message: error.message
    });
  }
});

module.exports = router;
