/**
 * Patient Portal Page
 * 
 * View and manage health resources:
 * - List patient resources from chaincode
 * - Request access to shared resources
 * - Create time-limited share links
 * - View resource details
 * 
 * Backend endpoints:
 * - GET /resource/patient/:patientId (list resources)
 * - GET /resource/:id (retrieve resource)
 * - POST /share/request (request access)
 * - POST /share/grant (grant access)
 * - POST /share/link (create share link)
 * 
 * Per backend/src/routes/resource.js and backend/src/routes/share.js
 */

import React, { useState, useEffect } from 'react';
import { 
  listPatientResources, 
  getResource, 
  getResourceMeta,
  requestAccess, 
  grantAccess,
  createShareLink,
  ApiError 
} from '../services/api';
import { getGatewayUrl, formatSize } from '../services/ipfs';

// Minimal inline styles
const styles = {
  container: {
    maxWidth: '1000px',
    margin: '0 auto'
  },
  title: {
    fontSize: '1.75rem',
    marginBottom: '0.5rem',
    color: '#333'
  },
  subtitle: {
    color: '#666',
    marginBottom: '2rem'
  },
  controls: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap',
    alignItems: 'flex-end'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  label: {
    fontWeight: '600',
    color: '#333',
    fontSize: '0.875rem'
  },
  input: {
    padding: '0.75rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '1rem',
    minWidth: '200px'
  },
  button: {
    padding: '0.75rem 1.5rem',
    background: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s'
  },
  buttonSecondary: {
    background: '#6c757d'
  },
  buttonSmall: {
    padding: '0.5rem 1rem',
    fontSize: '0.875rem'
  },
  buttonDisabled: {
    background: '#ccc',
    cursor: 'not-allowed'
  },
  banner: {
    padding: '1rem',
    borderRadius: '4px',
    marginBottom: '1rem'
  },
  bannerSuccess: {
    background: '#d4edda',
    border: '1px solid #c3e6cb',
    color: '#155724'
  },
  bannerError: {
    background: '#f8d7da',
    border: '1px solid #f5c6cb',
    color: '#721c24'
  },
  bannerInfo: {
    background: '#cce5ff',
    border: '1px solid #b8daff',
    color: '#004085'
  },
  card: {
    background: 'white',
    border: '1px solid #e9ecef',
    borderRadius: '8px',
    padding: '1.5rem',
    marginBottom: '1rem',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1rem'
  },
  cardTitle: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: '#333'
  },
  cardBadge: {
    padding: '0.25rem 0.75rem',
    borderRadius: '12px',
    fontSize: '0.75rem',
    fontWeight: '600'
  },
  badgeSuccess: {
    background: '#d4edda',
    color: '#155724'
  },
  badgePending: {
    background: '#fff3cd',
    color: '#856404'
  },
  badgeExpired: {
    background: '#f8d7da',
    color: '#721c24'
  },
  cardBody: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '1rem'
  },
  cardItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem'
  },
  cardLabel: {
    fontSize: '0.75rem',
    color: '#666',
    textTransform: 'uppercase'
  },
  cardValue: {
    fontFamily: 'monospace',
    fontSize: '0.9rem',
    wordBreak: 'break-all'
  },
  cardActions: {
    display: 'flex',
    gap: '0.5rem',
    marginTop: '1rem',
    flexWrap: 'wrap'
  },
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modalContent: {
    background: 'white',
    borderRadius: '8px',
    padding: '2rem',
    maxWidth: '500px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto'
  },
  modalTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    marginBottom: '1rem'
  },
  empty: {
    textAlign: 'center',
    padding: '3rem',
    color: '#666'
  },
  tabs: {
    display: 'flex',
    borderBottom: '2px solid #e9ecef',
    marginBottom: '1.5rem'
  },
  tab: {
    padding: '0.75rem 1.5rem',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '1rem',
    color: '#666',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px'
  },
  tabActive: {
    color: '#1a73e8',
    borderBottom: '2px solid #1a73e8'
  }
};

// Mock resources for demo (when backend is unavailable)
const MOCK_RESOURCES = [
  {
    resourceId: 'obs-bp-001',
    fhirType: 'Observation',
    patientId: 'patient-demo-001',
    cid: 'bafkreicqbj6e7dyftye67e2hjv6dh24fdiju7p5otznwmphs6cdvknppve',
    sha256: '500a7c4f8f059e09ef93474d7c33eb851a134fbfae9e5b663cf2f0875535efa9',
    ownerOrgId: 'hospital-org1',
    uploadedAt: new Date(Date.now() - 86400000).toISOString(),
    access: { hasAccess: true, isOwner: true, accessType: 'owner' }
  },
  {
    resourceId: 'img-xray-001',
    fhirType: 'ImagingStudy',
    patientId: 'patient-demo-001',
    cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
    sha256: 'abc123def456...',
    ownerOrgId: 'hospital-org1',
    uploadedAt: new Date(Date.now() - 172800000).toISOString(),
    access: { hasAccess: true, isOwner: true, accessType: 'owner' }
  }
];

function PatientPortal() {
  // State
  const [patientId, setPatientId] = useState('patient-demo-001');
  const [orgId, setOrgId] = useState('hospital-org1');
  const [resources, setResources] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const [activeTab, setActiveTab] = useState('my-resources');
  
  // Modal state
  const [showShareModal, setShowShareModal] = useState(false);
  const [selectedResource, setSelectedResource] = useState(null);
  const [shareTargetOrg, setShareTargetOrg] = useState('');
  const [shareExpiryHours, setShareExpiryHours] = useState(24);
  const [shareResult, setShareResult] = useState(null);

  // Load resources on mount or when patient changes
  const loadResources = async () => {
    setIsLoading(true);
    setBanner(null);

    try {
      const data = await listPatientResources(patientId, { orgId });
      setResources(data);
    } catch (error) {
      console.warn('Backend unavailable, using mock data:', error.message);
      
      // Use mock data for demo when backend is unavailable
      setResources(MOCK_RESOURCES.filter(r => r.patientId === patientId));
      setBanner({ 
        type: 'info', 
        message: 'Backend unavailable. Showing demo data. Start backend with: cd backend && npm start' 
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch resource (view content)
  const viewResource = async (resourceId) => {
    setBanner(null);
    
    try {
      setBanner({ type: 'info', message: `Fetching resource ${resourceId}...` });
      const data = await getResource(resourceId, { orgId });
      
      // Display resource content (in real app, would open in viewer)
      console.log('Resource data:', data);
      setBanner({ type: 'success', message: `Resource ${resourceId} fetched successfully. Check console for data.` });
    } catch (error) {
      setBanner({ 
        type: 'error', 
        message: error instanceof ApiError 
          ? `Access denied: ${error.message}` 
          : `Error: ${error.message}` 
      });
    }
  };

  // Open share modal
  const openShareModal = (resource) => {
    setSelectedResource(resource);
    setShareTargetOrg('');
    setShareExpiryHours(24);
    setShareResult(null);
    setShowShareModal(true);
  };

  // Create share
  const handleCreateShare = async () => {
    if (!selectedResource) return;

    try {
      if (shareTargetOrg) {
        // Grant access to specific organization
        const result = await grantAccess(selectedResource.resourceId, shareTargetOrg, {
          orgId,
          expiryHours: shareExpiryHours
        });
        setShareResult({
          type: 'grant',
          message: `Access granted to ${shareTargetOrg} for ${shareExpiryHours} hours`,
          ...result
        });
      } else {
        // Create share link
        const result = await createShareLink(selectedResource.resourceId, {
          orgId,
          expiryHours: shareExpiryHours
        });
        setShareResult({
          type: 'link',
          message: `Share link created (expires in ${shareExpiryHours} hours)`,
          ...result
        });
      }
      setBanner({ type: 'success', message: 'Share created successfully!' });
    } catch (error) {
      if (error.status === 501) {
        // Share endpoint not implemented - show demo result
        setShareResult({
          type: shareTargetOrg ? 'grant' : 'link',
          message: `Demo: Share would be created for ${shareExpiryHours} hours`,
          shareUrl: shareTargetOrg ? null : `${window.location.origin}/share/demo-${Date.now()}`,
          expiryTimestamp: new Date(Date.now() + shareExpiryHours * 3600000).toISOString(),
          demo: true
        });
      } else {
        setBanner({ type: 'error', message: `Share failed: ${error.message}` });
      }
    }
  };

  // Request access
  const handleRequestAccess = async (resourceId) => {
    setBanner(null);
    
    try {
      const result = await requestAccess(resourceId, { 
        orgId,
        reason: 'Patient care - treatment planning'
      });
      setBanner({ type: 'success', message: 'Access request submitted!' });
    } catch (error) {
      if (error.status === 501) {
        setBanner({ type: 'info', message: 'Demo: Access request would be sent to resource owner.' });
      } else {
        setBanner({ type: 'error', message: `Request failed: ${error.message}` });
      }
    }
  };

  // Get access badge style
  const getAccessBadge = (access) => {
    if (!access) return { style: styles.badgePending, text: 'Unknown' };
    if (access.isOwner) return { style: styles.badgeSuccess, text: 'Owner' };
    if (access.hasAccess) {
      if (access.expiryTimestamp && new Date(access.expiryTimestamp) < new Date()) {
        return { style: styles.badgeExpired, text: 'Expired' };
      }
      return { style: styles.badgeSuccess, text: 'Shared' };
    }
    return { style: styles.badgePending, text: 'No Access' };
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Patient Portal</h1>
      <p style={styles.subtitle}>
        View your health records, request access to shared resources, and create time-limited shares.
      </p>

      {/* Banner */}
      {banner && (
        <div style={{
          ...styles.banner,
          ...(banner.type === 'success' ? styles.bannerSuccess : 
              banner.type === 'error' ? styles.bannerError : styles.bannerInfo)
        }}>
          {banner.message}
        </div>
      )}

      {/* Controls */}
      <div style={styles.controls}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Patient ID</label>
          <input
            type="text"
            style={styles.input}
            value={patientId}
            onChange={(e) => setPatientId(e.target.value)}
            placeholder="e.g., patient-demo-001"
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Organization ID</label>
          <input
            type="text"
            style={styles.input}
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="e.g., hospital-org1"
          />
        </div>
        <button
          style={{
            ...styles.button,
            ...(isLoading ? styles.buttonDisabled : {})
          }}
          onClick={loadResources}
          disabled={isLoading}
        >
          {isLoading ? '⏳ Loading...' : '🔍 Load Resources'}
        </button>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'my-resources' ? styles.tabActive : {})
          }}
          onClick={() => setActiveTab('my-resources')}
        >
          My Resources ({resources.length})
        </button>
        <button
          style={{
            ...styles.tab,
            ...(activeTab === 'shared-with-me' ? styles.tabActive : {})
          }}
          onClick={() => setActiveTab('shared-with-me')}
        >
          Shared With Me
        </button>
      </div>

      {/* Resource List */}
      {resources.length === 0 ? (
        <div style={styles.empty}>
          <p>📂 No resources found</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Click "Load Resources" to fetch patient data, or upload new records.
          </p>
        </div>
      ) : (
        resources.map((resource) => {
          const badge = getAccessBadge(resource.access);
          
          return (
            <div key={resource.resourceId} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>
                  {resource.fhirType}: {resource.resourceId}
                </span>
                <span style={{ ...styles.cardBadge, ...badge.style }}>
                  {badge.text}
                </span>
              </div>
              
              <div style={styles.cardBody}>
                <div style={styles.cardItem}>
                  <span style={styles.cardLabel}>IPFS CID</span>
                  <span style={styles.cardValue}>
                    {resource.cid?.substring(0, 20)}...
                  </span>
                </div>
                <div style={styles.cardItem}>
                  <span style={styles.cardLabel}>Owner Org</span>
                  <span style={styles.cardValue}>{resource.ownerOrgId}</span>
                </div>
                <div style={styles.cardItem}>
                  <span style={styles.cardLabel}>Uploaded</span>
                  <span style={styles.cardValue}>
                    {new Date(resource.uploadedAt).toLocaleString()}
                  </span>
                </div>
                <div style={styles.cardItem}>
                  <span style={styles.cardLabel}>SHA-256</span>
                  <span style={styles.cardValue}>
                    {resource.sha256?.substring(0, 16)}...
                  </span>
                </div>
              </div>
              
              <div style={styles.cardActions}>
                {resource.access?.hasAccess ? (
                  <>
                    <button
                      style={{ ...styles.button, ...styles.buttonSmall }}
                      onClick={() => viewResource(resource.resourceId)}
                    >
                      👁️ View
                    </button>
                    <button
                      style={{ ...styles.button, ...styles.buttonSmall, ...styles.buttonSecondary }}
                      onClick={() => openShareModal(resource)}
                    >
                      🔗 Share
                    </button>
                    <a
                      href={getGatewayUrl(resource.cid)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        ...styles.button,
                        ...styles.buttonSmall,
                        ...styles.buttonSecondary,
                        textDecoration: 'none',
                        display: 'inline-block'
                      }}
                    >
                      🌐 IPFS Gateway
                    </a>
                  </>
                ) : (
                  <button
                    style={{ ...styles.button, ...styles.buttonSmall }}
                    onClick={() => handleRequestAccess(resource.resourceId)}
                  >
                    🔓 Request Access
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* Share Modal */}
      {showShareModal && selectedResource && (
        <div style={styles.modal} onClick={() => setShowShareModal(false)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h2 style={styles.modalTitle}>
              Share: {selectedResource.fhirType} - {selectedResource.resourceId}
            </h2>
            
            <div style={{ ...styles.formGroup, marginBottom: '1rem' }}>
              <label style={styles.label}>Target Organization (optional)</label>
              <input
                type="text"
                style={styles.input}
                value={shareTargetOrg}
                onChange={(e) => setShareTargetOrg(e.target.value)}
                placeholder="Leave empty for share link"
              />
              <small style={{ color: '#666' }}>
                Specify an org ID to grant direct access, or leave empty to create a share link.
              </small>
            </div>
            
            <div style={{ ...styles.formGroup, marginBottom: '1.5rem' }}>
              <label style={styles.label}>Expiry (hours)</label>
              <input
                type="number"
                style={{ ...styles.input, width: '100px' }}
                value={shareExpiryHours}
                onChange={(e) => setShareExpiryHours(parseInt(e.target.value) || 24)}
                min={1}
                max={720}
              />
            </div>
            
            {shareResult && (
              <div style={{
                ...styles.banner,
                ...(shareResult.demo ? styles.bannerInfo : styles.bannerSuccess),
                marginBottom: '1rem'
              }}>
                <p><strong>{shareResult.message}</strong></p>
                {shareResult.shareUrl && (
                  <p style={{ marginTop: '0.5rem', wordBreak: 'break-all' }}>
                    URL: {shareResult.shareUrl}
                  </p>
                )}
                <p style={{ marginTop: '0.25rem', fontSize: '0.875rem' }}>
                  Expires: {new Date(shareResult.expiryTimestamp).toLocaleString()}
                </p>
              </div>
            )}
            
            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
              <button
                style={{ ...styles.button, ...styles.buttonSecondary }}
                onClick={() => setShowShareModal(false)}
              >
                Close
              </button>
              <button
                style={styles.button}
                onClick={handleCreateShare}
              >
                {shareTargetOrg ? '✅ Grant Access' : '🔗 Create Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PatientPortal;
