/**
 * Debug Routes - /debug/*
 * 
 * Provides debug endpoints for inspecting system state during development.
 * These endpoints expose metadata only (no PHI, no private keys).
 * 
 * SECURITY NOTE: Disable or protect these endpoints in production.
 * 
 * References:
 * - Hyperledger Fabric SDK: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html
 * - Vault Health API: https://developer.hashicorp.com/vault/api-docs/system/health
 * - IPFS HTTP API: https://docs.ipfs.tech/reference/kubo/rpc/
 */

'use strict';

const express = require('express');
const fabricClient = require('../fabric-client');
const vaultClient = require('../crypto/vault-client');

const router = express.Router();

// Configuration
const PYUMBRAL_SERVICE_URL = process.env.PYUMBRAL_SERVICE_URL || 'http://127.0.0.1:8000';
const IPFS_API = process.env.IPFS_API || 'http://127.0.0.1:5001';

/**
 * GET /debug/status
 * 
 * Returns comprehensive status of all backend dependencies:
 * - Vault: reachable, initialized, sealed status
 * - Fabric: network connected, channel, chaincode
 * - IPFS: local node reachable
 * - pyUmbral: service reachable
 * 
 * Response:
 * {
 *   "status": "healthy" | "degraded" | "unhealthy",
 *   "timestamp": "ISO timestamp",
 *   "services": {
 *     "vault": { "reachable": true, "initialized": true, "sealed": false },
 *     "fabric": { "connected": true, "channel": "mychannel", "chaincode": "consent" },
 *     "ipfs": { "reachable": true, "peerId": "..." },
 *     "pyumbral": { "reachable": true }
 *   }
 * }
 */
router.get('/status', async (req, res) => {
  const axios = (await import('axios')).default;
  const services = {};
  let overallStatus = 'healthy';

  // Check Vault
  try {
    const vaultStatus = await vaultClient.healthCheck();
    services.vault = {
      reachable: true,
      initialized: vaultStatus.initialized,
      sealed: vaultStatus.sealed,
      version: vaultStatus.version
    };
    if (vaultStatus.sealed) {
      overallStatus = 'degraded';
    }
  } catch (error) {
    services.vault = {
      reachable: false,
      error: error.message
    };
    overallStatus = 'degraded';
  }

  // Check Fabric
  try {
    const fabricStatus = await fabricClient.healthCheck();
    services.fabric = {
      connected: fabricStatus.connected,
      channel: fabricStatus.channel || fabricClient.CHANNEL_NAME,
      chaincode: fabricStatus.chaincode || fabricClient.CHAINCODE_NAME,
      stub: fabricStatus.stub || false
    };
    if (!fabricStatus.connected || fabricStatus.stub) {
      overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus;
    }
  } catch (error) {
    services.fabric = {
      connected: false,
      error: error.message
    };
    overallStatus = 'degraded';
  }

  // Check IPFS
  try {
    const ipfsUrl = `${IPFS_API}/api/v0/id`;
    const ipfsResponse = await axios.post(ipfsUrl, null, { timeout: 5000 });
    services.ipfs = {
      reachable: true,
      peerId: ipfsResponse.data?.ID?.substring(0, 16) + '...',
      agentVersion: ipfsResponse.data?.AgentVersion
    };
  } catch (error) {
    services.ipfs = {
      reachable: false,
      error: error.code === 'ECONNREFUSED' ? 'Connection refused' : error.message
    };
    // IPFS not critical if using web3.storage
    if (!process.env.WEB3_STORAGE_TOKEN) {
      overallStatus = overallStatus === 'healthy' ? 'degraded' : overallStatus;
    }
  }

  // Check pyUmbral
  try {
    const pyumbralResponse = await axios.get(`${PYUMBRAL_SERVICE_URL}/health`, { timeout: 5000 });
    services.pyumbral = {
      reachable: true,
      status: pyumbralResponse.data?.status,
      vaultConnected: pyumbralResponse.data?.vault_connected
    };
  } catch (error) {
    services.pyumbral = {
      reachable: false,
      error: error.code === 'ECONNREFUSED' ? 'Connection refused' : error.message
    };
    // pyUmbral not critical for basic operations
  }

  // Determine overall status
  const criticalServices = [services.vault, services.fabric];
  const criticalDown = criticalServices.filter(s => !s.reachable && !s.connected).length;
  if (criticalDown >= 2) {
    overallStatus = 'unhealthy';
  }

  res.json({
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services
  });
});

/**
 * GET /debug/orgs
 * 
 * Lists all registered organizations from Vault (public keys only).
 * Does NOT return private keys.
 */
router.get('/orgs', async (req, res) => {
  try {
    // List org keys from Vault
    const orgIds = await vaultClient.listKeys();
    
    // Get public info for each org (no private keys)
    const orgs = [];
    for (const orgId of orgIds) {
      try {
        const keyData = await vaultClient.getKey(orgId.replace(/\/$/, ''));
        orgs.push({
          orgId: keyData.data?.orgId || orgId.replace(/\/$/, ''),
          keyType: keyData.data?.keyType,
          hasPublicKey: !!keyData.data?.publicKey,
          createdAt: keyData.data?.createdAt,
          version: keyData.metadata?.version
        });
      } catch {
        orgs.push({
          orgId: orgId.replace(/\/$/, ''),
          error: 'Failed to read'
        });
      }
    }

    res.json({
      count: orgs.length,
      orgs
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to list organizations',
      message: error.message
    });
  }
});

/**
 * GET /debug/resources
 * 
 * Lists recently uploaded resources from chaincode (metadata only).
 * Query params:
 * - limit: max results (default 10)
 */
router.get('/resources', async (req, res) => {
  try {
    // Try to query chaincode for resources
    // Note: This requires a queryAllResources function in chaincode
    // For now, return info about the debug endpoint
    
    let resources = [];
    try {
      // Try stub contract's test-config if available
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(__dirname, '..', '..', 'scripts', 'test-config.json');
      if (fs.existsSync(configPath)) {
        const testConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        resources.push({
          resourceId: testConfig.resourceId,
          ownerOrg: testConfig.ownerOrg,
          fhirType: testConfig.fhirType,
          cid: testConfig.cid?.substring(0, 20) + '...',
          source: 'test-config'
        });
      }
    } catch {
      // Ignore
    }

    res.json({
      note: 'Resources are stored on Fabric blockchain. Use chaincode queryResource to fetch specific resources.',
      testResources: resources,
      usage: {
        queryResource: 'GET /resource/:id with x-org-id header',
        queryMeta: 'GET /resource/:id/meta with x-org-id header'
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to list resources',
      message: error.message
    });
  }
});

/**
 * GET /debug/audit
 * 
 * Returns recent audit events from chaincode.
 * Query params:
 * - resourceId: filter by resource
 * - limit: max results (default 20)
 */
router.get('/audit', async (req, res) => {
  const { resourceId, limit = 20 } = req.query;

  try {
    let auditLogs = [];
    
    if (resourceId) {
      // Query chaincode for audit logs of specific resource
      try {
        auditLogs = await fabricClient.evaluateTransaction('queryAuditLogs', [resourceId]);
      } catch (error) {
        // Chaincode may not be available
        auditLogs = { error: error.message, stub: true };
      }
    }

    res.json({
      note: 'Audit logs are stored on Fabric blockchain immutably.',
      resourceId: resourceId || 'all',
      limit: parseInt(limit),
      logs: auditLogs,
      usage: {
        byResource: 'GET /debug/audit?resourceId=xxx',
        allLogs: 'Query chaincode directly with peer CLI'
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to query audit logs',
      message: error.message
    });
  }
});

/**
 * GET /debug/attack-state
 * 
 * Returns current attack simulation state (revoked orgs, active attacks).
 */
router.get('/attack-state', (req, res) => {
  try {
    const attackModule = require('./attack');
    
    res.json({
      hasActiveAttacks: attackModule.hasActiveAttacks(),
      // Get state via the GET endpoint logic
      note: 'Use GET /simulate-attack for full state'
    });
  } catch {
    res.json({
      hasActiveAttacks: false,
      note: 'Attack module not loaded'
    });
  }
});

/**
 * GET /debug/env
 * 
 * Returns safe environment configuration (no secrets).
 */
router.get('/env', (req, res) => {
  res.json({
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: process.env.PORT || 4000,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    VAULT_ADDR: process.env.VAULT_ADDR || 'http://127.0.0.1:8200',
    VAULT_TOKEN_SET: !!process.env.VAULT_TOKEN || !!process.env.VAULT_DEV_ROOT_TOKEN_ID,
    IPFS_API: process.env.IPFS_API || 'http://127.0.0.1:5001',
    WEB3_STORAGE_CONFIGURED: !!process.env.WEB3_STORAGE_TOKEN,
    PYUMBRAL_SERVICE_URL: process.env.PYUMBRAL_SERVICE_URL || 'http://127.0.0.1:8000',
    FABRIC_CHANNEL: process.env.FABRIC_CHANNEL_NAME || 'mychannel',
    FABRIC_CHAINCODE: process.env.FABRIC_CHAINCODE_NAME || 'consent'
  });
});

module.exports = router;
