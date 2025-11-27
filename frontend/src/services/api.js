/**
 * API Service - Fetch Wrappers for Backend
 * 
 * Simple fetch wrappers for communicating with the Express backend.
 * 
 * Backend Endpoints (per backend/src/server.js):
 * - POST /upload      - Upload encrypted file to IPFS
 * - GET  /resource/:id - Retrieve and decrypt resource
 * - POST /share        - Create/manage access shares (stub)
 * - GET  /audit        - Get audit events (stub)
 * - GET  /health       - Health check
 * 
 * References:
 * - Fetch API: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API
 * - Express Backend: backend/src/routes/*.js
 */

// Backend URL - uses Vite proxy in dev, direct URL in production
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Default organization ID for demo purposes
const DEFAULT_ORG_ID = import.meta.env.VITE_ORG_ID || 'org1';

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

/**
 * Generic fetch wrapper with error handling
 * 
 * @param {string} endpoint - API endpoint path
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} Response data
 */
async function fetchApi(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Default headers
  const headers = {
    'x-org-id': options.orgId || DEFAULT_ORG_ID,
    ...options.headers
  };

  // Don't set Content-Type for FormData (browser sets boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });

    // Parse response
    const contentType = response.headers.get('Content-Type') || '';
    let data;
    
    if (contentType.includes('application/json') || contentType.includes('application/fhir+json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Handle errors
    if (!response.ok) {
      throw new ApiError(
        data?.message || data?.error || `HTTP ${response.status}`,
        response.status,
        data
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // Network or parsing error
    throw new ApiError(
      error.message || 'Network error',
      0,
      null
    );
  }
}

// ============================================================
// UPLOAD API
// ============================================================

/**
 * Upload a file with FHIR metadata
 * 
 * Per backend/src/routes/upload.js:
 * - POST /upload (multipart/form-data)
 * - Fields: file (required), fhir (JSON string, required)
 * 
 * @param {File} file - File to upload
 * @param {Object} fhirMeta - FHIR metadata { resourceType, id, patientId }
 * @param {Object} options - Additional options
 * @returns {Promise<{cid, sha256, fhirType, fhirId, backend}>}
 */
export async function uploadFile(file, fhirMeta, options = {}) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('fhir', JSON.stringify(fhirMeta));

  return fetchApi('/upload', {
    method: 'POST',
    body: formData,
    orgId: options.orgId
  });
}

/**
 * Get upload service info
 * 
 * @returns {Promise<{uploadEndpoint, fields, storage, encryption, limits}>}
 */
export async function getUploadInfo() {
  return fetchApi('/upload/info');
}

// ============================================================
// RESOURCE API
// ============================================================

/**
 * Get a decrypted resource by ID
 * 
 * Per backend/src/routes/resource.js:
 * - GET /resource/:id
 * - Header: x-org-id (required)
 * 
 * @param {string} resourceId - Resource identifier
 * @param {Object} options - { orgId, stream }
 * @returns {Promise<any>} Decrypted resource content
 */
export async function getResource(resourceId, options = {}) {
  const queryParams = options.stream ? '?stream=true' : '';
  return fetchApi(`/resource/${resourceId}${queryParams}`, {
    method: 'GET',
    orgId: options.orgId
  });
}

/**
 * Get resource metadata (without decryption)
 * 
 * @param {string} resourceId - Resource identifier
 * @param {Object} options - { orgId }
 * @returns {Promise<{resourceId, fhirType, ownerOrgId, uploadedAt, access}>}
 */
export async function getResourceMeta(resourceId, options = {}) {
  return fetchApi(`/resource/${resourceId}/meta`, {
    method: 'GET',
    orgId: options.orgId
  });
}

/**
 * List resources for a patient (calls queryByPatient on chaincode)
 * 
 * @param {string} patientId - Patient identifier
 * @param {Object} options - { orgId }
 * @returns {Promise<Array>} List of resource metadata
 */
export async function listPatientResources(patientId, options = {}) {
  return fetchApi(`/resource/patient/${patientId}`, {
    method: 'GET',
    orgId: options.orgId
  });
}

// ============================================================
// SHARE API (Currently Stub - Returns 501)
// ============================================================

/**
 * Request access to a resource
 * 
 * @param {string} resourceId - Resource identifier
 * @param {Object} options - { orgId, requestingOrgId, reason }
 * @returns {Promise<{success, requestId}>}
 */
export async function requestAccess(resourceId, options = {}) {
  return fetchApi('/share/request', {
    method: 'POST',
    body: JSON.stringify({
      resourceId,
      requestingOrgId: options.requestingOrgId || options.orgId,
      reason: options.reason || 'Patient care'
    }),
    orgId: options.orgId
  });
}

/**
 * Grant access to a resource (with optional time limit)
 * 
 * @param {string} resourceId - Resource identifier
 * @param {string} targetOrgId - Organization to grant access to
 * @param {Object} options - { orgId, expiryHours, accessType }
 * @returns {Promise<{success, shareId, expiryTimestamp}>}
 */
export async function grantAccess(resourceId, targetOrgId, options = {}) {
  return fetchApi('/share/grant', {
    method: 'POST',
    body: JSON.stringify({
      resourceId,
      targetOrgId,
      expiryHours: options.expiryHours || 24,
      accessType: options.accessType || 'read'
    }),
    orgId: options.orgId
  });
}

/**
 * Create a time-limited share link
 * 
 * @param {string} resourceId - Resource identifier
 * @param {Object} options - { orgId, expiryHours }
 * @returns {Promise<{shareUrl, expiryTimestamp}>}
 */
export async function createShareLink(resourceId, options = {}) {
  return fetchApi('/share/link', {
    method: 'POST',
    body: JSON.stringify({
      resourceId,
      expiryHours: options.expiryHours || 24
    }),
    orgId: options.orgId
  });
}

/**
 * Revoke a share
 * 
 * @param {string} shareId - Share identifier
 * @param {Object} options - { orgId }
 * @returns {Promise<{success}>}
 */
export async function revokeShare(shareId, options = {}) {
  return fetchApi(`/share/${shareId}`, {
    method: 'DELETE',
    orgId: options.orgId
  });
}

/**
 * List active shares for a resource
 * 
 * @param {string} resourceId - Resource identifier
 * @param {Object} options - { orgId }
 * @returns {Promise<Array>} List of active shares
 */
export async function listShares(resourceId, options = {}) {
  return fetchApi(`/share/resource/${resourceId}`, {
    method: 'GET',
    orgId: options.orgId
  });
}

// ============================================================
// AUDIT API (Currently Stub - Returns 501)
// ============================================================

/**
 * Get audit events from blockchain
 * 
 * @param {Object} filters - { resourceId, orgId, action, startTime, endTime }
 * @param {Object} options - { orgId, limit }
 * @returns {Promise<Array>} List of audit events
 */
export async function getAuditEvents(filters = {}, options = {}) {
  const queryParams = new URLSearchParams();
  
  if (filters.resourceId) queryParams.set('resourceId', filters.resourceId);
  if (filters.targetOrgId) queryParams.set('targetOrgId', filters.targetOrgId);
  if (filters.action) queryParams.set('action', filters.action);
  if (filters.startTime) queryParams.set('startTime', filters.startTime);
  if (filters.endTime) queryParams.set('endTime', filters.endTime);
  if (options.limit) queryParams.set('limit', options.limit);

  const queryString = queryParams.toString();
  return fetchApi(`/audit${queryString ? '?' + queryString : ''}`, {
    method: 'GET',
    orgId: options.orgId
  });
}

/**
 * Get audit events for a specific resource
 * 
 * @param {string} resourceId - Resource identifier
 * @param {Object} options - { orgId, limit }
 * @returns {Promise<Array>} List of audit events
 */
export async function getResourceAudit(resourceId, options = {}) {
  return getAuditEvents({ resourceId }, options);
}

// ============================================================
// HEALTH CHECK
// ============================================================

/**
 * Check backend health status
 * 
 * @returns {Promise<{status, timestamp, services}>}
 */
export async function healthCheck() {
  return fetchApi('/health');
}

// ============================================================
// EXPORTS
// ============================================================

export default {
  // Upload
  uploadFile,
  getUploadInfo,
  
  // Resource
  getResource,
  getResourceMeta,
  listPatientResources,
  
  // Share
  requestAccess,
  grantAccess,
  createShareLink,
  revokeShare,
  listShares,
  
  // Audit
  getAuditEvents,
  getResourceAudit,
  
  // Health
  healthCheck,
  
  // Error class
  ApiError
};
