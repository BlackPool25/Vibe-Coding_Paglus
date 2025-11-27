/**
 * Upload Route - POST /upload
 * 
 * Accepts multipart/form-data with:
 * - 'file': The file to encrypt and upload
 * - 'fhir': JSON string with FHIR metadata (resourceType, id, etc.)
 * 
 * Flow:
 * 1. Parse multipart form data
 * 2. Encrypt file using AES-256-GCM (encrypt.js)
 * 3. Compute SHA-256 of encrypted content
 * 4. Upload encrypted file to IPFS (web3.storage or local node)
 * 5. Write metadata to blockchain via chaincode.uploadMeta()
 * 6. Return { cid, sha256, fhirType, fhirId }
 * 
 * References:
 * - Express file uploads: https://expressjs.com/en/5x/api.html#req.body
 * - Multer (file upload middleware): https://github.com/expressjs/multer
 * - web3.storage: https://web3.storage/docs/
 * - IPFS HTTP API: https://docs.ipfs.tech/reference/kubo/rpc/
 * - Fabric Node SDK: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html
 * 
 * Environment Variables:
 * - WEB3_STORAGE_TOKEN: Token for web3.storage (if set, uses web3.storage)
 * - IPFS_API: URL for local IPFS node (default: http://127.0.0.1:5001)
 * 
 * SECURITY NOTE: No PHI is logged. Only CIDs and hashes at debug level.
 */

'use strict';

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');

// Import local modules
const encrypt = require('../crypto/encrypt');
const ipfsService = require('../services/ipfs');
const fabricClient = require('../fabric-client');

const router = express.Router();

// Configure multer for memory storage
// Files are processed in memory, encrypted, then uploaded
// For large files (>100MB), consider streaming approach
const storage = multer.memoryStorage();

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max file size
    files: 1
  }
});

/**
 * POST /upload
 * 
 * Uploads a file with encryption to IPFS and records metadata on-chain.
 * 
 * Request (multipart/form-data):
 * - file: The file to upload (required)
 * - fhir: JSON string with FHIR metadata (required)
 *   Example: {"resourceType": "Observation", "id": "obs-123", "patientId": "patient-456"}
 * 
 * Response:
 * {
 *   "success": true,
 *   "cid": "bafybeig...",
 *   "sha256": "abc123...",
 *   "fhirType": "Observation",
 *   "fhirId": "obs-123",
 *   "backend": "web3.storage" | "local-ipfs",
 *   "chaincode": { ... }
 * }
 */
router.post('/', upload.single('file'), async (req, res) => {
  try {
    // Validate file presence
    if (!req.file) {
      return res.status(400).json({
        error: 'No file provided',
        message: 'Request must include a "file" field with multipart/form-data'
      });
    }

    // Parse FHIR metadata
    let fhirMeta;
    try {
      if (!req.body.fhir) {
        return res.status(400).json({
          error: 'Missing FHIR metadata',
          message: 'Request must include a "fhir" field with JSON metadata'
        });
      }
      fhirMeta = JSON.parse(req.body.fhir);
    } catch (parseError) {
      return res.status(400).json({
        error: 'Invalid FHIR metadata',
        message: 'The "fhir" field must be valid JSON'
      });
    }

    // Validate required FHIR fields
    if (!fhirMeta.resourceType) {
      return res.status(400).json({
        error: 'Invalid FHIR metadata',
        message: 'FHIR metadata must include "resourceType"'
      });
    }

    const fhirType = fhirMeta.resourceType;
    const fhirId = fhirMeta.id || crypto.randomUUID();

    // Get file buffer
    const fileBuffer = req.file.buffer;
    const originalFileName = req.file.originalname || 'upload.bin';

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[upload] Processing file: ${originalFileName}, size: ${fileBuffer.length} bytes`);
    }

    // Step 1: Generate AES key and encrypt the file
    // Using AES-256-GCM per encrypt.js
    const aesKey = encrypt.generateAESKey();
    const encryptedData = encrypt.encrypt(fileBuffer, aesKey);
    
    // Pack encrypted data: [IV][AuthTag][Ciphertext]
    const packedEncrypted = encrypt.packEncrypted(encryptedData);

    // Step 2: Compute SHA-256 of the encrypted content
    // This hash is stored on-chain for integrity verification
    const sha256Hash = encrypt.sha256Hex(packedEncrypted);

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[upload] Encrypted file size: ${packedEncrypted.length} bytes, SHA256: ${sha256Hash.substring(0, 16)}...`);
    }

    // Step 3: Upload encrypted file to IPFS
    // ipfsService.upload() auto-detects web3.storage or local IPFS
    const ipfsResult = await ipfsService.upload(
      packedEncrypted,
      `${fhirType}-${fhirId}.encrypted`
    );

    const cid = ipfsResult.cid;
    const backend = ipfsResult.backend;

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[upload] Uploaded to ${backend}, CID: ${cid}`);
    }

    // Step 4: Write metadata to blockchain via chaincode
    // The uploadMeta function stores: CID, SHA256, FHIR type, timestamp
    let chaincodeResult = null;
    try {
      chaincodeResult = await fabricClient.submitTransaction('uploadMeta', [
        cid,                           // IPFS CID
        sha256Hash,                    // SHA-256 of encrypted content
        fhirType,                      // FHIR resource type
        fhirId,                        // FHIR resource ID
        fhirMeta.patientId || '',      // Patient ID (for consent lookup)
        new Date().toISOString()       // Timestamp
      ]);

      if (process.env.LOG_LEVEL === 'debug') {
        console.debug(`[upload] Chaincode uploadMeta completed`);
      }
    } catch (chaincodeError) {
      // Log error but don't fail the upload
      // Data is already on IPFS, metadata recording failed
      console.error(`[upload] Chaincode error: ${chaincodeError.message}`);
      chaincodeResult = {
        success: false,
        error: chaincodeError.message,
        stub: true // Indicates stub was used
      };
    }

    // Step 5: Store the encryption key securely
    // In production, this should go to Vault keyed by CID
    // For now, we include key info in response (development only)
    const keyInfo = {
      keyId: `key-${cid.substring(0, 16)}`,
      // WARNING: Never expose actual key in production!
      // This is for development/testing only
      ...(process.env.NODE_ENV !== 'production' && {
        _devOnly_aesKey: aesKey.toString('hex'),
        _devOnly_iv: encryptedData.iv.toString('hex'),
        _devOnly_authTag: encryptedData.authTag.toString('hex')
      })
    };

    // Return success response
    res.status(201).json({
      success: true,
      cid: cid,
      sha256: sha256Hash,
      fhirType: fhirType,
      fhirId: fhirId,
      backend: backend,
      fileSize: {
        original: fileBuffer.length,
        encrypted: packedEncrypted.length
      },
      chaincode: chaincodeResult,
      keyInfo: keyInfo
    });

  } catch (error) {
    console.error(`[upload] Error: ${error.message}`);
    
    // Determine appropriate error response
    if (error.message.includes('web3.storage') || error.message.includes('IPFS')) {
      return res.status(503).json({
        error: 'Storage service unavailable',
        message: error.message,
        hint: 'Ensure WEB3_STORAGE_TOKEN is set or local IPFS daemon is running'
      });
    }

    res.status(500).json({
      error: 'Upload failed',
      message: process.env.NODE_ENV === 'production' 
        ? 'Internal server error' 
        : error.message
    });
  }
});

/**
 * GET /upload/info
 * 
 * Returns information about the configured IPFS backend
 */
router.get('/info', (req, res) => {
  const backendInfo = ipfsService.getBackendInfo();
  
  res.json({
    uploadEndpoint: '/upload',
    method: 'POST',
    contentType: 'multipart/form-data',
    fields: {
      file: 'required - The file to upload',
      fhir: 'required - JSON string with FHIR metadata (resourceType, id, patientId)'
    },
    storage: backendInfo,
    encryption: {
      algorithm: 'AES-256-GCM',
      keySize: '256 bits',
      ivSize: '96 bits (12 bytes)',
      authTagSize: '128 bits (16 bytes)'
    },
    limits: {
      maxFileSize: '500MB',
      // NOTE: For files > 100MB, web3.storage automatically handles chunking
      // Per https://web3.storage/docs/concepts/car-files/
      chunkingNote: 'Files > 100MB are automatically chunked by web3.storage into ~100MB CAR blocks'
    }
  });
});

/**
 * GET /upload/health
 * 
 * Health check for the upload service
 */
router.get('/health', async (req, res) => {
  const backendInfo = ipfsService.getBackendInfo();
  
  res.json({
    status: 'ok',
    backend: backendInfo.backend,
    configured: backendInfo.configured
  });
});

module.exports = router;
