/**
 * Attack Simulation Routes - POST /simulate-attack
 * 
 * Simulates a compromised node or revoked organization for testing
 * access control mechanisms. This endpoint toggles attack states
 * and revokes org access via chaincode.
 * 
 * SECURITY NOTE: This is for TESTING/DEMO purposes only.
 * In production, this endpoint should be disabled or heavily protected.
 * 
 * References:
 * - Hyperledger Fabric Chaincode: https://hyperledger-fabric.readthedocs.io/en/release-2.2/chaincode4ade.html
 * - Fabric Node SDK: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html
 * 
 * Flow:
 * 1. POST /simulate-attack toggles in-memory attack state for a nodeId
 * 2. POST /simulate-attack/revoke-org calls chaincode.revokeOrg(orgId)
 * 3. When attack is active, GET /resource checks fail with 403 DENIED
 * 4. All denied access attempts are logged via chaincode.logAccess with status='DENIED'
 */

'use strict';

const express = require('express');
const fabricClient = require('../fabric-client');

const router = express.Router();

// In-memory attack state store
// Maps nodeId/orgId -> { active: boolean, attackType: string, timestamp: number }
// This simulates a compromised node or attacker behavior
const attackState = new Map();

// Track revoked organizations (synced with chaincode state)
const revokedOrgs = new Set();

/**
 * Get current attack state for all nodes
 * 
 * GET /simulate-attack
 * 
 * Response:
 * {
 *   attacks: [{ nodeId, orgId, active, attackType, timestamp }],
 *   revokedOrgs: ['org1', 'org2']
 * }
 */
router.get('/', (req, res) => {
  const attacks = [];
  
  attackState.forEach((state, key) => {
    attacks.push({
      id: key,
      nodeId: state.nodeId,
      orgId: state.orgId,
      active: state.active,
      attackType: state.attackType,
      timestamp: state.timestamp,
      timestampHuman: new Date(state.timestamp).toISOString()
    });
  });

  res.json({
    attacks,
    revokedOrgs: Array.from(revokedOrgs),
    message: 'Attack simulation status retrieved'
  });
});

/**
 * Toggle attack state for a node
 * 
 * POST /simulate-attack
 * 
 * Request body:
 * {
 *   "nodeId": "node1",           // Node identifier (optional)
 *   "orgId": "org1",             // Organization identifier
 *   "active": true,              // Toggle attack on/off
 *   "attackType": "revoked"      // Type: 'revoked', 'compromised', 'expired'
 * }
 * 
 * Response (200):
 * {
 *   "success": true,
 *   "orgId": "org1",
 *   "attackActive": true,
 *   "attackType": "revoked",
 *   "message": "Attack simulation activated for org1"
 * }
 */
router.post('/', async (req, res) => {
  try {
    const { nodeId, orgId, active, attackType = 'revoked' } = req.body;

    // Validate required fields
    if (!orgId) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'orgId is required'
      });
    }

    // Validate attackType
    const validTypes = ['revoked', 'compromised', 'expired', 'unauthorized'];
    if (!validTypes.includes(attackType)) {
      return res.status(400).json({
        error: 'Invalid attack type',
        message: `attackType must be one of: ${validTypes.join(', ')}`
      });
    }

    const key = orgId;
    const timestamp = Date.now();

    if (active) {
      // Activate attack state
      attackState.set(key, {
        nodeId: nodeId || `node-${orgId}`,
        orgId,
        active: true,
        attackType,
        timestamp
      });

      // If attackType is 'revoked', add to revoked orgs set
      if (attackType === 'revoked') {
        revokedOrgs.add(orgId);
      }

      console.log(`[attack] Attack simulation ACTIVATED for ${orgId} (${attackType})`);

      res.json({
        success: true,
        orgId,
        nodeId: nodeId || `node-${orgId}`,
        attackActive: true,
        attackType,
        timestamp,
        message: `Attack simulation activated for ${orgId}`
      });
    } else {
      // Deactivate attack state
      attackState.delete(key);
      revokedOrgs.delete(orgId);

      console.log(`[attack] Attack simulation DEACTIVATED for ${orgId}`);

      res.json({
        success: true,
        orgId,
        attackActive: false,
        timestamp,
        message: `Attack simulation deactivated for ${orgId}`
      });
    }

  } catch (error) {
    console.error(`[attack] Toggle attack failed: ${error.message}`);
    res.status(500).json({
      error: 'Attack toggle failed',
      message: error.message
    });
  }
});

/**
 * Revoke an organization via chaincode
 * 
 * POST /simulate-attack/revoke-org
 * 
 * This calls chaincode.revokeOrg(orgId) to mark the org as revoked
 * on the blockchain. All subsequent access checks will fail.
 * 
 * Request body:
 * {
 *   "orgId": "org1",
 *   "reason": "Security breach detected"
 * }
 * 
 * Response (200):
 * {
 *   "success": true,
 *   "orgId": "org1",
 *   "revokedAt": "2024-01-15T10:30:00.000Z",
 *   "txId": "abc123...",
 *   "message": "Organization org1 has been revoked"
 * }
 */
router.post('/revoke-org', async (req, res) => {
  try {
    const { orgId, reason = 'Security policy violation' } = req.body;

    if (!orgId) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'orgId is required'
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);

    // Call chaincode to revoke org
    // Per Fabric docs: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html#submit-transaction
    let result;
    try {
      result = await fabricClient.submitTransaction('revokeOrg', [
        orgId,
        reason,
        timestamp.toString()
      ]);
    } catch (fabricError) {
      // If chaincode doesn't have revokeOrg, fall back to local state
      console.warn(`[attack] Chaincode revokeOrg not available, using local state: ${fabricError.message}`);
      
      // Update local attack state
      attackState.set(orgId, {
        nodeId: `node-${orgId}`,
        orgId,
        active: true,
        attackType: 'revoked',
        timestamp: Date.now(),
        reason
      });
      revokedOrgs.add(orgId);

      result = {
        orgId,
        revoked: true,
        reason,
        timestamp,
        stub: true
      };
    }

    // Add to local revoked set for middleware check
    revokedOrgs.add(orgId);
    attackState.set(orgId, {
      nodeId: `node-${orgId}`,
      orgId,
      active: true,
      attackType: 'revoked',
      timestamp: Date.now(),
      reason
    });

    console.log(`[attack] Organization ${orgId} REVOKED via chaincode`);

    res.json({
      success: true,
      orgId,
      revokedAt: new Date().toISOString(),
      reason,
      txId: result.txId || 'stub-tx-' + Date.now(),
      chaincodeResult: result,
      message: `Organization ${orgId} has been revoked`
    });

  } catch (error) {
    console.error(`[attack] Revoke org failed: ${error.message}`);
    res.status(500).json({
      error: 'Revoke organization failed',
      message: error.message
    });
  }
});

/**
 * Reinstate a revoked organization
 * 
 * POST /simulate-attack/reinstate-org
 * 
 * Request body:
 * {
 *   "orgId": "org1"
 * }
 */
router.post('/reinstate-org', async (req, res) => {
  try {
    const { orgId } = req.body;

    if (!orgId) {
      return res.status(400).json({
        error: 'Missing required field',
        message: 'orgId is required'
      });
    }

    // Try to reinstate via chaincode
    try {
      await fabricClient.submitTransaction('reinstateOrg', [orgId]);
    } catch (fabricError) {
      console.warn(`[attack] Chaincode reinstateOrg not available: ${fabricError.message}`);
    }

    // Remove from local state
    attackState.delete(orgId);
    revokedOrgs.delete(orgId);

    console.log(`[attack] Organization ${orgId} REINSTATED`);

    res.json({
      success: true,
      orgId,
      reinstatedAt: new Date().toISOString(),
      message: `Organization ${orgId} has been reinstated`
    });

  } catch (error) {
    console.error(`[attack] Reinstate org failed: ${error.message}`);
    res.status(500).json({
      error: 'Reinstate organization failed',
      message: error.message
    });
  }
});

/**
 * Log a denied access attempt
 * 
 * POST /simulate-attack/log-denied
 * 
 * Logs a DENIED access event to the blockchain audit log.
 * This is called when an attacker/revoked org attempts unauthorized access.
 * 
 * Request body:
 * {
 *   "resourceId": "res-123",
 *   "orgId": "attacker-org",
 *   "reason": "Organization revoked"
 * }
 */
router.post('/log-denied', async (req, res) => {
  try {
    const { resourceId, orgId, reason = 'Unauthorized access attempt' } = req.body;

    if (!resourceId || !orgId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'resourceId and orgId are required'
      });
    }

    const timestamp = Math.floor(Date.now() / 1000);

    // Log to chaincode with DENIED status
    // Per Fabric docs: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html
    let result;
    try {
      result = await fabricClient.submitTransaction('logAccess', [
        resourceId,
        orgId,
        'DENIED',      // action = DENIED
        timestamp.toString(),
        reason         // optional reason parameter
      ]);
    } catch (fabricError) {
      // Stub response if chaincode unavailable
      console.warn(`[attack] Chaincode logAccess failed: ${fabricError.message}`);
      result = {
        logged: true,
        stub: true,
        resourceId,
        orgId,
        action: 'DENIED',
        reason,
        timestamp
      };
    }

    console.log(`[attack] DENIED access logged: ${orgId} -> ${resourceId}`);

    res.json({
      success: true,
      resourceId,
      orgId,
      action: 'DENIED',
      reason,
      timestamp: new Date(timestamp * 1000).toISOString(),
      auditResult: result,
      message: 'Denied access attempt logged to blockchain'
    });

  } catch (error) {
    console.error(`[attack] Log denied failed: ${error.message}`);
    res.status(500).json({
      error: 'Failed to log denied access',
      message: error.message
    });
  }
});

/**
 * Clear all attack simulations
 * 
 * DELETE /simulate-attack
 */
router.delete('/', (req, res) => {
  const count = attackState.size;
  attackState.clear();
  revokedOrgs.clear();

  console.log(`[attack] Cleared ${count} attack simulations`);

  res.json({
    success: true,
    clearedCount: count,
    message: 'All attack simulations cleared'
  });
});

// ============================================================================
// Exported helper functions for use by other modules
// ============================================================================

/**
 * Check if an organization is under attack simulation (revoked)
 * 
 * @param {string} orgId - Organization ID to check
 * @returns {boolean} True if org is revoked/under attack
 */
function isOrgRevoked(orgId) {
  return revokedOrgs.has(orgId) || 
    (attackState.has(orgId) && attackState.get(orgId).active);
}

/**
 * Get attack state for an organization
 * 
 * @param {string} orgId - Organization ID
 * @returns {Object|null} Attack state or null
 */
function getAttackState(orgId) {
  return attackState.get(orgId) || null;
}

/**
 * Check if any attack simulation is active
 * 
 * @returns {boolean} True if any attack is active
 */
function hasActiveAttacks() {
  return attackState.size > 0;
}

// Export router and helper functions
module.exports = router;
module.exports.isOrgRevoked = isOrgRevoked;
module.exports.getAttackState = getAttackState;
module.exports.hasActiveAttacks = hasActiveAttacks;
