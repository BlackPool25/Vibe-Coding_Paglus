/**
 * Stop Backend Background Process
 * 
 * Stops the backend server started with start-background.js
 * Reads PID from pids/backend.pid
 * 
 * Usage: node scripts/stop-background.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PID_FILE = path.join(__dirname, '..', 'pids', 'backend.pid');

if (!fs.existsSync(PID_FILE)) {
  console.log('Backend is not running (no PID file found)');
  process.exit(0);
}

const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim());

try {
  // Check if process exists
  process.kill(pid, 0);
  
  // Send SIGTERM for graceful shutdown
  console.log(`Stopping backend (PID ${pid})...`);
  process.kill(pid, 'SIGTERM');
  
  // Wait a moment for graceful shutdown
  setTimeout(() => {
    try {
      // Check if still running
      process.kill(pid, 0);
      // Still running, force kill
      console.log('Graceful shutdown timeout, sending SIGKILL...');
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process terminated
    }
    
    // Clean up PID file
    if (fs.existsSync(PID_FILE)) {
      fs.unlinkSync(PID_FILE);
    }
    console.log('Backend stopped');
  }, 2000);
  
} catch (error) {
  if (error.code === 'ESRCH') {
    console.log(`Backend process ${pid} not found (already stopped)`);
    fs.unlinkSync(PID_FILE);
  } else {
    console.error(`Failed to stop backend: ${error.message}`);
    process.exit(1);
  }
}
