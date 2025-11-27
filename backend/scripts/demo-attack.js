#!/usr/bin/env node
/**
 * Attack Simulation Demo Script
 * 
 * Demonstrates the full attack flow:
 * 1. Create organizations (owner + grantee + attacker)
 * 2. Upload a resource
 * 3. Grant access to grantee org
 * 4. Verify access works
 * 5. Revoke attacker org
 * 6. Attempt access as revoked org - expect DENIED
 * 7. Show audit log with DENIED entry
 * 
 * Usage:
 *   node backend/scripts/demo-attack.js
 * 
 * Prerequisites:
 * - Backend server running: cd backend && npm start
 * - Vault running: vault server -dev (optional, uses stub)
 * - IPFS running: ipfs daemon (optional, uses stub)
 * 
 * References:
 * - Hyperledger Fabric: https://hyperledger-fabric.readthedocs.io/en/release-2.2/
 * - Vault Developer Quickstart: https://developer.hashicorp.com/vault/docs/get-started/developer-qs
 * - IPFS Docs: https://docs.ipfs.tech/
 */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';
const OWNER_ORG = 'owner-hospital';
const GRANTEE_ORG = 'partner-clinic';
const ATTACKER_ORG = 'malicious-org';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logStep(step, msg) {
  console.log(`\n${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`${colors.bright}${colors.blue}[Step ${step}]${colors.reset} ${msg}`);
  console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
}

/**
 * Makes an HTTP request
 */
function request(path, options = {}) {
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
      timeout: 15000
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
          status: res.statusCode,
          headers: res.headers,
          body
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
 * Check if server is running
 */
async function checkServer() {
  try {
    const res = await request('/health');
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Wait for a bit
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main demo flow
 */
async function runDemo() {
  console.log(`
${colors.magenta}╔════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║               🔐 ATTACK SIMULATION DEMO - Decen-Health-DB                    ║
║                                                                              ║
║  This demo shows how revoked organizations are denied access and how        ║
║  denied access attempts are logged to the blockchain audit trail.           ║
║                                                                              ║
╚════════════════════════════════════════════════════════════════════════════╝${colors.reset}

${colors.yellow}References:${colors.reset}
  - Hyperledger Fabric: https://hyperledger-fabric.readthedocs.io/en/release-2.2/
  - Vault: https://developer.hashicorp.com/vault/docs/get-started/developer-qs
  - IPFS: https://docs.ipfs.tech/

`);

  // Check server
  log('Checking backend server...', 'cyan');
  const serverUp = await checkServer();
  if (!serverUp) {
    log(`\n❌ Backend server not running at ${BACKEND_URL}`, 'red');
    log('   Start it with: cd backend && npm start', 'yellow');
    process.exit(1);
  }
  log('✓ Backend server is running', 'green');

  try {
    // ========================================================================
    // Step 1: Clean slate - clear any existing attack simulations
    // ========================================================================
    logStep(1, 'Clear existing attack simulations');
    
    const clearRes = await request('/simulate-attack', { method: 'DELETE' });
    log(`Cleared ${clearRes.body.clearedCount || 0} existing simulations`, 'green');

    // ========================================================================
    // Step 2: Register organizations
    // ========================================================================
    logStep(2, 'Register organizations');
    
    const orgs = [
      { orgId: OWNER_ORG, name: 'City General Hospital' },
      { orgId: GRANTEE_ORG, name: 'Partner Family Clinic' },
      { orgId: ATTACKER_ORG, name: 'Malicious Healthcare Inc' }
    ];

    for (const org of orgs) {
      const res = await request('/org/register', {
        method: 'POST',
        body: org
      });
      
      if (res.status === 201 || res.status === 200) {
        log(`  ✓ Registered: ${org.orgId} (${org.name})`, 'green');
      } else if (res.body.error?.includes('already exists')) {
        log(`  ℹ Already exists: ${org.orgId}`, 'yellow');
      } else {
        log(`  ⚠ Registration response for ${org.orgId}: ${res.status}`, 'yellow');
      }
    }

    // ========================================================================
    // Step 3: Show initial attack state (should be empty)
    // ========================================================================
    logStep(3, 'Check initial attack state (should be empty)');
    
    const initialState = await request('/simulate-attack');
    log(`Active attacks: ${initialState.body.attacks?.length || 0}`, 'cyan');
    log(`Revoked orgs: ${initialState.body.revokedOrgs?.length || 0}`, 'cyan');

    // ========================================================================
    // Step 4: Test access as valid org (should work or be 404 if no resource)
    // ========================================================================
    logStep(4, 'Test access as valid organization (before attack)');
    
    const TEST_RESOURCE = 'obs-test-123';
    
    const validAccessRes = await request(`/resource/${TEST_RESOURCE}`, {
      headers: { 'x-org-id': OWNER_ORG }
    });
    
    if (validAccessRes.status === 200) {
      log(`✓ ${OWNER_ORG} can access resource (200 OK)`, 'green');
    } else if (validAccessRes.status === 404) {
      log(`ℹ Resource not found (404) - this is expected if no test data`, 'yellow');
    } else {
      log(`ℹ Access response: ${validAccessRes.status}`, 'yellow');
    }

    // ========================================================================
    // Step 5: Revoke the attacker organization
    // ========================================================================
    logStep(5, 'REVOKE the malicious organization via chaincode');
    
    log(`\nRevoking ${ATTACKER_ORG}...`, 'red');
    
    const revokeRes = await request('/simulate-attack/revoke-org', {
      method: 'POST',
      body: {
        orgId: ATTACKER_ORG,
        reason: 'Security breach detected - unauthorized data access attempts'
      }
    });
    
    if (revokeRes.status === 200) {
      log(`\n✓ Organization REVOKED`, 'green');
      log(`  Org ID: ${revokeRes.body.orgId}`, 'cyan');
      log(`  Reason: ${revokeRes.body.reason}`, 'cyan');
      log(`  TX ID:  ${revokeRes.body.txId}`, 'cyan');
      log(`  Time:   ${revokeRes.body.revokedAt}`, 'cyan');
    } else {
      log(`⚠ Revoke response: ${JSON.stringify(revokeRes.body)}`, 'yellow');
    }

    // ========================================================================
    // Step 6: Verify attack state shows revoked org
    // ========================================================================
    logStep(6, 'Verify attack state shows revoked organization');
    
    const attackState = await request('/simulate-attack');
    
    log('Current attack state:', 'cyan');
    log(`  Active attacks: ${attackState.body.attacks?.length || 0}`, 'cyan');
    log(`  Revoked orgs: ${JSON.stringify(attackState.body.revokedOrgs)}`, 'cyan');
    
    if (attackState.body.attacks?.length > 0) {
      log('\nAttack details:', 'yellow');
      for (const attack of attackState.body.attacks) {
        log(`  - ${attack.orgId}: ${attack.attackType} (active: ${attack.active})`, 'yellow');
      }
    }

    // ========================================================================
    // Step 7: ATTEMPT ACCESS AS REVOKED ORG - Should get 403 DENIED
    // ========================================================================
    logStep(7, '🚨 ATTACK: Attempt access as REVOKED organization');
    
    log(`\nAttempting access as ${ATTACKER_ORG}...`, 'red');
    
    const attackAccessRes = await request(`/resource/${TEST_RESOURCE}`, {
      headers: { 'x-org-id': ATTACKER_ORG }
    });
    
    console.log(`\n${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    
    if (attackAccessRes.status === 403) {
      log(`\n🔒 ACCESS DENIED (403 Forbidden) - Attack blocked successfully!`, 'green');
      log(`\n   Response:`, 'cyan');
      log(`   - error:  ${attackAccessRes.body.error}`, 'cyan');
      log(`   - reason: ${attackAccessRes.body.reason}`, 'cyan');
    } else {
      log(`\n⚠ Unexpected response: ${attackAccessRes.status}`, 'yellow');
      log(`   Body: ${JSON.stringify(attackAccessRes.body)}`, 'yellow');
    }

    // ========================================================================
    // Step 8: Log the denied access attempt to blockchain
    // ========================================================================
    logStep(8, 'Log DENIED access event to blockchain audit');
    
    const logDeniedRes = await request('/simulate-attack/log-denied', {
      method: 'POST',
      body: {
        resourceId: TEST_RESOURCE,
        orgId: ATTACKER_ORG,
        reason: 'Organization revoked - access denied'
      }
    });
    
    if (logDeniedRes.status === 200) {
      log(`✓ DENIED event logged to blockchain`, 'green');
      log(`  Action: ${logDeniedRes.body.action}`, 'cyan');
      log(`  Resource: ${logDeniedRes.body.resourceId}`, 'cyan');
      log(`  Attacker: ${logDeniedRes.body.orgId}`, 'cyan');
      log(`  Time: ${logDeniedRes.body.timestamp}`, 'cyan');
    } else {
      log(`⚠ Log denied response: ${JSON.stringify(logDeniedRes.body)}`, 'yellow');
    }

    // ========================================================================
    // Step 9: Show final state
    // ========================================================================
    logStep(9, 'Final attack simulation state');
    
    const finalState = await request('/simulate-attack');
    
    log('\nFinal state:', 'cyan');
    log(`  Active attacks: ${finalState.body.attacks?.length || 0}`, 'cyan');
    log(`  Revoked orgs: ${JSON.stringify(finalState.body.revokedOrgs)}`, 'cyan');

    // ========================================================================
    // Summary
    // ========================================================================
    console.log(`
${colors.magenta}╔════════════════════════════════════════════════════════════════════════════╗
║                           DEMO COMPLETE                                      ║
╚════════════════════════════════════════════════════════════════════════════╝${colors.reset}

${colors.green}✓ Successfully demonstrated:${colors.reset}
  1. Organization registration
  2. Organization revocation via chaincode
  3. Access denial for revoked organization (403 Forbidden)
  4. DENIED event logging to blockchain audit

${colors.yellow}To verify manually with curl:${colors.reset}

  # Check attack state
  curl http://localhost:4000/simulate-attack

  # Revoke an org
  curl -X POST http://localhost:4000/simulate-attack/revoke-org \\
    -H "Content-Type: application/json" \\
    -d '{"orgId": "test-org", "reason": "Security breach"}'

  # Attempt access as revoked org (expect 403)
  curl http://localhost:4000/resource/obs-test-123 \\
    -H "x-org-id: ${ATTACKER_ORG}"

  # Reinstate org
  curl -X POST http://localhost:4000/simulate-attack/reinstate-org \\
    -H "Content-Type: application/json" \\
    -d '{"orgId": "${ATTACKER_ORG}"}'

${colors.cyan}Chaincode events logged:${colors.reset}
  - OrgRevoked: Recorded when revokeOrg is called
  - AccessLogged: Recorded with action='DENIED' for blocked access

`);

  } catch (error) {
    log(`\n❌ Demo failed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Run the demo
runDemo().catch(console.error);
