/**
 * IPFS Upload Service
 * 
 * Provides methods to upload encrypted files to:
 * 1. web3.storage (using @web3-storage/w3up-client) - requires WEB3_STORAGE_TOKEN env var
 * 2. Local IPFS node (using ipfs-http-client) - requires IPFS_API env var
 * 
 * Environment detection: If WEB3_STORAGE_TOKEN is set, uses web3.storage.
 * Otherwise falls back to local IPFS node via IPFS_API.
 * 
 * References:
 * - web3.storage docs: https://web3.storage/docs/
 * - web3.storage w3up-client: https://web3.storage/docs/w3up-client/
 * - web3.storage CAR files: https://web3.storage/docs/concepts/car-files/
 * - ipfs-http-client: https://docs.ipfs.tech/reference/kubo/rpc/
 * - IPFS HTTP API: https://docs.ipfs.tech/reference/http/api/
 * 
 * SECURITY NOTE: No PHI is logged. Only CIDs at debug level.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Detect which storage backend to use
const WEB3_STORAGE_TOKEN = process.env.WEB3_STORAGE_TOKEN;
const IPFS_API = process.env.IPFS_API || 'http://127.0.0.1:5001';

/**
 * Uploads a file buffer to web3.storage using the w3up-client
 * 
 * Per web3.storage docs (https://web3.storage/docs/w3up-client/):
 * - Uses the new w3up protocol for uploads
 * - Requires a Space to be set before uploading
 * - Files are automatically sharded into CAR files for large uploads
 * 
 * NOTE: For files > 100MB, web3.storage automatically handles chunking.
 * Per https://web3.storage/docs/concepts/car-files/:
 * - Large files are split into ~100MB CAR chunks
 * - Each chunk is uploaded separately
 * - The client handles this transparently
 * 
 * @param {Buffer} fileBuffer - The file content as a Buffer
 * @param {string} fileName - Original filename (for metadata)
 * @returns {Promise<{ cid: string }>} Object containing the CID
 */
async function uploadToWeb3Storage(fileBuffer, fileName = 'encrypted-data.bin') {
  if (!WEB3_STORAGE_TOKEN) {
    throw new Error('WEB3_STORAGE_TOKEN environment variable is required for web3.storage uploads');
  }

  try {
    // Dynamic import for ESM module
    // Per web3.storage docs: https://web3.storage/docs/w3up-client/
    const { create } = await import('@web3-storage/w3up-client');
    
    // Create client instance
    // Reference: https://web3.storage/docs/w3up-client/#create-a-client
    const client = await create();

    // For production, you would need to:
    // 1. Login: await client.login('email@example.com')
    // 2. Create/set space: await client.setCurrentSpace(spaceDID)
    // 
    // For development with a token, we use the simple upload API
    // The token should be a Space-specific token from the web3.storage console
    
    // Create a File/Blob from the buffer
    // Per web3.storage docs, uploadFile accepts File or Blob
    // https://web3.storage/docs/w3up-client/#uploadfile
    const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
    const file = new File([blob], fileName, { type: 'application/octet-stream' });

    // Upload the file
    // NOTE: For files > 100MB, w3up-client automatically handles:
    // - Splitting into ~100MB CAR chunks (per https://web3.storage/docs/concepts/car-files/)
    // - Parallel upload of chunks
    // - Assembling final CID
    const cid = await client.uploadFile(file);

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[ipfs] Uploaded to web3.storage: ${cid.toString()}`);
    }

    return {
      cid: cid.toString()
    };
  } catch (error) {
    // Handle specific web3.storage errors
    if (error.message.includes('Space')) {
      throw new Error(
        'web3.storage Space not configured. Ensure you have created a Space and set it as current. ' +
        'See: https://web3.storage/docs/w3up-client/#create-a-space'
      );
    }
    throw new Error(`web3.storage upload failed: ${error.message}`);
  }
}

/**
 * Alternative: Upload to web3.storage using the older web3.storage HTTP API
 * This method uses simple HTTP PUT with Authorization header
 * 
 * Per web3.storage docs (https://web3.storage/docs/how-to/upload/):
 * - API endpoint: https://api.web3.storage/upload
 * - Requires Authorization header with Bearer token
 * 
 * @param {Buffer} fileBuffer - The file content as a Buffer
 * @param {string} fileName - Original filename
 * @returns {Promise<{ cid: string }>}
 */
async function uploadToWeb3StorageHTTP(fileBuffer, fileName = 'encrypted-data.bin') {
  if (!WEB3_STORAGE_TOKEN) {
    throw new Error('WEB3_STORAGE_TOKEN environment variable is required');
  }

  const FormData = (await import('form-data')).default;
  const axios = (await import('axios')).default;

  // Create FormData with the file
  // Per web3.storage docs: https://web3.storage/docs/reference/http-api/
  const form = new FormData();
  form.append('file', fileBuffer, {
    filename: fileName,
    contentType: 'application/octet-stream'
  });

  // Upload to web3.storage API
  // Reference: https://web3.storage/docs/reference/http-api/#operation/post-upload
  const response = await axios.post('https://api.web3.storage/upload', form, {
    headers: {
      ...form.getHeaders(),
      'Authorization': `Bearer ${WEB3_STORAGE_TOKEN}`
    },
    maxContentLength: Infinity,
    maxBodyLength: Infinity
  });

  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`[ipfs] Uploaded to web3.storage HTTP API: ${response.data.cid}`);
  }

  return {
    cid: response.data.cid
  };
}

/**
 * Uploads a file buffer to a local IPFS node using the HTTP API
 * 
 * Per IPFS docs (https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-add):
 * - Endpoint: POST /api/v0/add
 * - Accepts multipart/form-data
 * - Returns JSON with CID
 * 
 * @param {Buffer} fileBuffer - The file content as a Buffer
 * @param {string} fileName - Original filename (for metadata)
 * @returns {Promise<{ cid: string }>} Object containing the CID
 */
async function uploadToLocalIpfs(fileBuffer, fileName = 'encrypted-data.bin') {
  try {
    const FormData = (await import('form-data')).default;
    const axios = (await import('axios')).default;

    // Construct IPFS API URL
    // Per IPFS docs: https://docs.ipfs.tech/reference/kubo/rpc/#api-v0-add
    const ipfsUrl = IPFS_API.replace(/\/$/, '');
    const addUrl = `${ipfsUrl}/api/v0/add`;

    // Create FormData with the file buffer
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: fileName,
      contentType: 'application/octet-stream'
    });

    // POST to IPFS add endpoint
    // Query params per docs:
    // - pin=true: Pin the file after adding
    // - quieter=true: Return only the final CID
    const response = await axios.post(addUrl, form, {
      headers: form.getHeaders(),
      params: {
        pin: true,
        'cid-version': 1  // Use CIDv1 for better compatibility
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // Response format per IPFS docs:
    // { "Name": "filename", "Hash": "Qm...", "Size": "123" }
    const cid = response.data.Hash;

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[ipfs] Uploaded to local IPFS: ${cid}`);
    }

    return {
      cid: cid
    };
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(
        `Cannot connect to local IPFS node at ${IPFS_API}. ` +
        'Ensure IPFS daemon is running: ipfs daemon'
      );
    }
    throw new Error(`Local IPFS upload failed: ${error.message}`);
  }
}

/**
 * Uploads a file to IPFS, automatically selecting the backend based on environment
 * 
 * Priority:
 * 1. If WEB3_STORAGE_TOKEN is set -> use web3.storage
 * 2. Otherwise -> use local IPFS node via IPFS_API
 * 
 * @param {Buffer} fileBuffer - The encrypted file content
 * @param {string} [fileName] - Optional filename for metadata
 * @returns {Promise<{ cid: string, backend: string }>}
 */
async function upload(fileBuffer, fileName = 'encrypted-data.bin') {
  if (!Buffer.isBuffer(fileBuffer)) {
    throw new Error('fileBuffer must be a Buffer');
  }

  if (WEB3_STORAGE_TOKEN) {
    // Use web3.storage
    // Prefer HTTP API for simplicity (w3up requires Space setup)
    try {
      const result = await uploadToWeb3StorageHTTP(fileBuffer, fileName);
      return {
        ...result,
        backend: 'web3.storage'
      };
    } catch (httpError) {
      // Fall back to w3up-client if HTTP API fails
      if (process.env.LOG_LEVEL === 'debug') {
        console.debug(`[ipfs] web3.storage HTTP API failed, trying w3up-client: ${httpError.message}`);
      }
      const result = await uploadToWeb3Storage(fileBuffer, fileName);
      return {
        ...result,
        backend: 'web3.storage-w3up'
      };
    }
  } else {
    // Use local IPFS
    const result = await uploadToLocalIpfs(fileBuffer, fileName);
    return {
      ...result,
      backend: 'local-ipfs'
    };
  }
}

/**
 * Uploads a file from disk path
 * Convenience wrapper that reads the file and calls upload()
 * 
 * @param {string} filePath - Path to the file on disk
 * @returns {Promise<{ cid: string, backend: string }>}
 */
async function uploadFromPath(filePath) {
  const absolutePath = path.resolve(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const fileBuffer = fs.readFileSync(absolutePath);
  const fileName = path.basename(absolutePath);

  return upload(fileBuffer, fileName);
}

/**
 * Retrieves content from IPFS via a gateway
 * For verification purposes
 * 
 * Per IPFS docs (https://docs.ipfs.tech/concepts/ipfs-gateway/):
 * - Public gateway: https://dweb.link/ipfs/<cid>
 * - Or use local gateway: http://127.0.0.1:8080/ipfs/<cid>
 * 
 * @param {string} cid - The IPFS CID to fetch
 * @param {string} [gateway] - Gateway URL (default: dweb.link or local)
 * @returns {Promise<Buffer>} The file content
 */
async function fetchFromIpfs(cid, gateway = null) {
  const axios = (await import('axios')).default;

  // Determine gateway
  let gatewayUrl;
  if (gateway) {
    gatewayUrl = gateway;
  } else if (!WEB3_STORAGE_TOKEN && IPFS_API) {
    // Use local gateway if running local IPFS
    gatewayUrl = 'http://127.0.0.1:8080';
  } else {
    // Use public gateway
    gatewayUrl = 'https://dweb.link';
  }

  const url = `${gatewayUrl}/ipfs/${cid}`;

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 30000
  });

  return Buffer.from(response.data);
}

/**
 * Returns info about which IPFS backend is configured
 * 
 * @returns {{ backend: string, configured: boolean, details: object }}
 */
function getBackendInfo() {
  if (WEB3_STORAGE_TOKEN) {
    return {
      backend: 'web3.storage',
      configured: true,
      details: {
        tokenPresent: true,
        docsUrl: 'https://web3.storage/docs/'
      }
    };
  } else {
    return {
      backend: 'local-ipfs',
      configured: !!IPFS_API,
      details: {
        apiUrl: IPFS_API,
        docsUrl: 'https://docs.ipfs.tech/reference/kubo/rpc/'
      }
    };
  }
}

module.exports = {
  // Main upload function (auto-detects backend)
  upload,
  uploadFromPath,
  
  // Specific backends
  uploadToWeb3Storage,
  uploadToWeb3StorageHTTP,
  uploadToLocalIpfs,
  
  // Utilities
  fetchFromIpfs,
  getBackendInfo
};
