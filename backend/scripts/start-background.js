/**
 * Start Backend in Background
 * 
 * Starts the backend server as a detached background process.
 * Writes PID to pids/backend.pid for later termination.
 * 
 * Usage: node scripts/start-background.js
 * 
 * References:
 * - Node.js child_process: https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
 */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PIDS_DIR = path.join(__dirname, '..', 'pids');
const PID_FILE = path.join(PIDS_DIR, 'backend.pid');
const LOG_FILE = path.join(PIDS_DIR, 'backend.log');

// Ensure pids directory exists
if (!fs.existsSync(PIDS_DIR)) {
  fs.mkdirSync(PIDS_DIR, { recursive: true });
}

// Check if already running
if (fs.existsSync(PID_FILE)) {
  const existingPid = fs.readFileSync(PID_FILE, 'utf8').trim();
  try {
    // Check if process is running (signal 0 doesn't kill, just checks)
    process.kill(parseInt(existingPid), 0);
    console.log(`Backend already running with PID ${existingPid}`);
    console.log(`To stop: npm run stop`);
    process.exit(0);
  } catch {
    // Process not running, clean up stale PID file
    fs.unlinkSync(PID_FILE);
  }
}

// Open log file for output
const logStream = fs.openSync(LOG_FILE, 'a');

// Environment variables for the background process
const env = {
  ...process.env,
  VAULT_TOKEN: process.env.VAULT_TOKEN || process.env.VAULT_DEV_ROOT_TOKEN_ID || 'dev-root-token',
  VAULT_ADDR: process.env.VAULT_ADDR || 'http://127.0.0.1:8200',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  PORT: process.env.PORT || '4000'
};

// Spawn the server process in detached mode
// Per Node.js docs: https://nodejs.org/api/child_process.html#optionsdetached
const child = spawn('node', ['src/server.js'], {
  cwd: path.join(__dirname, '..'),
  env,
  detached: true,
  stdio: ['ignore', logStream, logStream]
});

// Unref to allow parent to exit
child.unref();

// Write PID file
fs.writeFileSync(PID_FILE, child.pid.toString());

console.log(`Backend started in background`);
console.log(`  PID: ${child.pid}`);
console.log(`  Log: ${LOG_FILE}`);
console.log(`  Port: ${env.PORT}`);
console.log(``);
console.log(`To stop: npm run stop`);
console.log(`To view logs: tail -f ${LOG_FILE}`);
console.log(`Health check: curl http://localhost:${env.PORT}/health`);
