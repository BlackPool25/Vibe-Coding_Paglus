/**
 * IPFS Service - Client-side IPFS Utilities
 * 
 * Provides utilities for:
 * - Building IPFS gateway URLs from CIDs
 * - Verifying content integrity via SHA-256
 * - Direct IPFS gateway fetching (for public content)
 * 
 * Note: Actual uploads go through the backend which handles encryption.
 * This service is for client-side IPFS-related operations only.
 * 
 * References:
 * - IPFS CIDs: https://docs.ipfs.tech/concepts/content-addressing/
 * - IPFS Gateways: https://docs.ipfs.tech/concepts/ipfs-gateway/
 * - web3.storage Gateway: https://web3.storage/docs/how-to/retrieve/
 * - SubtleCrypto: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto
 */

// Gateway configuration
// Per IPFS docs: https://docs.ipfs.tech/concepts/ipfs-gateway/#gateway-types
const GATEWAYS = {
  // Local gateway (fastest for local IPFS node)
  local: 'http://127.0.0.1:8080',
  
  // web3.storage gateway (production)
  // Per web3.storage docs: https://web3.storage/docs/how-to/retrieve/
  w3s: 'https://w3s.link',
  
  // Public IPFS gateway (fallback)
  // Per IPFS docs: https://docs.ipfs.tech/concepts/ipfs-gateway/
  dweb: 'https://dweb.link',
  
  // Cloudflare IPFS gateway
  cloudflare: 'https://cloudflare-ipfs.com'
};

// Default gateway order for fallback
const DEFAULT_GATEWAY_ORDER = ['local', 'w3s', 'dweb'];

/**
 * Build IPFS gateway URL from CID
 * 
 * @param {string} cid - IPFS Content Identifier
 * @param {string} gateway - Gateway name ('local', 'w3s', 'dweb', 'cloudflare')
 * @returns {string} Full gateway URL
 */
export function getGatewayUrl(cid, gateway = 'w3s') {
  const baseUrl = GATEWAYS[gateway] || GATEWAYS.w3s;
  return `${baseUrl}/ipfs/${cid}`;
}

/**
 * Get all gateway URLs for a CID
 * 
 * @param {string} cid - IPFS Content Identifier
 * @returns {Object} Object with gateway names as keys and URLs as values
 */
export function getAllGatewayUrls(cid) {
  const urls = {};
  for (const [name, baseUrl] of Object.entries(GATEWAYS)) {
    urls[name] = `${baseUrl}/ipfs/${cid}`;
  }
  return urls;
}

/**
 * Compute SHA-256 hash of data
 * Uses Web Crypto API for browser-native hashing
 * 
 * @param {ArrayBuffer|Uint8Array} data - Data to hash
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
export async function sha256(data) {
  // Ensure data is ArrayBuffer
  const buffer = data instanceof ArrayBuffer ? data : data.buffer;
  
  // Use SubtleCrypto for SHA-256
  // Per MDN: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  
  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify content integrity by comparing SHA-256 hashes
 * 
 * @param {ArrayBuffer|Uint8Array} data - Content data
 * @param {string} expectedHash - Expected SHA-256 hash (hex)
 * @returns {Promise<boolean>} True if hashes match
 */
export async function verifyIntegrity(data, expectedHash) {
  const computedHash = await sha256(data);
  return computedHash.toLowerCase() === expectedHash.toLowerCase();
}

/**
 * Fetch content from IPFS gateway with fallback
 * 
 * Tries gateways in order until one succeeds.
 * For encrypted content, use backend /resource/:id endpoint instead.
 * 
 * @param {string} cid - IPFS Content Identifier
 * @param {Object} options - { gateways, timeout, expectedHash }
 * @returns {Promise<{data: ArrayBuffer, gateway: string, verified?: boolean}>}
 */
export async function fetchFromGateway(cid, options = {}) {
  const gateways = options.gateways || DEFAULT_GATEWAY_ORDER;
  const timeout = options.timeout || 30000;
  const expectedHash = options.expectedHash;

  let lastError = null;

  for (const gateway of gateways) {
    const url = getGatewayUrl(cid, gateway);
    
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/octet-stream, */*'
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.arrayBuffer();

      // Verify integrity if expected hash provided
      let verified = undefined;
      if (expectedHash) {
        verified = await verifyIntegrity(data, expectedHash);
        if (!verified) {
          console.warn(`[ipfs] Integrity check failed for CID ${cid} from ${gateway}`);
          continue; // Try next gateway
        }
      }

      return {
        data,
        gateway,
        verified,
        size: data.byteLength,
        url
      };

    } catch (error) {
      lastError = error;
      console.warn(`[ipfs] Gateway ${gateway} failed for CID ${cid}: ${error.message}`);
      continue; // Try next gateway
    }
  }

  throw new Error(`All IPFS gateways failed for CID ${cid}: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Check if a CID is available on a gateway
 * 
 * @param {string} cid - IPFS Content Identifier
 * @param {string} gateway - Gateway name
 * @returns {Promise<boolean>} True if CID is available
 */
export async function checkAvailability(cid, gateway = 'w3s') {
  const url = getGatewayUrl(cid, gateway);
  
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Parse IPFS CID from various formats
 * 
 * Handles:
 * - Raw CID: "bafybeig..."
 * - Gateway URL: "https://w3s.link/ipfs/bafybeig..."
 * - IPFS URI: "ipfs://bafybeig..."
 * 
 * @param {string} input - CID in various formats
 * @returns {string|null} Extracted CID or null if invalid
 */
export function parseCid(input) {
  if (!input || typeof input !== 'string') {
    return null;
  }

  // Remove whitespace
  input = input.trim();

  // Handle ipfs:// URI
  if (input.startsWith('ipfs://')) {
    return input.slice(7).split('/')[0];
  }

  // Handle gateway URLs
  const ipfsPathMatch = input.match(/\/ipfs\/([a-zA-Z0-9]+)/);
  if (ipfsPathMatch) {
    return ipfsPathMatch[1];
  }

  // Validate raw CID format (basic check)
  // CIDv0 starts with 'Qm' (46 chars), CIDv1 starts with 'bafy' or 'bafk' (variable)
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|baf[a-z2-7]{50,})$/.test(input)) {
    return input;
  }

  return null;
}

/**
 * Format file size for display
 * 
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size (e.g., "1.5 MB")
 */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ============================================================
// EXPORTS
// ============================================================

export default {
  // URL utilities
  getGatewayUrl,
  getAllGatewayUrls,
  parseCid,
  
  // Hashing
  sha256,
  verifyIntegrity,
  
  // Fetching
  fetchFromGateway,
  checkAvailability,
  
  // Helpers
  formatSize,
  
  // Constants
  GATEWAYS
};
