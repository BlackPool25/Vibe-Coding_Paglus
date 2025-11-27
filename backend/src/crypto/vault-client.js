/**
 * HashiCorp Vault Client Module
 * 
 * Provides secure key storage and retrieval using Vault's KV v2 secrets engine.
 * 
 * References:
 * - Vault Developer Quickstart: https://developer.hashicorp.com/vault/docs/get-started/developer-qs
 * - Vault KV v2 API: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2
 * - node-vault: https://github.com/nodevault/node-vault
 * 
 * Environment Variables:
 * - VAULT_ADDR: Vault server address (default: http://127.0.0.1:8200)
 * - VAULT_TOKEN: Vault authentication token
 * 
 * SECURITY NOTE: No PHI or key material is logged. Only key IDs at debug level.
 */

'use strict';

const vault = require('node-vault');

// Vault configuration from environment
// VAULT_TOKEN takes precedence, fallback to VAULT_DEV_ROOT_TOKEN_ID for docker-compose compatibility
const VAULT_ADDR = process.env.VAULT_ADDR || 'http://127.0.0.1:8200';
const VAULT_TOKEN = process.env.VAULT_TOKEN || process.env.VAULT_DEV_ROOT_TOKEN_ID || 'dev-only-token';

// KV v2 mount path and org key path prefix
const KV_MOUNT = 'secret';
const ORG_KEY_PATH_PREFIX = 'orgs';

let vaultClient = null;

/**
 * Initializes the Vault client
 * Uses node-vault library per https://developer.hashicorp.com/vault/docs/get-started/developer-qs
 * 
 * @returns {Object} Initialized vault client
 */
function initVaultClient() {
  if (vaultClient) {
    return vaultClient;
  }

  vaultClient = vault({
    apiVersion: 'v1',
    endpoint: VAULT_ADDR,
    token: VAULT_TOKEN
  });

  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`[vault-client] Initialized Vault client at ${VAULT_ADDR}`);
  }

  return vaultClient;
}

/**
 * Gets the Vault client instance
 * @returns {Object} Vault client
 */
function getClient() {
  return initVaultClient();
}

/**
 * Stores a key blob in Vault under the orgs path
 * Path format: secret/data/orgs/{orgId}
 * 
 * Per Vault KV v2 API, we use the write method with data wrapped in { data: {...} }
 * Reference: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#create-update-secret
 * 
 * @param {string} orgId - Organization identifier
 * @param {Object} keyBlob - Key data to store
 * @param {string} keyBlob.privateKey - PEM-encoded private key
 * @param {string} keyBlob.publicKey - PEM-encoded public key
 * @param {string} [keyBlob.keyType] - Key type (RSA, EC)
 * @param {string} [keyBlob.createdAt] - ISO timestamp
 * @returns {Promise<{ vaultPath: string, version: number }>}
 */
async function putKey(orgId, keyBlob) {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId is required and must be a string');
  }

  if (!keyBlob || typeof keyBlob !== 'object') {
    throw new Error('keyBlob is required and must be an object');
  }

  const client = getClient();
  const path = `${KV_MOUNT}/data/${ORG_KEY_PATH_PREFIX}/${orgId}`;

  // Debug log - only path, no key material
  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`[vault-client] Storing key at path: ${path}`);
  }

  try {
    // KV v2 requires data to be wrapped in { data: {...} }
    const response = await client.write(path, {
      data: {
        privateKey: keyBlob.privateKey,
        publicKey: keyBlob.publicKey,
        keyType: keyBlob.keyType || 'EC',
        createdAt: keyBlob.createdAt || new Date().toISOString(),
        orgId: orgId
      }
    });

    const version = response?.data?.version || 1;

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[vault-client] Stored key version ${version} at ${path}`);
    }

    return {
      vaultPath: `${KV_MOUNT}/${ORG_KEY_PATH_PREFIX}/${orgId}`,
      version
    };
  } catch (error) {
    // Don't log sensitive details
    console.error(`[vault-client] Failed to store key for orgId: ${orgId}`);
    throw new Error(`Vault write failed: ${error.message}`);
  }
}

/**
 * Retrieves a key blob from Vault
 * Path format: secret/data/orgs/{orgId}
 * 
 * Reference: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#read-secret-version
 * 
 * @param {string} orgId - Organization identifier
 * @param {number} [version] - Optional specific version to retrieve
 * @returns {Promise<{ data: Object, metadata: Object }>}
 */
async function getKey(orgId, version = null) {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId is required and must be a string');
  }

  const client = getClient();
  let path = `${KV_MOUNT}/data/${ORG_KEY_PATH_PREFIX}/${orgId}`;
  
  if (version) {
    path += `?version=${version}`;
  }

  // Debug log - only path, no key material
  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`[vault-client] Reading key from path: ${path}`);
  }

  try {
    const response = await client.read(path);

    if (!response || !response.data) {
      throw new Error(`No key found for orgId: ${orgId}`);
    }

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[vault-client] Retrieved key version ${response.data.metadata?.version} for ${orgId}`);
    }

    return {
      data: response.data.data,
      metadata: response.data.metadata
    };
  } catch (error) {
    // Don't log sensitive details
    console.error(`[vault-client] Failed to retrieve key for orgId: ${orgId}`);
    throw new Error(`Vault read failed: ${error.message}`);
  }
}

/**
 * Deletes a key from Vault (soft delete in KV v2)
 * 
 * @param {string} orgId - Organization identifier
 * @returns {Promise<boolean>}
 */
async function deleteKey(orgId) {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('orgId is required and must be a string');
  }

  const client = getClient();
  const path = `${KV_MOUNT}/data/${ORG_KEY_PATH_PREFIX}/${orgId}`;

  try {
    await client.delete(path);
    
    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[vault-client] Deleted key at ${path}`);
    }

    return true;
  } catch (error) {
    console.error(`[vault-client] Failed to delete key for orgId: ${orgId}`);
    throw new Error(`Vault delete failed: ${error.message}`);
  }
}

/**
 * Lists all org keys stored in Vault
 * 
 * Reference: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2#list-secrets
 * 
 * @returns {Promise<string[]>} List of orgIds
 */
async function listKeys() {
  const client = getClient();
  const path = `${KV_MOUNT}/metadata/${ORG_KEY_PATH_PREFIX}`;

  try {
    const response = await client.list(path);
    return response?.data?.keys || [];
  } catch (error) {
    // Path may not exist if no keys stored yet
    if (error.response?.statusCode === 404) {
      return [];
    }
    console.error('[vault-client] Failed to list keys');
    throw new Error(`Vault list failed: ${error.message}`);
  }
}

/**
 * Checks if Vault is accessible and authenticated
 * 
 * @returns {Promise<{ initialized: boolean, sealed: boolean, version: string }>}
 */
async function healthCheck() {
  const client = getClient();
  
  try {
    const status = await client.status();
    return {
      initialized: status.initialized,
      sealed: status.sealed,
      version: status.version
    };
  } catch (error) {
    console.error('[vault-client] Health check failed');
    throw new Error(`Vault health check failed: ${error.message}`);
  }
}

/**
 * Stores a wrapped symmetric key for data encryption
 * Separate path from org keys for symmetric key wraps
 * 
 * @param {string} keyId - Unique key identifier (e.g., CID-based)
 * @param {Object} wrappedKeyData - Wrapped key data
 * @returns {Promise<{ vaultPath: string }>}
 */
async function putWrappedKey(keyId, wrappedKeyData) {
  const client = getClient();
  const path = `${KV_MOUNT}/data/wrapped-keys/${keyId}`;

  try {
    await client.write(path, {
      data: {
        wrappedKey: wrappedKeyData.wrappedKey,
        iv: wrappedKeyData.iv,
        authTag: wrappedKeyData.authTag,
        createdAt: new Date().toISOString()
      }
    });

    return {
      vaultPath: `${KV_MOUNT}/wrapped-keys/${keyId}`
    };
  } catch (error) {
    console.error(`[vault-client] Failed to store wrapped key: ${keyId}`);
    throw new Error(`Vault write failed: ${error.message}`);
  }
}

/**
 * Retrieves a wrapped symmetric key
 * 
 * @param {string} keyId - Key identifier
 * @returns {Promise<Object>} Wrapped key data
 */
async function getWrappedKey(keyId) {
  const client = getClient();
  const path = `${KV_MOUNT}/data/wrapped-keys/${keyId}`;

  try {
    const response = await client.read(path);
    return response?.data?.data;
  } catch (error) {
    console.error(`[vault-client] Failed to retrieve wrapped key: ${keyId}`);
    throw new Error(`Vault read failed: ${error.message}`);
  }
}

module.exports = {
  // Client management
  initVaultClient,
  getClient,
  healthCheck,
  
  // Org key operations
  putKey,
  getKey,
  deleteKey,
  listKeys,
  
  // Wrapped key operations
  putWrappedKey,
  getWrappedKey,
  
  // Constants (for testing)
  KV_MOUNT,
  ORG_KEY_PATH_PREFIX
};
