/**
 * Share Route - Grant and revoke access to resources
 * 
 * Endpoints:
 * - POST /share/grant   - Grant access to an organization
 * - POST /share/revoke  - Revoke access from an organization
 * - GET  /share/check   - Check if an organization has access
 * - GET  /share/list    - List all grants for a resource
 * 
 * References:
 * - Fabric chaincode: chaincode/consent-chaincode/lib/contract.js
 */

'use strict';

const express = require('express');
const fabricClient = require('../fabric-client');
const router = express.Router();

/**
 * POST /share/grant
 * 
 * Grant access to an organization for a specific resource.
 * 
 * Request Body:
 * {
 *   "resourceId": "obs-test-001",
 *   "orgId": "hospital-beta",
 *   "expiresAt": "2025-12-31T23:59:59Z" // optional
 * }
 * 
 * Headers:
 * - x-org-id: The calling organization (must be owner)
 */
router.post('/grant', async (req, res) => {
  try {
    const callerOrgId = req.headers['x-org-id'];
    if (!callerOrgId) {
      return res.status(400).json({
        error: 'Missing x-org-id header',
        message: 'Request must include x-org-id header identifying the calling organization'
      });
    }

    const { resourceId, orgId, expiresAt } = req.body;

    if (!resourceId) {
      return res.status(400).json({
        error: 'Missing resourceId',
        message: 'Request body must include resourceId'
      });
    }

    if (!orgId) {
      return res.status(400).json({
        error: 'Missing orgId',
        message: 'Request body must include orgId (the organization to grant access to)'
      });
    }

    // Normalize orgId to lowercase for case-insensitive matching
    const normalizedOrgId = orgId.toLowerCase();
    const normalizedCallerOrgId = callerOrgId.toLowerCase();

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[share] Granting access: resource=${resourceId}, to=${normalizedOrgId}, by=${normalizedCallerOrgId}`);
    }

    // Call chaincode grantAccess
    // Signature: grantAccess(ctx, resourceId, granteeOrgId)
    const result = await fabricClient.submitTransaction('grantAccess', [
      resourceId,
      normalizedOrgId
    ]);

    res.json({
      success: true,
      resourceId,
      grantedTo: normalizedOrgId,
      grantedBy: normalizedCallerOrgId,
      expiresAt: expiresAt || null,
      chaincode: result
    });

  } catch (error) {
    console.error(`[share] Grant error: ${error.message}`);
    res.status(500).json({
      error: 'Grant failed',
      message: error.message
    });
  }
});

/**
 * POST /share/revoke
 * 
 * Revoke access from an organization for a specific resource.
 * 
 * Request Body:
 * {
 *   "resourceId": "obs-test-001",
 *   "orgId": "hospital-beta"
 * }
 */
router.post('/revoke', async (req, res) => {
  try {
    const callerOrgId = req.headers['x-org-id'];
    if (!callerOrgId) {
      return res.status(400).json({
        error: 'Missing x-org-id header',
        message: 'Request must include x-org-id header identifying the calling organization'
      });
    }

    const { resourceId, orgId } = req.body;

    if (!resourceId || !orgId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Request body must include resourceId and orgId'
      });
    }

    const normalizedOrgId = orgId.toLowerCase();

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[share] Revoking access: resource=${resourceId}, from=${normalizedOrgId}`);
    }

    // Call chaincode revokeAccess
    const result = await fabricClient.submitTransaction('revokeAccess', [
      resourceId,
      normalizedOrgId
    ]);

    res.json({
      success: true,
      resourceId,
      revokedFrom: normalizedOrgId,
      chaincode: result
    });

  } catch (error) {
    console.error(`[share] Revoke error: ${error.message}`);
    res.status(500).json({
      error: 'Revoke failed',
      message: error.message
    });
  }
});

/**
 * GET /share/check
 * 
 * Check if an organization has access to a resource.
 * 
 * Query Parameters:
 * - resourceId: The resource ID
 * - orgId: The organization to check
 */
router.get('/check', async (req, res) => {
  try {
    const { resourceId, orgId } = req.query;

    if (!resourceId || !orgId) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'Query must include resourceId and orgId'
      });
    }

    const normalizedOrgId = orgId.toLowerCase();

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[share] Checking access: resource=${resourceId}, org=${normalizedOrgId}`);
    }

    // Call chaincode checkAccess
    const result = await fabricClient.evaluateTransaction('checkAccess', [
      resourceId,
      normalizedOrgId
    ]);

    // Parse result - chaincode returns { allowed: boolean, reason: string }
    let accessResult;
    try {
      accessResult = JSON.parse(result.toString());
    } catch {
      accessResult = { allowed: result.toString() === 'true', reason: 'Unknown' };
    }

    res.json({
      resourceId,
      orgId: normalizedOrgId,
      allowed: accessResult.allowed,
      reason: accessResult.reason || (accessResult.allowed ? 'Access granted' : 'No access')
    });

  } catch (error) {
    console.error(`[share] Check error: ${error.message}`);
    res.status(500).json({
      error: 'Check failed',
      message: error.message
    });
  }
});

/**
 * GET /share/list
 * 
 * List all access grants for a resource.
 * 
 * Query Parameters:
 * - resourceId: The resource ID
 */
router.get('/list', async (req, res) => {
  try {
    const { resourceId } = req.query;

    if (!resourceId) {
      return res.status(400).json({
        error: 'Missing resourceId',
        message: 'Query must include resourceId'
      });
    }

    if (process.env.LOG_LEVEL === 'debug') {
      console.debug(`[share] Listing grants for resource: ${resourceId}`);
    }

    // Call chaincode listGrants
    const result = await fabricClient.evaluateTransaction('listGrants', [
      resourceId
    ]);

    let grants;
    try {
      grants = JSON.parse(result.toString());
    } catch {
      grants = [];
    }

    res.json({
      resourceId,
      grants: grants,
      count: grants.length
    });

  } catch (error) {
    console.error(`[share] List error: ${error.message}`);
    res.status(500).json({
      error: 'List failed',
      message: error.message
    });
  }
});

module.exports = router;
