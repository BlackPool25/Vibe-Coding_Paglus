#!/usr/bin/env node

/**
 * Upload Sample Script
 * 
 * Demonstrates the upload flow: encrypt file -> upload to IPFS -> compute SHA-256
 * 
 * Usage:
 *   node backend/scripts/upload-sample.js <file-path> [fhir-type]
 * 
 * Examples:
 *   node backend/scripts/upload-sample.js sample-data/fhir/Observation.json
 *   node backend/scripts/upload-sample.js sample-data/fhir/Patient.json Patient
 * 
 * Environment Variables:
 *   WEB3_STORAGE_TOKEN - Token for web3.storage (optional, falls back to local IPFS)
 *   IPFS_API - Local IPFS API URL (default: http://127.0.0.1:5001)
 *   LOG_LEVEL - Set to 'debug' for verbose output
 * 
 * References:
 *   - web3.storage: https://web3.storage/docs/
 *   - IPFS HTTP API: https://docs.ipfs.tech/reference/kubo/rpc/
 *   - Node.js Crypto: https://nodejs.org/api/crypto.html
 * 
 * Output (JSON):
 *   {
 *     "success": true,
 *     "cid": "bafybeig...",
 *     "sha256": "abc123...",
 *     "fhirType": "Observation",
 *     "fhirId": "obs-123",
 *     "backend": "local-ipfs",
 *     "verifyUrl": "https://dweb.link/ipfs/<cid>"
 *   }
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Add parent src to module path
const srcPath = path.join(__dirname, '..', 'src');

// Import modules using relative paths
const encrypt = require(path.join(srcPath, 'crypto', 'encrypt'));
const ipfsService = require(path.join(srcPath, 'services', 'ipfs'));

/**
 * Main upload function
 * 
 * @param {string} filePath - Path to the file to upload
 * @param {string} [fhirType] - FHIR resource type (auto-detected from JSON if not provided)
 */
async function uploadSample(filePath, fhirType = null) {
  console.error('[upload-sample] Starting upload flow...');
  console.error(`[upload-sample] File: ${filePath}`);

  // Step 1: Read the file
  const absolutePath = path.resolve(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const fileBuffer = fs.readFileSync(absolutePath);
  const fileName = path.basename(absolutePath);
  const fileExt = path.extname(absolutePath).toLowerCase();

  console.error(`[upload-sample] File size: ${fileBuffer.length} bytes`);

  // Step 2: Try to detect FHIR type from JSON content
  let detectedFhirType = fhirType;
  let fhirId = null;

  if (!detectedFhirType && (fileExt === '.json' || fileExt === '.fhir')) {
    try {
      const content = JSON.parse(fileBuffer.toString('utf8'));
      if (content.resourceType) {
        detectedFhirType = content.resourceType;
        fhirId = content.id || null;
        console.error(`[upload-sample] Detected FHIR type: ${detectedFhirType}`);
      }
    } catch (e) {
      // Not valid JSON, continue with provided type
    }
  }

  // Default to 'Binary' if no type detected
  if (!detectedFhirType) {
    detectedFhirType = 'Binary';
    console.error(`[upload-sample] Using default FHIR type: Binary`);
  }

  // Generate a FHIR ID if not found
  if (!fhirId) {
    fhirId = `${detectedFhirType.toLowerCase()}-${Date.now()}`;
  }

  // Step 3: Generate AES key and encrypt the file
  console.error('[upload-sample] Encrypting file with AES-256-GCM...');
  
  const aesKey = encrypt.generateAESKey();
  const encryptedData = encrypt.encrypt(fileBuffer, aesKey);
  
  // Pack encrypted data: [IV][AuthTag][Ciphertext]
  const packedEncrypted = encrypt.packEncrypted(encryptedData);

  console.error(`[upload-sample] Encrypted size: ${packedEncrypted.length} bytes`);

  // Step 4: Compute SHA-256 of encrypted content
  const sha256Hash = encrypt.sha256Hex(packedEncrypted);
  console.error(`[upload-sample] SHA-256: ${sha256Hash}`);

  // Step 5: Upload to IPFS
  console.error('[upload-sample] Uploading to IPFS...');
  
  const backendInfo = ipfsService.getBackendInfo();
  console.error(`[upload-sample] Backend: ${backendInfo.backend}`);

  const ipfsResult = await ipfsService.upload(
    packedEncrypted,
    `${detectedFhirType}-${fhirId}.encrypted`
  );

  const cid = ipfsResult.cid;
  console.error(`[upload-sample] CID: ${cid}`);

  // Step 6: Construct verify URL
  // Per IPFS docs: https://docs.ipfs.tech/concepts/ipfs-gateway/
  const verifyUrl = backendInfo.backend === 'local-ipfs'
    ? `http://127.0.0.1:8080/ipfs/${cid}`
    : `https://dweb.link/ipfs/${cid}`;

  // Prepare result
  const result = {
    success: true,
    cid: cid,
    sha256: sha256Hash,
    fhirType: detectedFhirType,
    fhirId: fhirId,
    backend: ipfsResult.backend,
    verifyUrl: verifyUrl,
    originalFile: {
      name: fileName,
      size: fileBuffer.length
    },
    encryptedSize: packedEncrypted.length,
    // Include key info for verification (development only)
    _devOnly: {
      aesKeyHex: aesKey.toString('hex'),
      ivHex: encryptedData.iv.toString('hex'),
      authTagHex: encryptedData.authTag.toString('hex')
    }
  };

  // Output JSON result to stdout
  console.log(JSON.stringify(result, null, 2));

  return result;
}

/**
 * Verify a previously uploaded file by fetching from IPFS
 * 
 * @param {string} cid - The IPFS CID
 * @param {string} expectedSha256 - Expected SHA-256 hash
 */
async function verifyUpload(cid, expectedSha256) {
  console.error(`[verify] Fetching CID: ${cid}`);
  
  const content = await ipfsService.fetchFromIpfs(cid);
  const actualSha256 = encrypt.sha256Hex(content);
  
  const match = actualSha256 === expectedSha256;
  
  console.error(`[verify] Expected SHA-256: ${expectedSha256}`);
  console.error(`[verify] Actual SHA-256:   ${actualSha256}`);
  console.error(`[verify] Match: ${match}`);

  return {
    cid: cid,
    expectedSha256: expectedSha256,
    actualSha256: actualSha256,
    match: match,
    contentSize: content.length
  };
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node upload-sample.js <file-path> [fhir-type]');
    console.error('');
    console.error('Examples:');
    console.error('  node backend/scripts/upload-sample.js sample-data/fhir/Observation.json');
    console.error('  node backend/scripts/upload-sample.js sample-data/fhir/Patient.json Patient');
    console.error('');
    console.error('Environment Variables:');
    console.error('  WEB3_STORAGE_TOKEN - Token for web3.storage (optional)');
    console.error('  IPFS_API - Local IPFS API URL (default: http://127.0.0.1:5001)');
    process.exit(1);
  }

  const filePath = args[0];
  const fhirType = args[1] || null;

  try {
    await uploadSample(filePath, fhirType);
  } catch (error) {
    console.error(`[upload-sample] Error: ${error.message}`);
    
    // Provide helpful hints
    if (error.message.includes('ECONNREFUSED')) {
      console.error('');
      console.error('Hint: Local IPFS node is not running.');
      console.error('Start IPFS daemon with: ipfs daemon');
      console.error('Or set WEB3_STORAGE_TOKEN to use web3.storage instead.');
    }
    
    if (error.message.includes('WEB3_STORAGE_TOKEN')) {
      console.error('');
      console.error('Hint: To use web3.storage, set the WEB3_STORAGE_TOKEN environment variable.');
      console.error('Get a token from: https://web3.storage/');
    }

    process.exit(1);
  }
}

main();
