/**
 * AES-256-GCM Encryption Module
 * 
 * Provides deterministic encryption/decryption with specified IV sizes,
 * SHA-256 hashing, and symmetric key wrap/unwrap functions.
 * 
 * References:
 * - Node.js Crypto: https://nodejs.org/api/crypto.html
 * - AES-GCM: NIST SP 800-38D
 * 
 * SECURITY NOTE: No PHI is logged. Only key IDs and CIDs at debug level.
 */

'use strict';

const crypto = require('crypto');

// Constants per NIST recommendations
const AES_ALGORITHM = 'aes-256-gcm';
const AES_KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;      // 96 bits (recommended for GCM)
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 16;    // For key derivation

/**
 * Generates a cryptographically secure random AES-256 key
 * @returns {Buffer} 32-byte AES key
 */
function generateAESKey() {
  return crypto.randomBytes(AES_KEY_LENGTH);
}

/**
 * Generates a cryptographically secure random IV
 * @param {number} [length=12] - IV length in bytes (default 12 for GCM)
 * @returns {Buffer} Random IV
 */
function generateIV(length = IV_LENGTH) {
  return crypto.randomBytes(length);
}

/**
 * Encrypts plaintext using AES-256-GCM
 * 
 * @param {Buffer|string} plaintext - Data to encrypt
 * @param {Buffer} key - 32-byte AES key
 * @param {Buffer} [iv] - Optional 12-byte IV (generated if not provided)
 * @param {Buffer} [aad] - Optional additional authenticated data
 * @returns {{ ciphertext: Buffer, iv: Buffer, authTag: Buffer }}
 */
function encrypt(plaintext, key, iv = null, aad = null) {
  if (!Buffer.isBuffer(key) || key.length !== AES_KEY_LENGTH) {
    throw new Error(`Key must be a ${AES_KEY_LENGTH}-byte Buffer`);
  }

  const actualIV = iv || generateIV();
  
  if (actualIV.length !== IV_LENGTH) {
    throw new Error(`IV must be ${IV_LENGTH} bytes for AES-GCM`);
  }

  const cipher = crypto.createCipheriv(AES_ALGORITHM, key, actualIV, {
    authTagLength: AUTH_TAG_LENGTH
  });

  if (aad) {
    cipher.setAAD(aad);
  }

  const plaintextBuffer = Buffer.isBuffer(plaintext) 
    ? plaintext 
    : Buffer.from(plaintext, 'utf8');

  const ciphertext = Buffer.concat([
    cipher.update(plaintextBuffer),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  // Debug log - only key ID hint, no actual data
  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`[encrypt] Encrypted ${ciphertext.length} bytes, IV: ${actualIV.slice(0, 4).toString('hex')}...`);
  }

  return {
    ciphertext,
    iv: actualIV,
    authTag
  };
}

/**
 * Decrypts ciphertext using AES-256-GCM
 * 
 * @param {Buffer} ciphertext - Encrypted data
 * @param {Buffer} key - 32-byte AES key
 * @param {Buffer} iv - 12-byte IV used during encryption
 * @param {Buffer} authTag - 16-byte authentication tag
 * @param {Buffer} [aad] - Optional additional authenticated data (must match encryption)
 * @returns {Buffer} Decrypted plaintext
 */
function decrypt(ciphertext, key, iv, authTag, aad = null) {
  if (!Buffer.isBuffer(key) || key.length !== AES_KEY_LENGTH) {
    throw new Error(`Key must be a ${AES_KEY_LENGTH}-byte Buffer`);
  }

  if (!Buffer.isBuffer(iv) || iv.length !== IV_LENGTH) {
    throw new Error(`IV must be a ${IV_LENGTH}-byte Buffer`);
  }

  if (!Buffer.isBuffer(authTag) || authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Auth tag must be a ${AUTH_TAG_LENGTH}-byte Buffer`);
  }

  const decipher = crypto.createDecipheriv(AES_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH
  });

  decipher.setAuthTag(authTag);

  if (aad) {
    decipher.setAAD(aad);
  }

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);

  // Debug log - only metadata, no actual data
  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`[decrypt] Decrypted ${plaintext.length} bytes`);
  }

  return plaintext;
}

/**
 * Computes SHA-256 hash of data
 * 
 * @param {Buffer|string} data - Data to hash
 * @returns {Buffer} 32-byte SHA-256 hash
 */
function sha256(data) {
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8'));
  return hash.digest();
}

/**
 * Computes SHA-256 hash and returns as hex string
 * 
 * @param {Buffer|string} data - Data to hash
 * @returns {string} Hex-encoded SHA-256 hash
 */
function sha256Hex(data) {
  return sha256(data).toString('hex');
}

/**
 * Wraps (encrypts) a symmetric key using another key (Key Encryption Key)
 * Uses AES-256-GCM for key wrapping as per RFC 5649 alternative
 * 
 * @param {Buffer} keyToWrap - The symmetric key to wrap
 * @param {Buffer} kek - Key Encryption Key (32 bytes)
 * @returns {{ wrappedKey: Buffer, iv: Buffer, authTag: Buffer }}
 */
function wrapKey(keyToWrap, kek) {
  if (!Buffer.isBuffer(kek) || kek.length !== AES_KEY_LENGTH) {
    throw new Error(`KEK must be a ${AES_KEY_LENGTH}-byte Buffer`);
  }

  // Use a fixed context for key wrapping
  const aad = Buffer.from('key-wrap-v1', 'utf8');
  
  const result = encrypt(keyToWrap, kek, null, aad);

  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`[wrapKey] Wrapped ${keyToWrap.length}-byte key`);
  }

  return {
    wrappedKey: result.ciphertext,
    iv: result.iv,
    authTag: result.authTag
  };
}

/**
 * Unwraps (decrypts) a wrapped symmetric key
 * 
 * @param {Buffer} wrappedKey - The wrapped key
 * @param {Buffer} kek - Key Encryption Key (32 bytes)
 * @param {Buffer} iv - IV used during wrapping
 * @param {Buffer} authTag - Auth tag from wrapping
 * @returns {Buffer} Unwrapped symmetric key
 */
function unwrapKey(wrappedKey, kek, iv, authTag) {
  const aad = Buffer.from('key-wrap-v1', 'utf8');
  
  const unwrapped = decrypt(wrappedKey, kek, iv, authTag, aad);

  if (process.env.LOG_LEVEL === 'debug') {
    console.debug(`[unwrapKey] Unwrapped ${unwrapped.length}-byte key`);
  }

  return unwrapped;
}

/**
 * Packs encrypted data into a single buffer for storage/transmission
 * Format: [IV (12 bytes)] [AuthTag (16 bytes)] [Ciphertext (variable)]
 * 
 * @param {{ ciphertext: Buffer, iv: Buffer, authTag: Buffer }} encryptedData
 * @returns {Buffer} Packed buffer
 */
function packEncrypted(encryptedData) {
  const { ciphertext, iv, authTag } = encryptedData;
  return Buffer.concat([iv, authTag, ciphertext]);
}

/**
 * Unpacks encrypted data from a single buffer
 * 
 * @param {Buffer} packed - Packed buffer from packEncrypted
 * @returns {{ ciphertext: Buffer, iv: Buffer, authTag: Buffer }}
 */
function unpackEncrypted(packed) {
  if (packed.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Packed data too short');
  }

  return {
    iv: packed.slice(0, IV_LENGTH),
    authTag: packed.slice(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH),
    ciphertext: packed.slice(IV_LENGTH + AUTH_TAG_LENGTH)
  };
}

/**
 * Derives a key from a password using PBKDF2
 * 
 * @param {string} password - Password to derive key from
 * @param {Buffer} [salt] - Optional salt (generated if not provided)
 * @param {number} [iterations=100000] - PBKDF2 iterations
 * @returns {{ key: Buffer, salt: Buffer }}
 */
function deriveKey(password, salt = null, iterations = 100000) {
  const actualSalt = salt || crypto.randomBytes(SALT_LENGTH);
  
  const key = crypto.pbkdf2Sync(
    password,
    actualSalt,
    iterations,
    AES_KEY_LENGTH,
    'sha256'
  );

  return { key, salt: actualSalt };
}

module.exports = {
  // Constants
  AES_KEY_LENGTH,
  IV_LENGTH,
  AUTH_TAG_LENGTH,
  
  // Key generation
  generateAESKey,
  generateIV,
  
  // Encryption/Decryption
  encrypt,
  decrypt,
  packEncrypted,
  unpackEncrypted,
  
  // Hashing
  sha256,
  sha256Hex,
  
  // Key wrapping
  wrapKey,
  unwrapKey,
  
  // Key derivation
  deriveKey
};
