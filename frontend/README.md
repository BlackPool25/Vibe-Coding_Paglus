# Decentralized Health DB - Frontend

Minimal React frontend for the Decentralized Health Database system.

## Official Documentation References

- **React 18**: https://react.dev/
- **Vite**: https://vitejs.dev/guide/
- **React Router**: https://reactrouter.com/en/main
- **Hyperledger Fabric**: https://hyperledger-fabric.readthedocs.io/
- **IPFS**: https://docs.ipfs.tech/
- **web3.storage**: https://web3.storage/docs/
- **HashiCorp Vault**: https://developer.hashicorp.com/vault/docs/get-started/developer-qs
- **pyUmbral**: https://pyumbral.readthedocs.io/

## Package Versions

```json
{
  "react": "^18.2.0",
  "react-dom": "^18.2.0",
  "react-router-dom": "^6.20.0",
  "vite": "^5.0.0",
  "@vitejs/plugin-react": "^4.2.0"
}
```

## Project Structure

```
frontend/
├── package.json          # Dependencies and scripts
├── vite.config.js        # Vite configuration with API proxy
├── index.html            # HTML entry point
├── README.md             # This file
└── src/
    ├── main.jsx          # React entry point
    ├── App.jsx           # Main app with routing
    ├── pages/
    │   ├── HospitalUpload.jsx   # Upload FHIR JSON and files
    │   ├── PatientPortal.jsx    # View resources, create shares
    │   └── AuditViewer.jsx      # View blockchain audit events
    └── services/
        ├── api.js        # Fetch wrappers for backend API
        └── ipfs.js       # IPFS gateway utilities
```

## HOW TO RUN / VERIFY

### Prerequisites

1. **Node.js 18+** installed
2. **Backend running** at http://localhost:4000 (optional - frontend has demo mode)

### Install and Run

```powershell
# Navigate to frontend directory
cd frontend

# Install dependencies (use npm ci for reproducible installs)
npm ci

# Start development server
npm run dev
```

### Expected Output

```
  VITE v5.0.0  ready in 300 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

### Open in Browser

Navigate to: **http://localhost:3000**

You should see:
- Header with navigation: Hospital Upload | Patient Portal | Audit Viewer
- Default page: Hospital Upload with sample FHIR JSON loaded

## Demo User Flow

### 1. Upload a Resource (Hospital Upload)

1. Open http://localhost:3000/upload
2. Keep default Patient ID: `patient-demo-001`
3. Keep default Organization: `hospital-org1`
4. Select Resource Type: `Observation`
5. Click **"Load Sample"** to populate sample FHIR JSON
6. Optionally attach an image file
7. Click **"🚀 Upload to IPFS"**

**Expected Result:**
- Success banner: "Successfully uploaded Observation to IPFS!"
- Result box showing:
  - IPFS CID: `bafybeig...`
  - SHA-256 hash
  - Storage backend: `local-ipfs` or `web3.storage`

**Backend Logs (if running):**
```
[upload] Processing file: Observation-1234567890.json, size: 512 bytes
[upload] Encrypted file size: 544 bytes, SHA256: abc123...
[upload] Uploaded to local-ipfs, CID: bafybeig...
```

### 2. View Resources (Patient Portal)

1. Navigate to http://localhost:3000/patient
2. Enter Patient ID: `patient-demo-001`
3. Click **"🔍 Load Resources"**

**Expected Result:**
- Resource cards showing uploaded data
- Each card has: View, Share, IPFS Gateway buttons

### 3. Create a Time-Limited Share

1. On a resource card, click **"🔗 Share"**
2. In the modal:
   - Leave Target Org empty for share link, OR
   - Enter `clinic-org2` to grant direct access
3. Set Expiry: `24` hours
4. Click **"🔗 Create Link"** or **"✅ Grant Access"**

**Expected Result:**
- Share link or grant confirmation
- Expiry timestamp displayed

### 4. View Audit Events (Audit Viewer)

1. Navigate to http://localhost:3000/audit
2. Events load automatically (demo data if backend unavailable)
3. Use filters to search by:
   - Resource ID
   - Organization
   - Event Type (Upload, Access, Grant, Revoke, Share)

**Expected Result:**
- Table or timeline view of audit events
- Stats cards: Total Events, Uploads, Accesses, Shares
- Each event shows: timestamp, action, resource, org, TX ID

## Testing with Backend

### Start Backend First

```powershell
# Terminal 1: Start required services
cd decen-health-db
docker-compose up -d  # Starts IPFS, Vault

# Terminal 2: Start backend
cd backend
$env:VAULT_TOKEN="dev-root-token"
$env:VAULT_ADDR="http://127.0.0.1:8200"
$env:USE_LOCAL_IPFS="true"
$env:LOG_LEVEL="debug"
npm start
```

### Verify Backend Health

```powershell
# Health check
curl http://localhost:4000/health

# Expected response:
{
  "status": "ok",
  "services": {
    "vault": { "connected": true },
    "fabric": { "connected": true }
  }
}
```

### Test Upload via CLI

```powershell
# Create test file
echo '{"resourceType":"Observation","id":"test-001"}' > test.json

# Upload via curl
curl -X POST http://localhost:4000/upload `
  -F "file=@test.json" `
  -F 'fhir={"resourceType":"Observation","id":"test-001","patientId":"patient-demo-001"}'
```

## Environment Variables

Create `.env.local` for custom configuration:

```env
# Backend API URL (default: /api proxied to localhost:4000)
VITE_API_URL=http://localhost:4000

# Default organization ID
VITE_ORG_ID=hospital-org1
```

## Build for Production

```powershell
# Build optimized bundle
npm run build

# Preview production build
npm run preview
```

Output is in `dist/` directory.

## Troubleshooting

### Frontend Not Loading

```powershell
# Check if port 3000 is in use
netstat -an | findstr "3000"

# Kill process if needed, or use different port
npm run dev -- --port 3001
```

### API Errors

1. Check if backend is running: `curl http://localhost:4000/health`
2. Check browser console for CORS errors
3. Verify Vite proxy is working (API calls should go to /api/...)

### Upload Fails

1. Ensure IPFS is running: `curl http://127.0.0.1:5001/api/v0/id`
2. Check Vault is accessible: `curl http://127.0.0.1:8200/v1/sys/health`
3. Review backend logs for detailed error messages

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   React App     │────▶│  Express API    │────▶│  Hyperledger    │
│   (Vite)        │     │  (Node.js)      │     │  Fabric         │
│   Port 3000     │     │  Port 4000      │     │  Chaincode      │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  IPFS    │ │  Vault   │ │ pyUmbral │
              │ :5001    │ │ :8200    │ │ :8000    │
              └──────────┘ └──────────┘ └──────────┘
```

## License

MIT
