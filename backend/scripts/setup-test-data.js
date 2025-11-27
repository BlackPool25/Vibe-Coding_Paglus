#!/usr/bin/env node
/**
 * Test Data Setup Script
 * 
 * Seeds the system with test data for integration testing:
 * 1. Creates test organizations in Vault
 * 2. Uploads a sample FHIR resource
 * 3. Stores encryption keys in Vault
 * 4. Grants access between orgs
 * 
 * Usage:
 *   node scripts/setup-test-data.js
 * 
 * Prerequisites:
 *   - Vault running at VAULT_ADDR with token VAULT_TOKEN
 *   - IPFS running at IPFS_API or WEB3_STORAGE_TOKEN set
 * 
 * References:
 * - Vault KV v2: https://developer.hashicorp.com/vault/api-docs/secret/kv/kv-v2
 * - IPFS HTTP API: https://docs.ipfs.tech/reference/kubo/rpc/
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Configuration
const VAULT_ADDR = process.env.VAULT_ADDR || 'http://127.0.0.1:8200';
const VAULT_TOKEN = process.env.VAULT_TOKEN || 'dev-root-token';
const IPFS_API = process.env.IPFS_API || 'http://127.0.0.1:5001';

// Test data constants
const TEST_RESOURCE_ID = 'obs-test-123';
const TEST_ORG_OWNER = 'org1';
const TEST_ORG_GRANTEE = 'org2';

// Sample FHIR Observation (~500 bytes -> ~5KB with formatting)
const SAMPLE_OBSERVATION = {
  resourceType: 'Observation',
  id: TEST_RESOURCE_ID,
  meta: {
    versionId: '1',
    lastUpdated: '2025-01-15T10:30:00.000Z',
    source: '#test-setup'
  },
  status: 'final',
  category: [
    {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: 'vital-signs',
          display: 'Vital Signs'
        }
      ]
    }
  ],
  code: {
    coding: [
      {
        system: 'http://loinc.org',
        code: '85354-9',
        display: 'Blood pressure panel with all children optional'
      }
    ],
    text: 'Blood pressure systolic & diastolic'
  },
  subject: {
    reference: 'Patient/patient-123',
    display: 'Test Patient'
  },
  effectiveDateTime: '2025-01-15T10:30:00Z',
  issued: '2025-01-15T10:35:00.000Z',
  performer: [
    {
      reference: 'Practitioner/practitioner-456',
      display: 'Dr. Test'
    }
  ],
  component: [
    {
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '8480-6',
            display: 'Systolic blood pressure'
          }
        ]
      },
      valueQuantity: {
        value: 120,
        unit: 'mmHg',
        system: 'http://unitsofmeasure.org',
        code: 'mm[Hg]'
      }
    },
    {
      code: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '8462-4',
            display: 'Diastolic blood pressure'
          }
        ]
      },
      valueQuantity: {
        value: 80,
        unit: 'mmHg',
        system: 'http://unitsofmeasure.org',
        code: 'mm[Hg]'
      }
    }
  ]
};

/**
 * Encrypts data using AES-256-GCM
 */
function encryptData(plaintext) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  
  // Pack: [IV (12)] [AuthTag (16)] [Ciphertext]
  const packed = Buffer.concat([iv, authTag, ciphertext]);
  const sha256 = crypto.createHash('sha256').update(packed).digest('hex');
  
  return {
    packed,
    sha256,
    aesKey,
    iv,
    authTag
  };
}

/**
 * Stores a key in Vault KV v2
 */
async function storeInVault(path, data) {
  const axios = (await import('axios')).default;
  
  const url = `${VAULT_ADDR}/v1/secret/data/${path}`;
  
  try {
    await axios.post(url, { data }, {
      headers: {
        'X-Vault-Token': VAULT_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    console.log(`  ✓ Stored in Vault: ${path}`);
    return true;
  } catch (error) {
    console.error(`  ✗ Failed to store in Vault: ${error.message}`);
    throw error;
  }
}

/**
 * Uploads encrypted data to local IPFS
 */
async function uploadToIPFS(buffer, filename) {
  const FormData = (await import('form-data')).default;
  const axios = (await import('axios')).default;
  
  const form = new FormData();
  form.append('file', buffer, { filename });
  
  try {
    const response = await axios.post(`${IPFS_API}/api/v0/add`, form, {
      headers: form.getHeaders(),
      params: { 'cid-version': 1, pin: true }
    });
    
    const cid = response.data.Hash;
    console.log(`  ✓ Uploaded to IPFS: ${cid}`);
    return cid;
  } catch (error) {
    console.error(`  ✗ Failed to upload to IPFS: ${error.message}`);
    console.error('    Ensure IPFS daemon is running: ipfs daemon');
    throw error;
  }
}

/**
 * Main setup function
 */
async function setup() {
  console.log('═'.repeat(60));
  console.log('Test Data Setup');
  console.log('═'.repeat(60));
  console.log(`Vault:     ${VAULT_ADDR}`);
  console.log(`IPFS API:  ${IPFS_API}`);
  console.log('─'.repeat(60));
  
  try {
    // Step 1: Encrypt the sample FHIR resource
    console.log('\n1. Encrypting sample FHIR Observation...');
    const plaintext = Buffer.from(JSON.stringify(SAMPLE_OBSERVATION, null, 2));
    console.log(`   Plaintext size: ${plaintext.length} bytes`);
    
    const encrypted = encryptData(plaintext);
    console.log(`   Encrypted size: ${encrypted.packed.length} bytes`);
    console.log(`   SHA-256: ${encrypted.sha256.substring(0, 32)}...`);
    
    // Step 2: Upload to IPFS
    console.log('\n2. Uploading encrypted data to IPFS...');
    const cid = await uploadToIPFS(encrypted.packed, `${TEST_RESOURCE_ID}.encrypted`);
    
    // Step 3: Store encryption key in Vault
    console.log('\n3. Storing encryption key in Vault...');
    await storeInVault(`owner/keys/${TEST_RESOURCE_ID}`, {
      aesKey: encrypted.aesKey.toString('hex'),
      iv: encrypted.iv.toString('hex'),
      authTag: encrypted.authTag.toString('hex'),
      resourceId: TEST_RESOURCE_ID,
      createdAt: new Date().toISOString()
    });
    
    // Step 4: Store shared key for grantee org (simulating PRE result)
    console.log('\n4. Creating shared key for grantee org (simulating PRE)...');
    await storeInVault(`shared-keys/${TEST_RESOURCE_ID}/${TEST_ORG_GRANTEE}`, {
      aesKey: encrypted.aesKey.toString('hex'),
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86400000).toISOString() // 24h expiry
    });
    
    // Step 5: Output summary
    console.log('\n' + '═'.repeat(60));
    console.log('✅ Test Data Setup Complete');
    console.log('═'.repeat(60));
    console.log('\nResource Details:');
    console.log(`  Resource ID:  ${TEST_RESOURCE_ID}`);
    console.log(`  CID:          ${cid}`);
    console.log(`  SHA-256:      ${encrypted.sha256}`);
    console.log(`  FHIR Type:    Observation`);
    console.log(`  Owner Org:    ${TEST_ORG_OWNER}`);
    console.log(`  Grantee Org:  ${TEST_ORG_GRANTEE}`);
    
    console.log('\nTest Commands:');
    console.log('─'.repeat(60));
    console.log(`# Retrieve as owner:`);
    console.log(`curl -H "x-org-id: ${TEST_ORG_OWNER}" http://localhost:4000/resource/${TEST_RESOURCE_ID}`);
    console.log('');
    console.log(`# Retrieve as grantee:`);
    console.log(`curl -H "x-org-id: ${TEST_ORG_GRANTEE}" http://localhost:4000/resource/${TEST_RESOURCE_ID}`);
    console.log('');
    console.log('# Run benchmark:');
    console.log(`node scripts/benchmark-resource.js ${TEST_RESOURCE_ID} 5 ${TEST_ORG_GRANTEE}`);
    console.log('─'.repeat(60));
    
    // Save test config for reference
    const testConfig = {
      resourceId: TEST_RESOURCE_ID,
      cid: cid,
      sha256: encrypted.sha256,
      fhirType: 'Observation',
      ownerOrg: TEST_ORG_OWNER,
      granteeOrg: TEST_ORG_GRANTEE,
      createdAt: new Date().toISOString()
    };
    
    const configPath = path.join(__dirname, 'test-config.json');
    fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));
    console.log(`\nTest config saved to: ${configPath}`);
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    process.exit(1);
  }
}

// Run setup
setup();
