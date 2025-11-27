/**
 * Decentralized Health DB - Backend Server
 * 
 * Express server with routes for organization management, data upload,
 * consent management, and audit logging.
 * 
 * References:
 * - Express.js: https://expressjs.com/en/4x/api.html
 * - Vault Developer Quickstart: https://developer.hashicorp.com/vault/docs/get-started/developer-qs
 * - Fabric Node SDK: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html
 * 
 * Environment Variables:
 * - PORT: Server port (default: 4000)
 * - LOG_LEVEL: Logging level (debug, info, warn, error)
 * - VAULT_ADDR: Vault server address (default: http://127.0.0.1:8200)
 * - VAULT_TOKEN: Vault authentication token
 * 
 * SECURITY NOTE: No PHI is logged. Only request metadata at debug level.
 */

'use strict';

const express = require('express');
const vaultClient = require('./crypto/vault-client');
const fabricClient = require('./fabric-client');

// Import routes
const orgRoutes = require('./routes/org');
const uploadRoutes = require('./routes/upload');
const resourceRoutes = require('./routes/resource');

// Configuration
const PORT = process.env.PORT || 4000;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Initialize Express app
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware (no PHI)
app.use((req, res, next) => {
  if (LOG_LEVEL === 'debug') {
    console.debug(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// CORS middleware for development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check Vault connectivity
    let vaultStatus = { connected: false };
    try {
      vaultStatus = await vaultClient.healthCheck();
    } catch (e) {
      vaultStatus = { connected: false, error: e.message };
    }

    // Check Fabric connectivity
    let fabricStatus = { connected: false };
    try {
      fabricStatus = await fabricClient.healthCheck();
    } catch (e) {
      fabricStatus = { connected: false, error: e.message };
    }

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      services: {
        vault: vaultStatus,
        fabric: fabricStatus
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// API Routes
app.use('/org', orgRoutes);
app.use('/upload', uploadRoutes);
app.use('/resource', resourceRoutes);

// Placeholder routes for future implementation
app.use('/share', (req, res) => {
  res.status(501).json({ message: 'Share endpoint not yet implemented' });
});

app.use('/audit', (req, res) => {
  res.status(501).json({ message: 'Audit endpoint not yet implemented' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    path: req.path
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`[error] ${err.message}`);
  
  // Don't expose internal errors in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;

  res.status(err.status || 500).json({
    error: message
  });
});

// Start server
async function startServer() {
  try {
    // Initialize Vault client
    console.log('[server] Initializing Vault client...');
    vaultClient.initVaultClient();

    // Initialize Fabric client
    console.log('[server] Initializing Fabric client...');
    await fabricClient.connect();

    // Start Express server
    app.listen(PORT, () => {
      console.log(`[server] Decentralized Health DB backend running on port ${PORT}`);
      console.log(`[server] Health check: http://localhost:${PORT}/health`);
      console.log(`[server] Log level: ${LOG_LEVEL}`);
    });

  } catch (error) {
    console.error('[server] Failed to start server:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[server] Shutting down...');
  try {
    await fabricClient.disconnect();
    console.log('[server] Disconnected from Fabric network');
  } catch (e) {
    // Ignore disconnect errors
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[server] Received SIGTERM, shutting down...');
  try {
    await fabricClient.disconnect();
  } catch (e) {
    // Ignore disconnect errors
  }
  process.exit(0);
});

// Start the server
startServer();

module.exports = app; // Export for testing
