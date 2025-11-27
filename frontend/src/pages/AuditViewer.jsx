/**
 * Audit Viewer Page
 * 
 * Display on-chain audit events from Hyperledger Fabric chaincode.
 * Shows access logs, uploads, shares, and consent changes.
 * 
 * Backend endpoint: GET /audit
 * Per backend/src/routes/audit.js (currently returns 501 - stub)
 * 
 * Chaincode events logged:
 * - uploadMeta: Resource uploaded to IPFS
 * - logAccess: Resource accessed/retrieved
 * - grantAccess: Access granted to org
 * - revokeAccess: Access revoked
 * - createShare: Share link created
 * 
 * References:
 * - Hyperledger Fabric Events: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html#handling-events
 */

import React, { useState, useEffect } from 'react';
import { getAuditEvents, getResourceAudit, ApiError } from '../services/api';

// Minimal inline styles
const styles = {
  container: {
    maxWidth: '1200px',
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
  filters: {
    display: 'flex',
    gap: '1rem',
    marginBottom: '1.5rem',
    flexWrap: 'wrap',
    padding: '1rem',
    background: '#f8f9fa',
    borderRadius: '8px'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  label: {
    fontWeight: '600',
    color: '#333',
    fontSize: '0.75rem',
    textTransform: 'uppercase'
  },
  input: {
    padding: '0.5rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '0.9rem'
  },
  select: {
    padding: '0.5rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '0.9rem',
    background: 'white',
    minWidth: '120px'
  },
  button: {
    padding: '0.5rem 1rem',
    background: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '0.9rem',
    fontWeight: '600',
    cursor: 'pointer',
    alignSelf: 'flex-end'
  },
  buttonSecondary: {
    background: '#6c757d'
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
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    background: 'white',
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  th: {
    padding: '1rem',
    textAlign: 'left',
    background: '#f8f9fa',
    borderBottom: '2px solid #dee2e6',
    fontWeight: '600',
    fontSize: '0.875rem',
    color: '#333'
  },
  td: {
    padding: '0.75rem 1rem',
    borderBottom: '1px solid #dee2e6',
    fontSize: '0.9rem',
    verticalAlign: 'top'
  },
  badge: {
    display: 'inline-block',
    padding: '0.25rem 0.5rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: '600'
  },
  badgeUpload: {
    background: '#d4edda',
    color: '#155724'
  },
  badgeAccess: {
    background: '#cce5ff',
    color: '#004085'
  },
  badgeGrant: {
    background: '#fff3cd',
    color: '#856404'
  },
  badgeRevoke: {
    background: '#f8d7da',
    color: '#721c24'
  },
  badgeShare: {
    background: '#e2e3e5',
    color: '#383d41'
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    wordBreak: 'break-all'
  },
  empty: {
    textAlign: 'center',
    padding: '3rem',
    color: '#666',
    background: 'white',
    borderRadius: '8px'
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '1rem',
    marginBottom: '1.5rem'
  },
  statCard: {
    background: 'white',
    padding: '1rem',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
    textAlign: 'center'
  },
  statNumber: {
    fontSize: '2rem',
    fontWeight: '700',
    color: '#1a73e8'
  },
  statLabel: {
    fontSize: '0.75rem',
    color: '#666',
    textTransform: 'uppercase',
    marginTop: '0.25rem'
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    gap: '0.5rem',
    marginTop: '1rem'
  },
  timeline: {
    position: 'relative',
    paddingLeft: '2rem'
  },
  timelineItem: {
    position: 'relative',
    paddingBottom: '1.5rem',
    paddingLeft: '1.5rem',
    borderLeft: '2px solid #dee2e6'
  },
  timelineDot: {
    position: 'absolute',
    left: '-0.5rem',
    width: '1rem',
    height: '1rem',
    borderRadius: '50%',
    background: '#1a73e8'
  },
  timelineContent: {
    background: 'white',
    padding: '1rem',
    borderRadius: '8px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
  },
  viewToggle: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1rem'
  }
};

// Event action types
const EVENT_TYPES = [
  { value: '', label: 'All Events' },
  { value: 'upload', label: 'Upload' },
  { value: 'retrieve', label: 'Access' },
  { value: 'grant', label: 'Grant Access' },
  { value: 'revoke', label: 'Revoke Access' },
  { value: 'share', label: 'Create Share' }
];

// Mock audit events for demo
const MOCK_EVENTS = [
  {
    id: 'evt-001',
    action: 'upload',
    resourceId: 'obs-bp-001',
    fhirType: 'Observation',
    orgId: 'hospital-org1',
    targetOrgId: null,
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    txId: 'tx-abc123def456',
    details: { cid: 'bafkreicqbj6e7dyftye67e2hjv6dh24fdiju7p5otznwmphs6cdvknppve' }
  },
  {
    id: 'evt-002',
    action: 'retrieve',
    resourceId: 'obs-bp-001',
    fhirType: 'Observation',
    orgId: 'hospital-org1',
    targetOrgId: null,
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    txId: 'tx-ghi789jkl012',
    details: { accessType: 'owner' }
  },
  {
    id: 'evt-003',
    action: 'grant',
    resourceId: 'obs-bp-001',
    fhirType: 'Observation',
    orgId: 'hospital-org1',
    targetOrgId: 'clinic-org2',
    timestamp: new Date(Date.now() - 900000).toISOString(),
    txId: 'tx-mno345pqr678',
    details: { expiryHours: 24 }
  },
  {
    id: 'evt-004',
    action: 'retrieve',
    resourceId: 'obs-bp-001',
    fhirType: 'Observation',
    orgId: 'clinic-org2',
    targetOrgId: null,
    timestamp: new Date(Date.now() - 600000).toISOString(),
    txId: 'tx-stu901vwx234',
    details: { accessType: 'shared' }
  },
  {
    id: 'evt-005',
    action: 'upload',
    resourceId: 'img-xray-001',
    fhirType: 'ImagingStudy',
    orgId: 'hospital-org1',
    targetOrgId: null,
    timestamp: new Date(Date.now() - 7200000).toISOString(),
    txId: 'tx-yza567bcd890',
    details: { cid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' }
  }
];

// Get badge style for action type
const getActionBadge = (action) => {
  switch (action) {
    case 'upload':
      return { style: styles.badgeUpload, icon: '📤', label: 'Upload' };
    case 'retrieve':
      return { style: styles.badgeAccess, icon: '👁️', label: 'Access' };
    case 'grant':
      return { style: styles.badgeGrant, icon: '✅', label: 'Grant' };
    case 'revoke':
      return { style: styles.badgeRevoke, icon: '🚫', label: 'Revoke' };
    case 'share':
      return { style: styles.badgeShare, icon: '🔗', label: 'Share' };
    default:
      return { style: styles.badgeShare, icon: '📋', label: action };
  }
};

function AuditViewer() {
  // State
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [banner, setBanner] = useState(null);
  const [viewMode, setViewMode] = useState('table'); // 'table' or 'timeline'
  
  // Filters
  const [filters, setFilters] = useState({
    resourceId: '',
    orgId: '',
    action: '',
    limit: 50
  });
  
  // Stats
  const [stats, setStats] = useState({
    total: 0,
    uploads: 0,
    accesses: 0,
    shares: 0
  });

  // Load events
  const loadEvents = async () => {
    setIsLoading(true);
    setBanner(null);

    try {
      const data = await getAuditEvents(
        {
          resourceId: filters.resourceId || undefined,
          targetOrgId: filters.orgId || undefined,
          action: filters.action || undefined
        },
        { limit: filters.limit }
      );
      
      setEvents(Array.isArray(data) ? data : []);
      calculateStats(data);
    } catch (error) {
      console.warn('Backend unavailable, using mock data:', error.message);
      
      // Use mock data for demo
      let mockFiltered = [...MOCK_EVENTS];
      
      if (filters.resourceId) {
        mockFiltered = mockFiltered.filter(e => 
          e.resourceId.toLowerCase().includes(filters.resourceId.toLowerCase())
        );
      }
      if (filters.orgId) {
        mockFiltered = mockFiltered.filter(e => 
          e.orgId === filters.orgId || e.targetOrgId === filters.orgId
        );
      }
      if (filters.action) {
        mockFiltered = mockFiltered.filter(e => e.action === filters.action);
      }
      
      setEvents(mockFiltered);
      calculateStats(mockFiltered);
      setBanner({ 
        type: 'info', 
        message: 'Backend unavailable. Showing demo audit data.' 
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Calculate stats from events
  const calculateStats = (eventList) => {
    const total = eventList.length;
    const uploads = eventList.filter(e => e.action === 'upload').length;
    const accesses = eventList.filter(e => e.action === 'retrieve').length;
    const shares = eventList.filter(e => ['grant', 'share'].includes(e.action)).length;
    
    setStats({ total, uploads, accesses, shares });
  };

  // Load events on mount
  useEffect(() => {
    loadEvents();
  }, []);

  // Clear filters
  const clearFilters = () => {
    setFilters({
      resourceId: '',
      orgId: '',
      action: '',
      limit: 50
    });
  };

  // Render table view
  const renderTableView = () => (
    <table style={styles.table}>
      <thead>
        <tr>
          <th style={styles.th}>Time</th>
          <th style={styles.th}>Action</th>
          <th style={styles.th}>Resource</th>
          <th style={styles.th}>Organization</th>
          <th style={styles.th}>Target Org</th>
          <th style={styles.th}>Transaction</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => {
          const badge = getActionBadge(event.action);
          
          return (
            <tr key={event.id || event.txId}>
              <td style={styles.td}>
                {new Date(event.timestamp).toLocaleString()}
              </td>
              <td style={styles.td}>
                <span style={{ ...styles.badge, ...badge.style }}>
                  {badge.icon} {badge.label}
                </span>
              </td>
              <td style={styles.td}>
                <div style={{ fontWeight: '600' }}>{event.resourceId}</div>
                <div style={{ fontSize: '0.75rem', color: '#666' }}>
                  {event.fhirType}
                </div>
              </td>
              <td style={styles.td}>
                <span style={styles.mono}>{event.orgId}</span>
              </td>
              <td style={styles.td}>
                {event.targetOrgId ? (
                  <span style={styles.mono}>{event.targetOrgId}</span>
                ) : (
                  <span style={{ color: '#999' }}>—</span>
                )}
              </td>
              <td style={styles.td}>
                <span style={styles.mono} title={event.txId}>
                  {event.txId?.substring(0, 12)}...
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // Render timeline view
  const renderTimelineView = () => (
    <div style={styles.timeline}>
      {events.map((event, index) => {
        const badge = getActionBadge(event.action);
        
        return (
          <div key={event.id || event.txId} style={styles.timelineItem}>
            <div style={{
              ...styles.timelineDot,
              background: event.action === 'upload' ? '#28a745' :
                         event.action === 'retrieve' ? '#007bff' :
                         event.action === 'grant' ? '#ffc107' :
                         event.action === 'revoke' ? '#dc3545' : '#6c757d'
            }} />
            <div style={styles.timelineContent}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span style={{ ...styles.badge, ...badge.style }}>
                  {badge.icon} {badge.label}
                </span>
                <span style={{ fontSize: '0.875rem', color: '#666' }}>
                  {new Date(event.timestamp).toLocaleString()}
                </span>
              </div>
              <div style={{ marginBottom: '0.5rem' }}>
                <strong>{event.resourceId}</strong> ({event.fhirType})
              </div>
              <div style={{ fontSize: '0.875rem', color: '#666' }}>
                By: <span style={styles.mono}>{event.orgId}</span>
                {event.targetOrgId && (
                  <> → <span style={styles.mono}>{event.targetOrgId}</span></>
                )}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.5rem' }}>
                TX: {event.txId}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Audit Viewer</h1>
      <p style={styles.subtitle}>
        View on-chain audit events from the Hyperledger Fabric blockchain.
        All access, uploads, and shares are immutably recorded.
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

      {/* Stats */}
      <div style={styles.stats}>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{stats.total}</div>
          <div style={styles.statLabel}>Total Events</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statNumber, color: '#28a745' }}>{stats.uploads}</div>
          <div style={styles.statLabel}>Uploads</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statNumber, color: '#007bff' }}>{stats.accesses}</div>
          <div style={styles.statLabel}>Accesses</div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statNumber, color: '#ffc107' }}>{stats.shares}</div>
          <div style={styles.statLabel}>Shares</div>
        </div>
      </div>

      {/* Filters */}
      <div style={styles.filters}>
        <div style={styles.formGroup}>
          <label style={styles.label}>Resource ID</label>
          <input
            type="text"
            style={styles.input}
            value={filters.resourceId}
            onChange={(e) => setFilters({ ...filters, resourceId: e.target.value })}
            placeholder="Filter by resource"
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Organization</label>
          <input
            type="text"
            style={styles.input}
            value={filters.orgId}
            onChange={(e) => setFilters({ ...filters, orgId: e.target.value })}
            placeholder="Filter by org"
          />
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Event Type</label>
          <select
            style={styles.select}
            value={filters.action}
            onChange={(e) => setFilters({ ...filters, action: e.target.value })}
          >
            {EVENT_TYPES.map(type => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </div>
        <div style={styles.formGroup}>
          <label style={styles.label}>Limit</label>
          <select
            style={styles.select}
            value={filters.limit}
            onChange={(e) => setFilters({ ...filters, limit: parseInt(e.target.value) })}
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <button
          style={{ ...styles.button, ...styles.buttonSecondary }}
          onClick={clearFilters}
        >
          Clear
        </button>
        <button
          style={{
            ...styles.button,
            ...(isLoading ? styles.buttonDisabled : {})
          }}
          onClick={loadEvents}
          disabled={isLoading}
        >
          {isLoading ? '⏳ Loading...' : '🔍 Search'}
        </button>
      </div>

      {/* View Toggle */}
      <div style={styles.viewToggle}>
        <button
          style={{
            ...styles.button,
            ...(viewMode !== 'table' ? styles.buttonSecondary : {})
          }}
          onClick={() => setViewMode('table')}
        >
          📊 Table
        </button>
        <button
          style={{
            ...styles.button,
            ...(viewMode !== 'timeline' ? styles.buttonSecondary : {})
          }}
          onClick={() => setViewMode('timeline')}
        >
          📅 Timeline
        </button>
      </div>

      {/* Events */}
      {events.length === 0 ? (
        <div style={styles.empty}>
          <p>📋 No audit events found</p>
          <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
            Adjust filters or wait for blockchain events.
          </p>
        </div>
      ) : (
        viewMode === 'table' ? renderTableView() : renderTimelineView()
      )}

      {/* Blockchain Info */}
      <div style={{ 
        marginTop: '2rem', 
        padding: '1rem', 
        background: '#f8f9fa', 
        borderRadius: '8px',
        fontSize: '0.875rem',
        color: '#666'
      }}>
        <strong>ℹ️ About Audit Events</strong>
        <p style={{ marginTop: '0.5rem' }}>
          All events are recorded on the Hyperledger Fabric blockchain and are immutable.
          Each transaction ID (TX) can be verified on the blockchain explorer.
          Events include upload, access, grant, revoke, and share actions.
        </p>
        <p style={{ marginTop: '0.5rem' }}>
          Reference: <a 
            href="https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html#handling-events" 
            target="_blank" 
            rel="noopener noreferrer"
          >
            Hyperledger Fabric Events Documentation
          </a>
        </p>
      </div>
    </div>
  );
}

export default AuditViewer;
