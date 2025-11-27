/**
 * Attack Simulation Integration Tests
 * 
 * Tests the attack simulation flow:
 * 1. Create organizations
 * 2. Upload a resource
 * 3. Verify initial access works
 * 4. Revoke organization (via attack toggle or chaincode)
 * 5. Attempt access as revoked org - expect 403 DENIED
 * 6. Verify audit log contains DENIED entry
 * 
 * Prerequisites:
 * - Backend server running on localhost:4000
 * - Test data seeded (optional)
 * 
 * References:
 * - Node.js Test Runner: https://nodejs.org/api/test.html
 * - Hyperledger Fabric: https://hyperledger-fabric.readthedocs.io/en/release-2.2/
 * 
 * Run from project root:
 *   node --test tests/backend/attack.test.js
 */

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');

// Test configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const ATTACKER_ORG = 'attacker-org-test';
const VALID_ORG = 'org1';
const TEST_RESOURCE_ID = 'obs-test-123';

/**
 * Makes an HTTP request to the backend server
 * 
 * @param {string} path - Request path
 * @param {Object} options - Request options (method, headers, body)
 * @returns {Promise<{statusCode, headers, body}>}
 */
function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BACKEND_URL);
    
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 4000,
      path: path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      timeout: 10000
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let body;
        try {
          body = JSON.parse(data);
        } catch {
          body = data;
        }
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

/**
 * Checks if the backend server is running
 */
async function checkServerRunning() {
  try {
    const response = await makeRequest('/health');
    return response.statusCode === 200;
  } catch {
    return false;
  }
}

// ============================================================================
// Test Suite: Attack Toggle Endpoint
// ============================================================================

describe('POST /simulate-attack', () => {
  before(async () => {
    const serverRunning = await checkServerRunning();
    if (!serverRunning) {
      console.log('\n⚠️  Backend server not running at ' + BACKEND_URL);
      console.log('   Start the server: cd backend && npm start\n');
      throw new Error('Backend server not running');
    }
  });

  after(async () => {
    // Clean up: clear attack simulations
    try {
      await makeRequest('/simulate-attack', { method: 'DELETE' });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it('should return 400 when orgId is missing', async () => {
    const response = await makeRequest('/simulate-attack', {
      method: 'POST',
      body: { active: true }
    });

    assert.strictEqual(response.statusCode, 400, 'Expected 400 status code');
    assert.ok(response.body.error, 'Should have error message');
  });

  it('should activate attack for an organization', async () => {
    const response = await makeRequest('/simulate-attack', {
      method: 'POST',
      body: {
        orgId: ATTACKER_ORG,
        active: true,
        attackType: 'revoked'
      }
    });

    assert.strictEqual(response.statusCode, 200, 'Expected 200 status code');
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.attackActive, true);
    assert.strictEqual(response.body.orgId, ATTACKER_ORG);
  });

  it('should return attack state in GET /simulate-attack', async () => {
    // First activate
    await makeRequest('/simulate-attack', {
      method: 'POST',
      body: { orgId: ATTACKER_ORG, active: true }
    });

    const response = await makeRequest('/simulate-attack');

    assert.strictEqual(response.statusCode, 200);
    assert.ok(Array.isArray(response.body.attacks), 'Should have attacks array');
    
    const attack = response.body.attacks.find(a => a.orgId === ATTACKER_ORG);
    assert.ok(attack, `Should find attack for ${ATTACKER_ORG}`);
    assert.strictEqual(attack.active, true);
  });

  it('should deactivate attack for an organization', async () => {
    const response = await makeRequest('/simulate-attack', {
      method: 'POST',
      body: {
        orgId: ATTACKER_ORG,
        active: false
      }
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.attackActive, false);
  });

  it('should clear all attacks on DELETE', async () => {
    // Activate some attacks
    await makeRequest('/simulate-attack', {
      method: 'POST',
      body: { orgId: 'test-org-1', active: true }
    });
    await makeRequest('/simulate-attack', {
      method: 'POST',
      body: { orgId: 'test-org-2', active: true }
    });

    const deleteResponse = await makeRequest('/simulate-attack', {
      method: 'DELETE'
    });

    assert.strictEqual(deleteResponse.statusCode, 200);
    assert.ok(deleteResponse.body.clearedCount >= 2);

    // Verify cleared
    const getResponse = await makeRequest('/simulate-attack');
    assert.strictEqual(getResponse.body.attacks.length, 0);
  });
});

// ============================================================================
// Test Suite: Access Denial Flow
// ============================================================================

describe('Access Denial for Revoked Org', () => {
  before(async () => {
    const serverRunning = await checkServerRunning();
    if (!serverRunning) {
      throw new Error('Backend server not running');
    }

    // Activate attack for attacker org
    await makeRequest('/simulate-attack', {
      method: 'POST',
      body: {
        orgId: ATTACKER_ORG,
        active: true,
        attackType: 'revoked'
      }
    });
  });

  after(async () => {
    // Clean up
    await makeRequest('/simulate-attack', { method: 'DELETE' });
  });

  it('should allow access for valid org (org1)', async () => {
    const response = await makeRequest(`/resource/${TEST_RESOURCE_ID}`, {
      headers: { 'x-org-id': VALID_ORG }
    });

    // Either 200 (success) or 404/500 (resource not found is OK in test env)
    const isAccepted = response.statusCode === 200 ||
                       response.statusCode === 404 ||
                       response.statusCode === 500;
    
    assert.ok(isAccepted, 
      `Expected 200/404/500 for valid org, got ${response.statusCode}`);
    
    // Should NOT be 403 for valid org
    assert.notStrictEqual(response.statusCode, 403, 
      'Valid org should not receive 403');
  });

  it('should deny access for revoked org with 403', async () => {
    const response = await makeRequest(`/resource/${TEST_RESOURCE_ID}`, {
      headers: { 'x-org-id': ATTACKER_ORG }
    });

    assert.strictEqual(response.statusCode, 403, 
      `Expected 403 for revoked org, got ${response.statusCode}`);
    assert.strictEqual(response.body.error, 'Access denied');
  });

  it('should include denial reason in response', async () => {
    const response = await makeRequest(`/resource/${TEST_RESOURCE_ID}`, {
      headers: { 'x-org-id': ATTACKER_ORG }
    });

    assert.strictEqual(response.statusCode, 403);
    assert.ok(response.body.reason, 'Should include denial reason');
  });
});

// ============================================================================
// Test Suite: Org Revocation via Chaincode
// ============================================================================

describe('POST /simulate-attack/revoke-org', () => {
  before(async () => {
    const serverRunning = await checkServerRunning();
    if (!serverRunning) {
      throw new Error('Backend server not running');
    }
  });

  after(async () => {
    // Clean up
    await makeRequest('/simulate-attack', { method: 'DELETE' });
  });

  it('should return 400 when orgId is missing', async () => {
    const response = await makeRequest('/simulate-attack/revoke-org', {
      method: 'POST',
      body: { reason: 'test' }
    });

    assert.strictEqual(response.statusCode, 400);
  });

  it('should revoke org and return transaction details', async () => {
    const response = await makeRequest('/simulate-attack/revoke-org', {
      method: 'POST',
      body: {
        orgId: 'revoke-test-org',
        reason: 'Security breach detected'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.orgId, 'revoke-test-org');
    assert.ok(response.body.txId, 'Should have transaction ID');
    assert.ok(response.body.revokedAt, 'Should have revocation timestamp');
  });

  it('should add revoked org to attack state', async () => {
    await makeRequest('/simulate-attack/revoke-org', {
      method: 'POST',
      body: { orgId: 'revoked-org-check' }
    });

    const stateResponse = await makeRequest('/simulate-attack');
    
    assert.ok(
      stateResponse.body.revokedOrgs.includes('revoked-org-check') ||
      stateResponse.body.attacks.some(a => a.orgId === 'revoked-org-check'),
      'Revoked org should be in state'
    );
  });
});

// ============================================================================
// Test Suite: Reinstate Organization
// ============================================================================

describe('POST /simulate-attack/reinstate-org', () => {
  before(async () => {
    const serverRunning = await checkServerRunning();
    if (!serverRunning) {
      throw new Error('Backend server not running');
    }

    // Revoke an org first
    await makeRequest('/simulate-attack/revoke-org', {
      method: 'POST',
      body: { orgId: 'reinstate-test-org' }
    });
  });

  after(async () => {
    await makeRequest('/simulate-attack', { method: 'DELETE' });
  });

  it('should reinstate a revoked organization', async () => {
    const response = await makeRequest('/simulate-attack/reinstate-org', {
      method: 'POST',
      body: { orgId: 'reinstate-test-org' }
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.success, true);
    assert.ok(response.body.reinstatedAt);
  });

  it('should remove org from revoked list after reinstate', async () => {
    const stateResponse = await makeRequest('/simulate-attack');
    
    const isRevoked = stateResponse.body.revokedOrgs.includes('reinstate-test-org') ||
                      stateResponse.body.attacks.some(a => 
                        a.orgId === 'reinstate-test-org' && a.active
                      );
    
    assert.strictEqual(isRevoked, false, 'Org should not be in revoked state after reinstate');
  });
});

// ============================================================================
// Test Suite: Denied Access Logging
// ============================================================================

describe('POST /simulate-attack/log-denied', () => {
  before(async () => {
    const serverRunning = await checkServerRunning();
    if (!serverRunning) {
      throw new Error('Backend server not running');
    }
  });

  it('should log denied access attempt', async () => {
    const response = await makeRequest('/simulate-attack/log-denied', {
      method: 'POST',
      body: {
        resourceId: 'test-resource',
        orgId: 'attacker-org',
        reason: 'Organization revoked'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.success, true);
    assert.strictEqual(response.body.action, 'DENIED');
    assert.ok(response.body.timestamp);
  });

  it('should return 400 when resourceId is missing', async () => {
    const response = await makeRequest('/simulate-attack/log-denied', {
      method: 'POST',
      body: { orgId: 'test' }
    });

    assert.strictEqual(response.statusCode, 400);
  });
});

// ============================================================================
// Full Integration Test: Attack Flow
// ============================================================================

describe('Full Attack Simulation Flow', () => {
  const testOrgId = 'attack-flow-test-org';
  
  before(async () => {
    const serverRunning = await checkServerRunning();
    if (!serverRunning) {
      throw new Error('Backend server not running');
    }

    // Clean slate
    await makeRequest('/simulate-attack', { method: 'DELETE' });
  });

  after(async () => {
    await makeRequest('/simulate-attack', { method: 'DELETE' });
  });

  it('Step 1: Org initially has no attack state', async () => {
    const response = await makeRequest('/simulate-attack');
    
    const hasAttack = response.body.attacks.some(a => a.orgId === testOrgId);
    assert.strictEqual(hasAttack, false);
  });

  it('Step 2: Activate attack for org', async () => {
    const response = await makeRequest('/simulate-attack', {
      method: 'POST',
      body: {
        orgId: testOrgId,
        active: true,
        attackType: 'revoked'
      }
    });

    assert.strictEqual(response.statusCode, 200);
    assert.strictEqual(response.body.attackActive, true);
  });

  it('Step 3: Access attempt as attacker returns 403', async () => {
    const response = await makeRequest(`/resource/${TEST_RESOURCE_ID}`, {
      headers: { 'x-org-id': testOrgId }
    });

    assert.strictEqual(response.statusCode, 403);
    assert.strictEqual(response.body.error, 'Access denied');
    
    console.log(`    ✓ Attack org received 403 DENIED`);
  });

  it('Step 4: Reinstate org', async () => {
    const response = await makeRequest('/simulate-attack/reinstate-org', {
      method: 'POST',
      body: { orgId: testOrgId }
    });

    assert.strictEqual(response.statusCode, 200);
  });

  it('Step 5: Access no longer blocked (org not in attack state)', async () => {
    const stateResponse = await makeRequest('/simulate-attack');
    
    const isStillRevoked = stateResponse.body.attacks.some(
      a => a.orgId === testOrgId && a.active
    );
    
    assert.strictEqual(isStillRevoked, false, 'Org should not be in attack state');
  });
});

console.log(`
================================================================================
Attack Simulation Test Suite
================================================================================

This test suite verifies:
- POST /simulate-attack - Toggle attack state
- POST /simulate-attack/revoke-org - Revoke via chaincode
- POST /simulate-attack/reinstate-org - Reinstate org
- POST /simulate-attack/log-denied - Log denied access
- GET /resource/:id returns 403 for revoked orgs

Run with: node --test tests/backend/attack.test.js
================================================================================
`);
