/**
 * Unit Tests for encrypt.js
 * 
 * Tests AES-256-GCM encryption/decryption roundtrip and SHA-256 hashing.
 * Uses Node.js built-in test runner (node --test).
 * 
 * References:
 * - Node.js Test Runner: https://nodejs.org/api/test.html
 * - Node.js Assert: https://nodejs.org/api/assert.html
 * 
 * Run with: node --test tests/backend/encrypt.test.js
 */

'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Import the encrypt module
const encrypt = require('../../backend/src/crypto/encrypt');

describe('AES-256-GCM Encryption', () => {
  
  describe('generateAESKey', () => {
    it('should generate a 32-byte key', () => {
      const key = encrypt.generateAESKey();
      assert.strictEqual(Buffer.isBuffer(key), true);
      assert.strictEqual(key.length, 32); // 256 bits
    });

    it('should generate unique keys each time', () => {
      const key1 = encrypt.generateAESKey();
      const key2 = encrypt.generateAESKey();
      assert.notDeepStrictEqual(key1, key2);
    });
  });

  describe('generateIV', () => {
    it('should generate a 12-byte IV by default', () => {
      const iv = encrypt.generateIV();
      assert.strictEqual(Buffer.isBuffer(iv), true);
      assert.strictEqual(iv.length, 12); // 96 bits for GCM
    });

    it('should generate IV of specified length', () => {
      const iv = encrypt.generateIV(16);
      assert.strictEqual(iv.length, 16);
    });
  });

  describe('encrypt and decrypt roundtrip', () => {
    it('should encrypt and decrypt string data correctly', () => {
      const key = encrypt.generateAESKey();
      const plaintext = 'Hello, Healthcare Data!';

      // Encrypt
      const encrypted = encrypt.encrypt(plaintext, key);
      
      assert.ok(encrypted.ciphertext);
      assert.ok(encrypted.iv);
      assert.ok(encrypted.authTag);
      assert.strictEqual(encrypted.iv.length, 12);
      assert.strictEqual(encrypted.authTag.length, 16);

      // Decrypt
      const decrypted = encrypt.decrypt(
        encrypted.ciphertext,
        key,
        encrypted.iv,
        encrypted.authTag
      );

      assert.strictEqual(decrypted.toString('utf8'), plaintext);
    });

    it('should encrypt and decrypt Buffer data correctly', () => {
      const key = encrypt.generateAESKey();
      const plaintext = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);

      const encrypted = encrypt.encrypt(plaintext, key);
      const decrypted = encrypt.decrypt(
        encrypted.ciphertext,
        key,
        encrypted.iv,
        encrypted.authTag
      );

      assert.deepStrictEqual(decrypted, plaintext);
    });

    it('should encrypt and decrypt large data correctly', () => {
      const key = encrypt.generateAESKey();
      const plaintext = crypto.randomBytes(1024 * 100); // 100 KB

      const encrypted = encrypt.encrypt(plaintext, key);
      const decrypted = encrypt.decrypt(
        encrypted.ciphertext,
        key,
        encrypted.iv,
        encrypted.authTag
      );

      assert.deepStrictEqual(decrypted, plaintext);
    });

    it('should encrypt and decrypt with custom IV', () => {
      const key = encrypt.generateAESKey();
      const iv = encrypt.generateIV();
      const plaintext = 'Test with custom IV';

      const encrypted = encrypt.encrypt(plaintext, key, iv);
      
      // Verify our IV was used
      assert.deepStrictEqual(encrypted.iv, iv);

      const decrypted = encrypt.decrypt(
        encrypted.ciphertext,
        key,
        encrypted.iv,
        encrypted.authTag
      );

      assert.strictEqual(decrypted.toString('utf8'), plaintext);
    });

    it('should encrypt and decrypt with AAD (Additional Authenticated Data)', () => {
      const key = encrypt.generateAESKey();
      const plaintext = 'Authenticated data';
      const aad = Buffer.from('patient-id:12345');

      const encrypted = encrypt.encrypt(plaintext, key, null, aad);
      const decrypted = encrypt.decrypt(
        encrypted.ciphertext,
        key,
        encrypted.iv,
        encrypted.authTag,
        aad
      );

      assert.strictEqual(decrypted.toString('utf8'), plaintext);
    });

    it('should fail decryption with wrong key', () => {
      const key1 = encrypt.generateAESKey();
      const key2 = encrypt.generateAESKey();
      const plaintext = 'Secret data';

      const encrypted = encrypt.encrypt(plaintext, key1);

      assert.throws(() => {
        encrypt.decrypt(
          encrypted.ciphertext,
          key2,
          encrypted.iv,
          encrypted.authTag
        );
      }, /Unsupported state|unable to authenticate/i);
    });

    it('should fail decryption with tampered ciphertext', () => {
      const key = encrypt.generateAESKey();
      const plaintext = 'Tamper test';

      const encrypted = encrypt.encrypt(plaintext, key);
      
      // Tamper with ciphertext
      encrypted.ciphertext[0] ^= 0xFF;

      assert.throws(() => {
        encrypt.decrypt(
          encrypted.ciphertext,
          key,
          encrypted.iv,
          encrypted.authTag
        );
      }, /Unsupported state|unable to authenticate/i);
    });

    it('should fail decryption with wrong AAD', () => {
      const key = encrypt.generateAESKey();
      const plaintext = 'AAD test';
      const aad1 = Buffer.from('correct-aad');
      const aad2 = Buffer.from('wrong-aad');

      const encrypted = encrypt.encrypt(plaintext, key, null, aad1);

      assert.throws(() => {
        encrypt.decrypt(
          encrypted.ciphertext,
          key,
          encrypted.iv,
          encrypted.authTag,
          aad2
        );
      }, /Unsupported state|unable to authenticate/i);
    });
  });

  describe('Key validation', () => {
    it('should reject key of wrong length for encryption', () => {
      const wrongKey = Buffer.alloc(16); // 128 bits instead of 256

      assert.throws(() => {
        encrypt.encrypt('test', wrongKey);
      }, /Key must be a 32-byte Buffer/);
    });

    it('should reject non-buffer key', () => {
      assert.throws(() => {
        encrypt.encrypt('test', 'not-a-buffer-key');
      }, /Key must be a 32-byte Buffer/);
    });

    it('should reject IV of wrong length for decryption', () => {
      const key = encrypt.generateAESKey();
      const wrongIV = Buffer.alloc(16); // Wrong size
      const authTag = Buffer.alloc(16);
      const ciphertext = Buffer.from('test');

      assert.throws(() => {
        encrypt.decrypt(ciphertext, key, wrongIV, authTag);
      }, /IV must be a 12-byte Buffer/);
    });
  });
});

describe('SHA-256 Hashing', () => {
  
  describe('sha256', () => {
    it('should return 32-byte hash', () => {
      const hash = encrypt.sha256('test data');
      assert.strictEqual(Buffer.isBuffer(hash), true);
      assert.strictEqual(hash.length, 32);
    });

    it('should produce consistent hashes', () => {
      const data = 'consistent input';
      const hash1 = encrypt.sha256(data);
      const hash2 = encrypt.sha256(data);
      assert.deepStrictEqual(hash1, hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = encrypt.sha256('input1');
      const hash2 = encrypt.sha256('input2');
      assert.notDeepStrictEqual(hash1, hash2);
    });

    it('should hash Buffer input correctly', () => {
      const data = Buffer.from([0x01, 0x02, 0x03]);
      const hash = encrypt.sha256(data);
      assert.strictEqual(hash.length, 32);
    });
  });

  describe('sha256Hex', () => {
    it('should return 64-character hex string', () => {
      const hash = encrypt.sha256Hex('test');
      assert.strictEqual(typeof hash, 'string');
      assert.strictEqual(hash.length, 64);
      assert.match(hash, /^[0-9a-f]+$/);
    });

    it('should match known SHA-256 hash', () => {
      // Known test vector: SHA-256("hello") 
      const hash = encrypt.sha256Hex('hello');
      assert.strictEqual(
        hash,
        '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
      );
    });
  });

  describe('SHA-256 of sample file', () => {
    it('should hash a sample FHIR Patient file', () => {
      const sampleFilePath = path.join(
        __dirname, 
        '..', 
        '..', 
        'sample-data', 
        'fhir', 
        'Patient.json'
      );

      // Create sample file content for testing if it doesn't exist
      let fileContent;
      try {
        fileContent = fs.readFileSync(sampleFilePath, 'utf8');
      } catch (e) {
        // Use inline sample if file doesn't exist
        fileContent = JSON.stringify({
          resourceType: 'Patient',
          id: 'example',
          name: [{ family: 'Smith', given: ['John'] }]
        });
      }

      const hash = encrypt.sha256Hex(fileContent);
      
      assert.strictEqual(typeof hash, 'string');
      assert.strictEqual(hash.length, 64);
      console.log(`  Sample file SHA-256: ${hash}`);
    });
  });
});

describe('Key Wrapping', () => {
  
  describe('wrapKey and unwrapKey roundtrip', () => {
    it('should wrap and unwrap a symmetric key correctly', () => {
      const kek = encrypt.generateAESKey(); // Key Encryption Key
      const dataKey = encrypt.generateAESKey(); // Key to wrap

      const wrapped = encrypt.wrapKey(dataKey, kek);
      
      assert.ok(wrapped.wrappedKey);
      assert.ok(wrapped.iv);
      assert.ok(wrapped.authTag);

      const unwrapped = encrypt.unwrapKey(
        wrapped.wrappedKey,
        kek,
        wrapped.iv,
        wrapped.authTag
      );

      assert.deepStrictEqual(unwrapped, dataKey);
    });

    it('should fail unwrap with wrong KEK', () => {
      const kek1 = encrypt.generateAESKey();
      const kek2 = encrypt.generateAESKey();
      const dataKey = encrypt.generateAESKey();

      const wrapped = encrypt.wrapKey(dataKey, kek1);

      assert.throws(() => {
        encrypt.unwrapKey(
          wrapped.wrappedKey,
          kek2,
          wrapped.iv,
          wrapped.authTag
        );
      }, /Unsupported state|unable to authenticate/i);
    });
  });
});

describe('Pack/Unpack Encrypted Data', () => {
  
  it('should pack and unpack encrypted data correctly', () => {
    const key = encrypt.generateAESKey();
    const plaintext = 'Pack test data';

    const encrypted = encrypt.encrypt(plaintext, key);
    const packed = encrypt.packEncrypted(encrypted);

    assert.strictEqual(Buffer.isBuffer(packed), true);
    assert.strictEqual(packed.length, 12 + 16 + encrypted.ciphertext.length);

    const unpacked = encrypt.unpackEncrypted(packed);

    assert.deepStrictEqual(unpacked.iv, encrypted.iv);
    assert.deepStrictEqual(unpacked.authTag, encrypted.authTag);
    assert.deepStrictEqual(unpacked.ciphertext, encrypted.ciphertext);

    // Full roundtrip
    const decrypted = encrypt.decrypt(
      unpacked.ciphertext,
      key,
      unpacked.iv,
      unpacked.authTag
    );

    assert.strictEqual(decrypted.toString('utf8'), plaintext);
  });

  it('should reject packed data that is too short', () => {
    const tooShort = Buffer.alloc(20); // Less than IV + authTag

    assert.throws(() => {
      encrypt.unpackEncrypted(tooShort);
    }, /Packed data too short/);
  });
});

describe('Key Derivation', () => {
  
  it('should derive consistent key from password and salt', () => {
    const password = 'test-password-123';
    const salt = crypto.randomBytes(16);

    const result1 = encrypt.deriveKey(password, salt);
    const result2 = encrypt.deriveKey(password, salt);

    assert.deepStrictEqual(result1.key, result2.key);
    assert.deepStrictEqual(result1.salt, result2.salt);
  });

  it('should generate salt if not provided', () => {
    const password = 'test-password';

    const result = encrypt.deriveKey(password);

    assert.strictEqual(result.key.length, 32);
    assert.strictEqual(result.salt.length, 16);
  });

  it('should produce different keys with different salts', () => {
    const password = 'same-password';

    const result1 = encrypt.deriveKey(password);
    const result2 = encrypt.deriveKey(password);

    // Different salts should produce different keys
    assert.notDeepStrictEqual(result1.key, result2.key);
  });
});

// Run a quick integration test
describe('Integration', () => {
  
  it('should encrypt data, hash it, and decrypt correctly', () => {
    const key = encrypt.generateAESKey();
    const originalData = JSON.stringify({
      patientId: 'P12345',
      observation: 'Blood pressure: 120/80'
    });

    // Hash original
    const originalHash = encrypt.sha256Hex(originalData);

    // Encrypt
    const encrypted = encrypt.encrypt(originalData, key);

    // Hash encrypted (should be different)
    const encryptedHash = encrypt.sha256Hex(encrypted.ciphertext);
    assert.notStrictEqual(originalHash, encryptedHash);

    // Decrypt
    const decrypted = encrypt.decrypt(
      encrypted.ciphertext,
      key,
      encrypted.iv,
      encrypted.authTag
    );

    // Verify data integrity
    const decryptedHash = encrypt.sha256Hex(decrypted);
    assert.strictEqual(decryptedHash, originalHash);
    assert.strictEqual(decrypted.toString('utf8'), originalData);
  });
});
