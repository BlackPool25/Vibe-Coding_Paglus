/**
 * Resource Retrieval Route - GET /resource/:id
 * 
 * Retrieves decrypted health resources with access control.
 * 
 * Flow:
 * 1. Query chaincode to verify caller org has permission (checkAccess)
 * 2. Fetch encrypted blob from IPFS/web3.storage by CID
 * 3. Retrieve encrypted symmetric key from Vault (owner/keys/<resId>)
 * 4. Obtain decryptable symmetric key via PRE (pyUmbral) or direct key
 * 5. Decrypt blob in memory and send as response stream
 * 
 * References:
 * - Hyperledger Fabric Node SDK: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html
 * - Vault KV v2 API: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2
 * - IPFS Gateway: https://docs.ipfs.tech/concepts/ipfs-gateway/
 * - pyUmbral: https://pyumbral.readthedocs.io/en/latest/api.html
 * - web3.storage: https://web3.storage/docs/
 * 
 * Environment Variables:
 * - PYUMBRAL_SERVICE_URL: URL for pyUmbral microservice (default: http://127.0.0.1:8000)
 * - IPFS_GATEWAY: IPFS gateway URL (default: http://127.0.0.1:8080)
 * - W3S_GATEWAY: web3.storage gateway (default: https://w3s.link)
 * 
 * SECURITY NOTE: No PHI or keys are logged. Only resource IDs and timing at debug level.
 */

'use strict';

const express = require('express');
const { Readable } = require('stream');

// Import local modules
const encrypt = require('../crypto/encrypt');
const vaultClient = require('../crypto/vault-client');
const fabricClient = require('../fabric-client');

const router = express.Router();

// Configuration from environment
const PYUMBRAL_SERVICE_URL = process.env.PYUMBRAL_SERVICE_URL || 'http://127.0.0.1:8000';
const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'http://127.0.0.1:8080';
const W3S_GATEWAY = process.env.W3S_GATEWAY || 'https://w3s.link';
const USE_LOCAL_IPFS = process.env.USE_LOCAL_IPFS === 'true';

// Content-Type mapping for FHIR resource types
const FHIR_CONTENT_TYPES = {
  'Patient': 'application/fhir+json',
  'Observation': 'application/fhir+json',
  'ImagingStudy': 'application/fhir+json',
  'DiagnosticReport': 'application/fhir+json',
  'Condition': 'application/fhir+json',
  'default': 'application/json'
};

/**
 * Fetches content from IPFS gateway
 * Uses local gateway for speed if available, otherwise web3.storage gateway
 * 
 * Per IPFS docs: https://docs.ipfs.tech/concepts/ipfs-gateway/
 * - Local gateway: http://127.0.0.1:8080/ipfs/<cid>
 * - Public gateway: https://w3s.link/ipfs/<cid>
 * 
 * @param {string} cid - IPFS Content Identifier
 * @param {boolean} [stream=false] - Return as stream for large files
 * @returns {Promise<Buffer|ReadableStream>}
 */
async function fetchFromIPFS(cid, stream = false) {
  const axios = (await import('axios')).default;
  
  // Prefer local gateway for speed (<2s target)
  // Per IPFS docs: https://docs.ipfs.tech/concepts/ipfs-gateway/#gateway-types
  const gateway = USE_LOCAL_IPFS ? IPFS_GATEWAY : W3S_GATEWAY;
  const url = `${gateway}/ipfs/${cid}`;

  const startTime = Date.now();
  
  try {
    const response = await axios.get(url, {
      responseType: stream ? 'stream' : 'arraybuffer',
      timeout: 30000, // 30s timeout
      // For web3.storage gateway, follow redirects
      maxRedirects: 5,
      headers: {
        'Accept': 'application/octet-stream'
      }
    });

    const elapsed = Date.now() - startTime;
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[resource] IPFS fetch from ${gateway}: ${elapsed}ms, CID: ${cid.substring(0, 16)}...`);
    }

    if (stream) {
      return response.data; // Returns readable stream
    }
    return Buffer.from(response.data);
  } catch (error) {
    // Try alternative gateway on failure
    if (!USE_LOCAL_IPFS && gateway !== IPFS_GATEWAY) {
      try {
        const fallbackUrl = `${IPFS_GATEWAY}/ipfs/${cid}`;
        const fallbackResponse = await axios.get(fallbackUrl, {
          responseType: stream ? 'stream' : 'arraybuffer',
          timeout: 30000
        });
        return stream ? fallbackResponse.data : Buffer.from(fallbackResponse.data);
      } catch {
        // Fall through to throw original error
      }
    }
    throw new Error(`IPFS fetch failed: ${error.message}`);
  }
}

/**
 * Retrieves symmetric key from Vault for a resource
 * Path: secret/data/owner/keys/<resourceId>
 * 
 * Per Vault KV v2 docs: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#read-secret-version
 * 
 * @param {string} resourceId - Resource identifier
 * @returns {Promise<{aesKey: Buffer, iv: Buffer, authTag: Buffer}>}
 */
async function getResourceKey(resourceId) {
  const client = vaultClient.getClient();
  const path = `secret/data/owner/keys/${resourceId}`;

  try {
    const response = await client.read(path);
    
    if (!response || !response.data || !response.data.data) {
      throw new Error(`Key not found for resource: ${resourceId}`);
    }

    const keyData = response.data.data;
    
    return {
      aesKey: Buffer.from(keyData.aesKey, 'hex'),
      iv: Buffer.from(keyData.iv, 'hex'),
      authTag: Buffer.from(keyData.authTag, 'hex')
    };
  } catch (error) {
    if (error.message.includes('Key not found')) {
      throw error;
    }
    throw new Error(`Vault key retrieval failed: ${error.message}`);
  }
}

/**
 * Obtains a decryptable key for the caller via PRE (Proxy Re-Encryption)
 * Calls pyUmbral service for re-encryption if caller is not owner
 * 
 * Per pyUmbral docs: https://pyumbral.readthedocs.io/en/latest/using_pyumbral.html
 * 
 * @param {string} resourceId - Resource identifier
 * @param {string} callerOrgId - Calling organization's ID
 * @param {string} ownerOrgId - Owner organization's ID
 * @param {Object} encryptedKeyData - Encrypted key data from Vault
 * @returns {Promise<Buffer>} Decrypted AES key
 */
async function getDecryptableKey(resourceId, callerOrgId, ownerOrgId, encryptedKeyData) {
  // If caller is owner, return key directly (no PRE needed)
  if (callerOrgId === ownerOrgId) {
    return encryptedKeyData.aesKey;
  }

  // Otherwise, use PRE to re-encrypt the key for the caller
  // This requires:
  // 1. A rekey from owner to caller (should have been created when access was granted)
  // 2. Re-encryption of the key capsule using that rekey
  // 3. Decryption by caller using their private key
  
  const axios = (await import('axios')).default;
  
  try {
    // Get the rekey info for this resource and caller
    // The rekey should have been stored when grantAccess was called
    const client = vaultClient.getClient();
    const rekeyPath = `secret/data/rekeys/${resourceId}/${callerOrgId}`;
    
    let rekeyData;
    try {
      const rekeyResponse = await client.read(rekeyPath);
      rekeyData = rekeyResponse?.data?.data;
    } catch {
      // No rekey found - check if direct key sharing is available
      // This is a fallback for development/testing
      const sharedKeyPath = `secret/data/shared-keys/${resourceId}/${callerOrgId}`;
      try {
        const sharedKeyResponse = await client.read(sharedKeyPath);
        if (sharedKeyResponse?.data?.data?.aesKey) {
          return Buffer.from(sharedKeyResponse.data.data.aesKey, 'hex');
        }
      } catch {
        throw new Error(`No rekey or shared key found for caller ${callerOrgId} on resource ${resourceId}`);
      }
    }

    if (!rekeyData) {
      throw new Error(`No rekey found for caller ${callerOrgId}`);
    }

    // Call pyUmbral service for re-encryption
    // Per pyUmbral docs: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.reencrypt
    const reencryptResponse = await axios.post(`${PYUMBRAL_SERVICE_URL}/reencrypt`, {
      rekey_id: rekeyData.rekeyId,
      capsule: rekeyData.capsule,
      ciphertext: rekeyData.encryptedKey
    }, {
      timeout: 5000
    });

    // Now decrypt the re-encrypted key using caller's private key
    // Per pyUmbral docs: https://pyumbral.readthedocs.io/en/latest/api.html#umbral.decrypt_reencrypted
    const decryptResponse = await axios.post(`${PYUMBRAL_SERVICE_URL}/decrypt`, {
      recipient_id: callerOrgId,
      owner_id: ownerOrgId,
      capsule: reencryptResponse.data.capsule,
      ciphertext: reencryptResponse.data.ciphertext,
      cfrags: reencryptResponse.data.cfrags
    }, {
      timeout: 5000
    });

    // The plaintext is base64-encoded AES key
    const aesKeyBuffer = Buffer.from(decryptResponse.data.plaintext, 'base64');
    return aesKeyBuffer;

  } catch (error) {
    // Log error but don't expose internal details
    console.error(`[resource] PRE key retrieval failed for resource ${resourceId}`);
    throw new Error('Failed to obtain decryption key via PRE');
  }
}

/**
 * GET /resource/:id
 * 
 * Retrieves a decrypted health resource.
 * 
 * Headers:
 * - x-org-id: (required) Calling organization's identifier
 * 
 * Query Parameters:
 * - stream: (optional) If 'true', stream the response for large files
 * 
 * Response:
 * - 200: Decrypted resource content with appropriate Content-Type
 * - 403: Access denied (no permission or expired)
 * - 404: Resource not found
 * - 503: Service unavailable (IPFS, Vault, or Fabric down)
 */
router.get('/:id', async (req, res) => {
  const startTime = Date.now();
  const resourceId = req.params.id;
  const callerOrgId = req.headers['x-org-id'];
  const streamMode = req.query.stream === 'true';

  // Validate caller org header
  if (!callerOrgId) {
    return res.status(400).json({
      error: 'Missing x-org-id header',
      message: 'Request must include x-org-id header identifying the calling organization'
    });
  }

  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`[resource] GET /${resourceId} by org: ${callerOrgId}`);
  }

  try {
    // Step 1: Query chaincode to verify access permission
    // Per Fabric docs: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html#evaluate-transaction
    let accessResult;
    try {
      accessResult = await fabricClient.evaluateTransaction('checkAccess', [resourceId, callerOrgId]);
    } catch (fabricError) {
      // Handle specific Fabric errors
      if (fabricError.message.includes('does not exist')) {
        return res.status(404).json({
          error: 'Resource not found',
          resourceId: resourceId
        });
      }
      throw fabricError;
    }

    // Check if access is granted
    if (!accessResult.hasAccess) {
      return res.status(403).json({
        error: 'Access denied',
        reason: accessResult.reason || 'No permission to access this resource',
        resourceId: resourceId
      });
    }

    // Step 2: Get resource metadata from chaincode
    const resourceMeta = await fabricClient.evaluateTransaction('queryResource', [resourceId]);
    
    if (!resourceMeta || !resourceMeta.cid) {
      return res.status(404).json({
        error: 'Resource metadata not found',
        resourceId: resourceId
      });
    }

    const { cid, sha256, fhirType, ownerOrgId } = resourceMeta;

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[resource] Metadata retrieved: fhirType=${fhirType}, CID=${cid.substring(0, 16)}...`);
    }

    // Step 3: Fetch encrypted blob from IPFS
    let encryptedData;
    try {
      encryptedData = await fetchFromIPFS(cid, false); // Always buffer for decryption
    } catch (ipfsError) {
      console.error(`[resource] IPFS fetch failed: ${ipfsError.message}`);
      return res.status(503).json({
        error: 'Storage service unavailable',
        message: 'Failed to fetch resource from IPFS',
        hint: 'Ensure IPFS node is running or web3.storage gateway is accessible'
      });
    }

    // Verify SHA-256 integrity
    const computedHash = encrypt.sha256Hex(encryptedData);
    if (computedHash !== sha256) {
      console.error(`[resource] Integrity check failed for ${resourceId}`);
      return res.status(500).json({
        error: 'Integrity verification failed',
        message: 'Resource content hash does not match stored hash'
      });
    }

    // Step 4: Retrieve encryption key from Vault
    let keyData;
    try {
      keyData = await getResourceKey(resourceId);
    } catch (vaultError) {
      console.error(`[resource] Vault key retrieval failed: ${vaultError.message}`);
      return res.status(503).json({
        error: 'Key service unavailable',
        message: 'Failed to retrieve encryption key'
      });
    }

    // Step 5: Obtain decryptable key (via PRE if needed)
    let aesKey;
    try {
      aesKey = await getDecryptableKey(resourceId, callerOrgId, ownerOrgId, keyData);
    } catch (preError) {
      console.error(`[resource] PRE key retrieval failed`);
      // For development, fall back to direct key if caller is owner or has shared key
      if (accessResult.isOwner) {
        aesKey = keyData.aesKey;
      } else {
        return res.status(403).json({
          error: 'Decryption key unavailable',
          message: 'Unable to obtain decryption key for this resource'
        });
      }
    }

    // Step 6: Decrypt the data
    let decryptedData;
    try {
      // Unpack encrypted data format: [IV (12 bytes)] [AuthTag (16 bytes)] [Ciphertext]
      const unpacked = encrypt.unpackEncrypted(encryptedData);
      
      decryptedData = encrypt.decrypt(
        unpacked.ciphertext,
        aesKey,
        unpacked.iv,
        unpacked.authTag
      );
    } catch (decryptError) {
      console.error(`[resource] Decryption failed for ${resourceId}`);
      return res.status(500).json({
        error: 'Decryption failed',
        message: 'Unable to decrypt resource content'
      });
    }

    // Calculate response timing
    const elapsed = Date.now() - startTime;
    
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[resource] Retrieved ${resourceId}: ${decryptedData.length} bytes in ${elapsed}ms`);
    }

    // Step 7: Send response with appropriate Content-Type
    const contentType = FHIR_CONTENT_TYPES[fhirType] || FHIR_CONTENT_TYPES.default;
    
    // Set response headers
    res.set({
      'Content-Type': contentType,
      'Content-Length': decryptedData.length,
      'X-Resource-Id': resourceId,
      'X-FHIR-Type': fhirType,
      'X-Retrieval-Time-Ms': elapsed,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache'
    });

    // For streaming (large files like ImagingStudy), use stream response
    if (streamMode && decryptedData.length > 1024 * 1024) { // >1MB
      const readable = Readable.from(decryptedData);
      return readable.pipe(res);
    }

    // For small files, send directly
    res.send(decryptedData);

    // Log access to blockchain (async, don't wait)
    fabricClient.submitTransaction('logAccess', [
      resourceId,
      callerOrgId,
      'retrieve',
      Math.floor(Date.now() / 1000).toString()
    ]).catch(err => {
      // Log but don't fail the response
      console.error(`[resource] Failed to log access: ${err.message}`);
    });

  } catch (error) {
    console.error(`[resource] Error retrieving ${resourceId}: ${error.message}`);
    
    res.status(500).json({
      error: 'Resource retrieval failed',
      message: process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : error.message
    });
  }
});

/**
 * GET /resource/:id/meta
 * 
 * Retrieves only the metadata for a resource (no decryption).
 * Useful for checking resource info before full retrieval.
 */
router.get('/:id/meta', async (req, res) => {
  const resourceId = req.params.id;
  const callerOrgId = req.headers['x-org-id'];

  if (!callerOrgId) {
    return res.status(400).json({
      error: 'Missing x-org-id header'
    });
  }

  try {
    // Check access permission
    const accessResult = await fabricClient.evaluateTransaction('checkAccess', [resourceId, callerOrgId]);
    
    if (!accessResult.hasAccess) {
      return res.status(403).json({
        error: 'Access denied',
        reason: accessResult.reason
      });
    }

    // Get resource metadata
    const resourceMeta = await fabricClient.evaluateTransaction('queryResource', [resourceId]);
    
    // Return metadata without sensitive info
    res.json({
      resourceId: resourceMeta.resourceId,
      fhirType: resourceMeta.fhirType,
      ownerOrgId: resourceMeta.ownerOrgId,
      uploadedAt: resourceMeta.uploadedAt,
      access: {
        hasAccess: accessResult.hasAccess,
        accessType: accessResult.accessType,
        isOwner: accessResult.isOwner,
        expiryTimestamp: accessResult.expiryTimestamp
      }
    });

  } catch (error) {
    if (error.message.includes('does not exist')) {
      return res.status(404).json({
        error: 'Resource not found'
      });
    }
    
    res.status(500).json({
      error: 'Failed to retrieve metadata',
      message: process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : error.message
    });
  }
});

module.exports = router;
