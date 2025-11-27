/**
 * Backend API Integration Test Script
 * 
 * Tests the backend server endpoints including:
 * - Health check
 * - Organization registration
 * 
 * Run with: node tests/backend/api-test.js
 * 
 * Prerequisites:
 * - Backend server running on port 4000
 * - Vault running on port 8200
 */

'use strict';

const http = require('http');

const BASE_URL = 'http://localhost:4000';

/**
 * Makes an HTTP request and returns a promise
 */
function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: JSON.parse(data)
          });
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function runTests() {
  console.log('='.repeat(60));
  console.log('Backend API Integration Tests');
  console.log('='.repeat(60));
  console.log();

  let passed = 0;
  let failed = 0;

  // Test 1: Health Check
  console.log('Test 1: Health Check');
  console.log('-'.repeat(40));
  try {
    const health = await makeRequest('GET', '/health');
    console.log(`Status: ${health.status}`);
    console.log(`Response: ${JSON.stringify(health.body, null, 2)}`);
    
    if (health.status === 200 && health.body.status === 'ok') {
      console.log('✅ PASSED\n');
      passed++;
    } else {
      console.log('❌ FAILED\n');
      failed++;
    }
  } catch (e) {
    console.log(`❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // Test 2: Organization Registration
  console.log('Test 2: POST /org/register');
  console.log('-'.repeat(40));
  try {
    const org = await makeRequest('POST', '/org/register', {
      orgId: 'org1',
      name: 'Hospital A'
    });
    console.log(`Status: ${org.status}`);
    console.log(`Response: ${JSON.stringify(org.body, null, 2)}`);
    
    if (org.status === 201 && org.body.orgId === 'org1' && org.body.vaultPath) {
      console.log('✅ PASSED\n');
      passed++;
    } else {
      console.log('❌ FAILED\n');
      failed++;
    }
  } catch (e) {
    console.log(`❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // Test 3: Get Organization
  console.log('Test 3: GET /org/org1');
  console.log('-'.repeat(40));
  try {
    const org = await makeRequest('GET', '/org/org1');
    console.log(`Status: ${org.status}`);
    console.log(`Response: ${JSON.stringify(org.body, null, 2)}`);
    
    if (org.status === 200 && org.body.orgId === 'org1' && org.body.publicKey) {
      console.log('✅ PASSED\n');
      passed++;
    } else {
      console.log('❌ FAILED\n');
      failed++;
    }
  } catch (e) {
    console.log(`❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // Test 4: List Organizations
  console.log('Test 4: GET /org');
  console.log('-'.repeat(40));
  try {
    const orgs = await makeRequest('GET', '/org');
    console.log(`Status: ${orgs.status}`);
    console.log(`Response: ${JSON.stringify(orgs.body, null, 2)}`);
    
    if (orgs.status === 200 && Array.isArray(orgs.body.organizations)) {
      console.log('✅ PASSED\n');
      passed++;
    } else {
      console.log('❌ FAILED\n');
      failed++;
    }
  } catch (e) {
    console.log(`❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // Test 5: Validation - Missing orgId
  console.log('Test 5: POST /org/register (missing orgId - should fail)');
  console.log('-'.repeat(40));
  try {
    const org = await makeRequest('POST', '/org/register', {
      name: 'Hospital B'
    });
    console.log(`Status: ${org.status}`);
    console.log(`Response: ${JSON.stringify(org.body, null, 2)}`);
    
    if (org.status === 400 && org.body.error) {
      console.log('✅ PASSED (correctly rejected)\n');
      passed++;
    } else {
      console.log('❌ FAILED (should have returned 400)\n');
      failed++;
    }
  } catch (e) {
    console.log(`❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // Test 6: Register with RSA key type
  console.log('Test 6: POST /org/register (RSA key type)');
  console.log('-'.repeat(40));
  try {
    const org = await makeRequest('POST', '/org/register', {
      orgId: 'org2',
      name: 'Clinic B',
      keyType: 'RSA'
    });
    console.log(`Status: ${org.status}`);
    console.log(`Response: ${JSON.stringify(org.body, null, 2)}`);
    
    if (org.status === 201 && org.body.keyType === 'RSA') {
      console.log('✅ PASSED\n');
      passed++;
    } else {
      console.log('❌ FAILED\n');
      failed++;
    }
  } catch (e) {
    console.log(`❌ FAILED: ${e.message}\n`);
    failed++;
  }

  // Summary
  console.log('='.repeat(60));
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(60));

  // Exit with error if any tests failed
  process.exit(failed > 0 ? 1 : 0);
}

// Check if server is running
http.get(`${BASE_URL}/health`, (res) => {
  runTests();
}).on('error', (e) => {
  console.error('❌ Server is not running on port 4000');
  console.error('Please start the server first:');
  console.error('  cd backend');
  console.error('  $env:VAULT_TOKEN="dev-root-token"');
  console.error('  $env:VAULT_ADDR="http://127.0.0.1:8200"');
  console.error('  node src/server.js');
  process.exit(1);
});
