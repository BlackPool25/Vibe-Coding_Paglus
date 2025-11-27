@echo off
REM Start Backend Server Script
REM Run from: decen-health-db\backend directory

set VAULT_TOKEN=dev-root-token
set VAULT_ADDR=http://127.0.0.1:8200
set LOG_LEVEL=debug

echo Starting Decentralized Health DB Backend...
echo VAULT_ADDR=%VAULT_ADDR%
echo.

node src\server.js
