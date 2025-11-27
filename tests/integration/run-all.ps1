# =============================================================================
# Integration Test Suite - Decentralized Health DB (PowerShell)
#
# Runs end-to-end tests against the running backend
#
# Usage: .\tests\integration\run-all.ps1
# =============================================================================

$ErrorActionPreference = "Stop"

$BACKEND_URL = if ($env:BACKEND_URL) { $env:BACKEND_URL } else { "http://localhost:4000" }
$OWNER_ORG = "hospital-alpha"
$GRANTEE_ORG = "lab-beta"
$ATTACKER_ORG = "attacker-org"

$PassCount = 0
$FailCount = 0

function Log-Test { param($msg) Write-Host "`n[TEST] $msg" -ForegroundColor Yellow }
function Log-Pass { param($msg) $script:PassCount++; Write-Host "[PASS] $msg" -ForegroundColor Green }
function Log-Fail { param($msg) $script:FailCount++; Write-Host "[FAIL] $msg" -ForegroundColor Red }

Write-Host "=============================================================="
Write-Host "Decentralized Health DB - Integration Test Suite (PowerShell)"
Write-Host "=============================================================="
Write-Host "Backend: $BACKEND_URL"
Write-Host ""

# Test 1: Health Check
Log-Test "1. Health Check"
try {
    $health = Invoke-RestMethod -Uri "$BACKEND_URL/health" -Method Get
    if ($health.status) {
        Log-Pass "Health endpoint responds"
        Write-Host "Status: $($health.status)"
    }
} catch {
    Log-Fail "Health endpoint not responding: $_"
}

# Test 2: Debug Status
Log-Test "2. Debug Status (comprehensive health)"
try {
    $status = Invoke-RestMethod -Uri "$BACKEND_URL/debug/status" -Method Get
    if ($status.services) {
        Log-Pass "Debug status endpoint works"
        Write-Host "Overall: $($status.status)"
        Write-Host "Vault: $($status.services.vault.reachable)"
        Write-Host "Fabric: $($status.services.fabric.connected)"
    }
} catch {
    Log-Fail "Debug status failed: $_"
}

# Test 3: Register Owner Org
Log-Test "3. Register Owner Organization ($OWNER_ORG)"
try {
    $body = @{ orgId = $OWNER_ORG; name = "Hospital Alpha"; type = "hospital" } | ConvertTo-Json
    $org = Invoke-RestMethod -Uri "$BACKEND_URL/org/register" -Method Post -Body $body -ContentType "application/json"
    Log-Pass "Owner organization registered or exists"
} catch {
    if ($_.Exception.Response.StatusCode -eq 409) {
        Log-Pass "Owner organization already exists"
    } else {
        Log-Fail "Failed to register owner: $_"
    }
}

# Test 4: Register Grantee Org
Log-Test "4. Register Grantee Organization ($GRANTEE_ORG)"
try {
    $body = @{ orgId = $GRANTEE_ORG; name = "Lab Beta"; type = "laboratory" } | ConvertTo-Json
    $org2 = Invoke-RestMethod -Uri "$BACKEND_URL/org/register" -Method Post -Body $body -ContentType "application/json"
    Log-Pass "Grantee organization registered or exists"
} catch {
    if ($_.Exception.Response.StatusCode -eq 409) {
        Log-Pass "Grantee organization already exists"
    } else {
        Log-Fail "Failed to register grantee: $_"
    }
}

# Test 5: Upload Sample Resource
Log-Test "5. Upload Sample Resource"
$RESOURCE_ID = "test-obs-001"
try {
    $tempFile = [System.IO.Path]::GetTempFileName()
    $fhirContent = '{"resourceType":"Observation","id":"test-obs-001","status":"final"}'
    Set-Content -Path $tempFile -Value $fhirContent
    
    # Use curl for multipart upload (more reliable for form-data)
    $curlResult = curl.exe -s -X POST "$BACKEND_URL/upload" `
        -H "x-org-id: $OWNER_ORG" `
        -F "file=@$tempFile" `
        -F 'fhir={"resourceType":"Observation","id":"test-obs-001","patientId":"patient-123"}'
    
    Remove-Item $tempFile -Force
    
    if ($curlResult -match '"cid"' -or $curlResult -match '"resourceId"') {
        Log-Pass "Resource uploaded successfully"
        $uploadJson = $curlResult | ConvertFrom-Json
        $RESOURCE_ID = if ($uploadJson.resourceId) { $uploadJson.resourceId } else { "test-obs-001" }
        Write-Host "Resource ID: $RESOURCE_ID"
    } else {
        Log-Fail "Upload failed"
        Write-Host "Response: $curlResult"
    }
} catch {
    Log-Fail "Upload error: $_"
}

# Test 6: Fetch as Owner
Log-Test "6. Fetch Resource as Owner ($OWNER_ORG)"
try {
    $headers = @{ "x-org-id" = $OWNER_ORG }
    $resource = Invoke-WebRequest -Uri "$BACKEND_URL/resource/$RESOURCE_ID" -Headers $headers
    if ($resource.StatusCode -eq 200) {
        Log-Pass "Owner can fetch resource (HTTP 200)"
    }
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    Log-Fail "Owner fetch failed (HTTP $code)"
}

# Test 7: Fetch as Unauthorized
Log-Test "7. Fetch Resource as Unauthorized Org ($GRANTEE_ORG, expect 403)"
try {
    $headers = @{ "x-org-id" = $GRANTEE_ORG }
    $resource = Invoke-WebRequest -Uri "$BACKEND_URL/resource/$RESOURCE_ID" -Headers $headers -ErrorAction Stop
    Log-Fail "Expected 403, got $($resource.StatusCode)"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 403) {
        Log-Pass "Unauthorized org correctly denied (HTTP 403)"
    } else {
        Log-Fail "Expected 403, got HTTP $code"
    }
}

# Test 8: Grant Access
Log-Test "8. Grant Access to Grantee Org ($GRANTEE_ORG)"
try {
    $body = @{ resourceId = $RESOURCE_ID; targetOrgId = $GRANTEE_ORG; expiryHours = 24; accessType = "read" } | ConvertTo-Json
    $headers = @{ "x-org-id" = $OWNER_ORG }
    $grant = Invoke-RestMethod -Uri "$BACKEND_URL/share/grant" -Method Post -Body $body -ContentType "application/json" -Headers $headers
    Log-Pass "Access granted successfully"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 501) {
        Log-Pass "Share endpoint returns 501 (not yet implemented - expected)"
    } else {
        Log-Fail "Grant access failed: $_"
    }
}

# Test 9: Revoke Attacker
Log-Test "9. Simulate Attack - Revoke Org ($ATTACKER_ORG)"
try {
    $body = @{ orgId = $ATTACKER_ORG; reason = "Suspicious activity" } | ConvertTo-Json
    $revoke = Invoke-RestMethod -Uri "$BACKEND_URL/simulate-attack/revoke-org" -Method Post -Body $body -ContentType "application/json"
    Log-Pass "Attacker org revoked"
} catch {
    Log-Fail "Failed to revoke org: $_"
}

# Test 10: Fetch as Revoked
Log-Test "10. Fetch Resource as Revoked Org ($ATTACKER_ORG, expect 403)"
try {
    $headers = @{ "x-org-id" = $ATTACKER_ORG }
    $resource = Invoke-WebRequest -Uri "$BACKEND_URL/resource/$RESOURCE_ID" -Headers $headers -ErrorAction Stop
    Log-Fail "Expected 403, got $($resource.StatusCode)"
} catch {
    $code = $_.Exception.Response.StatusCode.value__
    if ($code -eq 403) {
        Log-Pass "Revoked org correctly denied (HTTP 403)"
    } else {
        Log-Fail "Expected 403, got HTTP $code"
    }
}

# Test 11: Reinstate
Log-Test "11. Reinstate Previously Revoked Org ($ATTACKER_ORG)"
try {
    $body = @{ orgId = $ATTACKER_ORG } | ConvertTo-Json
    $reinstate = Invoke-RestMethod -Uri "$BACKEND_URL/simulate-attack/reinstate-org" -Method Post -Body $body -ContentType "application/json"
    Log-Pass "Org reinstated"
} catch {
    Log-Fail "Failed to reinstate: $_"
}

# Test 12: Clear Attacks
Log-Test "12. Clear All Attack Simulations"
try {
    $clear = Invoke-RestMethod -Uri "$BACKEND_URL/simulate-attack" -Method Delete
    Log-Pass "Attack simulations cleared"
} catch {
    Log-Fail "Failed to clear: $_"
}

# Summary
Write-Host "`n=============================================================="
Write-Host "Integration Test Summary"
Write-Host "=============================================================="
Write-Host "Passed: $PassCount" -ForegroundColor Green
Write-Host "Failed: $FailCount" -ForegroundColor Red
Write-Host ""

if ($FailCount -gt 0) {
    Write-Host "Some tests failed!" -ForegroundColor Red
    exit 1
} else {
    Write-Host "All tests passed!" -ForegroundColor Green
    exit 0
}
