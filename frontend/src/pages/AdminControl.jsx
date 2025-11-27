/**
 * Admin Control Page - Attack Simulation & Org Revocation
 * 
 * Provides administrative controls for:
 * - Simulating compromised nodes (attacker toggle)
 * - Revoking organization access via chaincode
 * - Viewing revoked orgs and attack state
 * - Testing access denial flow
 * 
 * Backend endpoints:
 * - GET  /simulate-attack        - Get current attack state
 * - POST /simulate-attack        - Toggle attack for node/org
 * - POST /simulate-attack/revoke-org - Revoke org via chaincode
 * - POST /simulate-attack/reinstate-org - Reinstate revoked org
 * 
 * References:
 * - Hyperledger Fabric Access Control: https://hyperledger-fabric.readthedocs.io/en/release-2.2/access_control.html
 * - Chaincode Events: https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html#handling-events
 */

import React, { useState, useEffect, useCallback } from 'react';

// API Base URL - uses Vite proxy in dev
const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Inline styles
const styles = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '1rem'
  },
  title: {
    fontSize: '1.75rem',
    marginBottom: '0.5rem',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  subtitle: {
    color: '#666',
    marginBottom: '2rem'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
    gap: '1.5rem',
    marginBottom: '2rem'
  },
  card: {
    background: 'white',
    borderRadius: '8px',
    padding: '1.5rem',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
    border: '1px solid #e0e0e0'
  },
  cardTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    marginBottom: '1rem',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  cardDanger: {
    borderColor: '#dc3545',
    borderWidth: '2px'
  },
  formGroup: {
    marginBottom: '1rem'
  },
  label: {
    display: 'block',
    fontWeight: '600',
    color: '#333',
    fontSize: '0.875rem',
    marginBottom: '0.5rem'
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '1rem',
    boxSizing: 'border-box'
  },
  select: {
    width: '100%',
    padding: '0.75rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '1rem',
    background: 'white',
    boxSizing: 'border-box'
  },
  button: {
    padding: '0.75rem 1.5rem',
    border: 'none',
    borderRadius: '4px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'all 0.2s'
  },
  buttonPrimary: {
    background: '#1a73e8',
    color: 'white'
  },
  buttonDanger: {
    background: '#dc3545',
    color: 'white'
  },
  buttonSuccess: {
    background: '#28a745',
    color: 'white'
  },
  buttonWarning: {
    background: '#ffc107',
    color: '#333'
  },
  buttonSecondary: {
    background: '#6c757d',
    color: 'white'
  },
  buttonDisabled: {
    background: '#ccc',
    cursor: 'not-allowed'
  },
  buttonGroup: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  alert: {
    padding: '1rem',
    borderRadius: '4px',
    marginBottom: '1rem'
  },
  alertSuccess: {
    background: '#d4edda',
    border: '1px solid #c3e6cb',
    color: '#155724'
  },
  alertError: {
    background: '#f8d7da',
    border: '1px solid #f5c6cb',
    color: '#721c24'
  },
  alertWarning: {
    background: '#fff3cd',
    border: '1px solid #ffeeba',
    color: '#856404'
  },
  alertInfo: {
    background: '#cce5ff',
    border: '1px solid #b8daff',
    color: '#004085'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '1rem'
  },
  th: {
    padding: '0.75rem',
    textAlign: 'left',
    background: '#f8f9fa',
    borderBottom: '2px solid #dee2e6',
    fontWeight: '600',
    fontSize: '0.875rem'
  },
  td: {
    padding: '0.75rem',
    borderBottom: '1px solid #dee2e6',
    fontSize: '0.9rem'
  },
  badge: {
    display: 'inline-block',
    padding: '0.25rem 0.75rem',
    borderRadius: '4px',
    fontSize: '0.75rem',
    fontWeight: '600'
  },
  badgeActive: {
    background: '#dc3545',
    color: 'white'
  },
  badgeInactive: {
    background: '#28a745',
    color: 'white'
  },
  mono: {
    fontFamily: 'monospace',
    fontSize: '0.875rem'
  },
  logs: {
    background: '#1e1e1e',
    color: '#d4d4d4',
    padding: '1rem',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '0.8rem',
    maxHeight: '300px',
    overflow: 'auto',
    whiteSpace: 'pre-wrap'
  },
  logEntry: {
    marginBottom: '0.25rem'
  },
  logTime: {
    color: '#888'
  },
  logSuccess: {
    color: '#4ec9b0'
  },
  logError: {
    color: '#f14c4c'
  },
  logWarning: {
    color: '#cca700'
  },
  testSection: {
    marginTop: '1.5rem',
    padding: '1rem',
    background: '#f8f9fa',
    borderRadius: '8px'
  },
  testResult: {
    padding: '1rem',
    borderRadius: '4px',
    marginTop: '1rem',
    fontFamily: 'monospace',
    fontSize: '0.875rem',
    whiteSpace: 'pre-wrap'
  }
};

// Attack types
const ATTACK_TYPES = [
  { value: 'revoked', label: 'Revoked Access', description: 'Org access has been revoked' },
  { value: 'compromised', label: 'Compromised Node', description: 'Node is marked as compromised' },
  { value: 'expired', label: 'Expired Credentials', description: 'Credentials have expired' },
  { value: 'unauthorized', label: 'Unauthorized', description: 'No valid access grant' }
];

function AdminControl() {
  // State
  const [attackState, setAttackState] = useState({ attacks: [], revokedOrgs: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [alert, setAlert] = useState(null);
  const [logs, setLogs] = useState([]);

  // Form state for attack toggle
  const [toggleForm, setToggleForm] = useState({
    orgId: '',
    nodeId: '',
    attackType: 'revoked',
    active: true
  });

  // Form state for org revoke
  const [revokeForm, setRevokeForm] = useState({
    orgId: '',
    reason: 'Security breach detected'
  });

  // Form state for access test
  const [testForm, setTestForm] = useState({
    resourceId: '',
    orgId: ''
  });
  const [testResult, setTestResult] = useState(null);

  // Add log entry
  const addLog = useCallback((message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }].slice(-50));
  }, []);

  // Fetch current attack state
  const fetchAttackState = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/simulate-attack`);
      if (response.ok) {
        const data = await response.json();
        setAttackState(data);
        addLog(`Fetched attack state: ${data.attacks.length} active, ${data.revokedOrgs.length} revoked`, 'success');
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      addLog(`Failed to fetch attack state: ${error.message}`, 'error');
      // Use mock state for demo
      setAttackState({ attacks: [], revokedOrgs: [] });
    }
  }, [addLog]);

  // Load state on mount
  useEffect(() => {
    fetchAttackState();
  }, [fetchAttackState]);

  // Toggle attack simulation
  const handleToggleAttack = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setAlert(null);

    try {
      const response = await fetch(`${API_BASE_URL}/simulate-attack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toggleForm)
      });

      const data = await response.json();

      if (response.ok) {
        setAlert({
          type: 'success',
          message: data.message || `Attack ${toggleForm.active ? 'activated' : 'deactivated'} for ${toggleForm.orgId}`
        });
        addLog(`Attack toggled: ${toggleForm.orgId} -> ${toggleForm.active ? 'ACTIVE' : 'INACTIVE'}`, 'success');
        fetchAttackState();
      } else {
        throw new Error(data.message || data.error || 'Toggle failed');
      }
    } catch (error) {
      setAlert({ type: 'error', message: error.message });
      addLog(`Toggle failed: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Revoke organization via chaincode
  const handleRevokeOrg = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setAlert(null);

    try {
      const response = await fetch(`${API_BASE_URL}/simulate-attack/revoke-org`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(revokeForm)
      });

      const data = await response.json();

      if (response.ok) {
        setAlert({
          type: 'success',
          message: `Organization ${revokeForm.orgId} revoked via chaincode. TX: ${data.txId?.substring(0, 16)}...`
        });
        addLog(`Org revoked via chaincode: ${revokeForm.orgId}`, 'success');
        addLog(`Transaction ID: ${data.txId}`, 'info');
        fetchAttackState();
      } else {
        throw new Error(data.message || data.error || 'Revoke failed');
      }
    } catch (error) {
      setAlert({ type: 'error', message: error.message });
      addLog(`Revoke failed: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Reinstate organization
  const handleReinstateOrg = async (orgId) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/simulate-attack/reinstate-org`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId })
      });

      const data = await response.json();

      if (response.ok) {
        setAlert({ type: 'success', message: `Organization ${orgId} reinstated` });
        addLog(`Org reinstated: ${orgId}`, 'success');
        fetchAttackState();
      } else {
        throw new Error(data.message || 'Reinstate failed');
      }
    } catch (error) {
      setAlert({ type: 'error', message: error.message });
      addLog(`Reinstate failed: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Test access as attacker
  const handleTestAccess = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setTestResult(null);

    try {
      addLog(`Testing access: ${testForm.orgId} -> ${testForm.resourceId}`, 'info');

      const response = await fetch(`${API_BASE_URL}/resource/${testForm.resourceId}`, {
        method: 'GET',
        headers: {
          'x-org-id': testForm.orgId,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();

      if (response.status === 403) {
        setTestResult({
          success: false,
          status: 403,
          message: 'ACCESS DENIED - Attack simulation working correctly!',
          data
        });
        addLog(`Access DENIED (403): ${testForm.orgId} blocked from ${testForm.resourceId}`, 'success');
      } else if (response.ok) {
        setTestResult({
          success: true,
          status: 200,
          message: 'ACCESS GRANTED - Org has valid access',
          data: { resourceType: data.resourceType, id: data.id }
        });
        addLog(`Access GRANTED (200): ${testForm.orgId} accessed ${testForm.resourceId}`, 'warning');
      } else {
        setTestResult({
          success: false,
          status: response.status,
          message: `Error: ${data.error || data.message}`,
          data
        });
        addLog(`Access error (${response.status}): ${data.error}`, 'error');
      }
    } catch (error) {
      setTestResult({
        success: false,
        status: 0,
        message: `Network error: ${error.message}`,
        data: null
      });
      addLog(`Test failed: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Clear all attacks
  const handleClearAll = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/simulate-attack`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (response.ok) {
        setAlert({ type: 'success', message: `Cleared ${data.clearedCount} attack simulations` });
        addLog(`Cleared all attack simulations`, 'success');
        fetchAttackState();
      } else {
        throw new Error(data.message || 'Clear failed');
      }
    } catch (error) {
      setAlert({ type: 'error', message: error.message });
      addLog(`Clear failed: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>
        ⚠️ Admin Control Panel
      </h1>
      <p style={styles.subtitle}>
        Attack simulation and organization revocation controls for testing access denial flows.
        <br />
        <strong>WARNING:</strong> These controls affect system security behavior.
      </p>

      {/* Alert */}
      {alert && (
        <div style={{
          ...styles.alert,
          ...(alert.type === 'success' ? styles.alertSuccess :
              alert.type === 'error' ? styles.alertError :
              alert.type === 'warning' ? styles.alertWarning : styles.alertInfo)
        }}>
          {alert.message}
          <button
            onClick={() => setAlert(null)}
            style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={styles.grid}>
        {/* Attack Toggle Card */}
        <div style={{ ...styles.card, ...styles.cardDanger }}>
          <h2 style={styles.cardTitle}>🔴 Attack Toggle</h2>
          <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9rem' }}>
            Toggle attack simulation for a node/organization.
            When active, access requests from this org will be denied.
          </p>

          <form onSubmit={handleToggleAttack}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Organization ID *</label>
              <input
                type="text"
                style={styles.input}
                value={toggleForm.orgId}
                onChange={(e) => setToggleForm({ ...toggleForm, orgId: e.target.value })}
                placeholder="e.g., attacker-org"
                required
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Node ID (optional)</label>
              <input
                type="text"
                style={styles.input}
                value={toggleForm.nodeId}
                onChange={(e) => setToggleForm({ ...toggleForm, nodeId: e.target.value })}
                placeholder="e.g., node-1"
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Attack Type</label>
              <select
                style={styles.select}
                value={toggleForm.attackType}
                onChange={(e) => setToggleForm({ ...toggleForm, attackType: e.target.value })}
              >
                {ATTACK_TYPES.map(type => (
                  <option key={type.value} value={type.value}>
                    {type.label} - {type.description}
                  </option>
                ))}
              </select>
            </div>

            <div style={styles.formGroup}>
              <label style={{ ...styles.label, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  checked={toggleForm.active}
                  onChange={(e) => setToggleForm({ ...toggleForm, active: e.target.checked })}
                />
                Attack Active
              </label>
            </div>

            <div style={styles.buttonGroup}>
              <button
                type="submit"
                style={{
                  ...styles.button,
                  ...(toggleForm.active ? styles.buttonDanger : styles.buttonSuccess),
                  ...(isLoading ? styles.buttonDisabled : {})
                }}
                disabled={isLoading}
              >
                {toggleForm.active ? '🔴 Activate Attack' : '🟢 Deactivate Attack'}
              </button>
            </div>
          </form>
        </div>

        {/* Revoke Org Card */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>🚫 Revoke Organization</h2>
          <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9rem' }}>
            Revoke an organization's access via chaincode.
            This creates an immutable revocation record on the blockchain.
          </p>

          <form onSubmit={handleRevokeOrg}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Organization ID *</label>
              <input
                type="text"
                style={styles.input}
                value={revokeForm.orgId}
                onChange={(e) => setRevokeForm({ ...revokeForm, orgId: e.target.value })}
                placeholder="e.g., org2"
                required
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Reason</label>
              <input
                type="text"
                style={styles.input}
                value={revokeForm.reason}
                onChange={(e) => setRevokeForm({ ...revokeForm, reason: e.target.value })}
                placeholder="Security breach detected"
              />
            </div>

            <div style={styles.buttonGroup}>
              <button
                type="submit"
                style={{
                  ...styles.button,
                  ...styles.buttonWarning,
                  ...(isLoading ? styles.buttonDisabled : {})
                }}
                disabled={isLoading}
              >
                ⛔ Revoke via Chaincode
              </button>
            </div>
          </form>

          <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#666' }}>
            <strong>Reference:</strong>{' '}
            <a
              href="https://hyperledger-fabric.readthedocs.io/en/release-2.2/chaincode4ade.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              Hyperledger Fabric Chaincode
            </a>
          </div>
        </div>

        {/* Test Access Card */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>🧪 Test Access Denial</h2>
          <p style={{ color: '#666', marginBottom: '1rem', fontSize: '0.9rem' }}>
            Test access as a revoked/attacker organization.
            Should receive 403 Forbidden if attack is active.
          </p>

          <form onSubmit={handleTestAccess}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Resource ID *</label>
              <input
                type="text"
                style={styles.input}
                value={testForm.resourceId}
                onChange={(e) => setTestForm({ ...testForm, resourceId: e.target.value })}
                placeholder="e.g., obs-test-123"
                required
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>Organization ID (Attacker) *</label>
              <input
                type="text"
                style={styles.input}
                value={testForm.orgId}
                onChange={(e) => setTestForm({ ...testForm, orgId: e.target.value })}
                placeholder="e.g., attacker-org"
                required
              />
            </div>

            <div style={styles.buttonGroup}>
              <button
                type="submit"
                style={{
                  ...styles.button,
                  ...styles.buttonPrimary,
                  ...(isLoading ? styles.buttonDisabled : {})
                }}
                disabled={isLoading}
              >
                🔍 Test Access
              </button>
            </div>
          </form>

          {testResult && (
            <div style={{
              ...styles.testResult,
              background: testResult.status === 403 ? '#d4edda' : 
                         testResult.status === 200 ? '#fff3cd' : '#f8d7da',
              color: testResult.status === 403 ? '#155724' :
                     testResult.status === 200 ? '#856404' : '#721c24'
            }}>
              <strong>Status: {testResult.status}</strong>
              <br />
              {testResult.message}
              {testResult.data && (
                <>
                  <br /><br />
                  Response: {JSON.stringify(testResult.data, null, 2)}
                </>
              )}
            </div>
          )}
        </div>

        {/* Active Attacks Table */}
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>📋 Active Attack Simulations</h2>
          
          <div style={styles.buttonGroup}>
            <button
              onClick={fetchAttackState}
              style={{ ...styles.button, ...styles.buttonSecondary }}
              disabled={isLoading}
            >
              🔄 Refresh
            </button>
            <button
              onClick={handleClearAll}
              style={{ ...styles.button, ...styles.buttonDanger }}
              disabled={isLoading}
            >
              🗑️ Clear All
            </button>
          </div>

          {attackState.attacks.length === 0 && attackState.revokedOrgs.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#666', marginTop: '1rem' }}>
              No active attack simulations
            </p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Org ID</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {attackState.attacks.map((attack) => (
                  <tr key={attack.id || attack.orgId}>
                    <td style={styles.td}>
                      <span style={styles.mono}>{attack.orgId}</span>
                    </td>
                    <td style={styles.td}>{attack.attackType}</td>
                    <td style={styles.td}>
                      <span style={{
                        ...styles.badge,
                        ...(attack.active ? styles.badgeActive : styles.badgeInactive)
                      }}>
                        {attack.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <button
                        onClick={() => handleReinstateOrg(attack.orgId)}
                        style={{ ...styles.button, ...styles.buttonSuccess, padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                        disabled={isLoading}
                      >
                        Reinstate
                      </button>
                    </td>
                  </tr>
                ))}
                {attackState.revokedOrgs
                  .filter(org => !attackState.attacks.find(a => a.orgId === org))
                  .map((orgId) => (
                    <tr key={`revoked-${orgId}`}>
                      <td style={styles.td}>
                        <span style={styles.mono}>{orgId}</span>
                      </td>
                      <td style={styles.td}>revoked</td>
                      <td style={styles.td}>
                        <span style={{ ...styles.badge, ...styles.badgeActive }}>
                          REVOKED
                        </span>
                      </td>
                      <td style={styles.td}>
                        <button
                          onClick={() => handleReinstateOrg(orgId)}
                          style={{ ...styles.button, ...styles.buttonSuccess, padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                          disabled={isLoading}
                        >
                          Reinstate
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Activity Log */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>📝 Activity Log</h2>
        <div style={styles.logs}>
          {logs.length === 0 ? (
            <span style={{ color: '#888' }}>No activity yet...</span>
          ) : (
            logs.slice().reverse().map((log, i) => (
              <div key={i} style={styles.logEntry}>
                <span style={styles.logTime}>[{log.timestamp}]</span>{' '}
                <span style={
                  log.type === 'success' ? styles.logSuccess :
                  log.type === 'error' ? styles.logError :
                  log.type === 'warning' ? styles.logWarning : {}
                }>
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Documentation */}
      <div style={{ marginTop: '2rem', padding: '1rem', background: '#f8f9fa', borderRadius: '8px', fontSize: '0.875rem' }}>
        <h3>📚 How Attack Simulation Works</h3>
        <ol style={{ marginLeft: '1.5rem', lineHeight: '1.8' }}>
          <li>
            <strong>Toggle Attack:</strong> Sets in-memory state marking an org as "under attack".
            The resource endpoint checks this state before granting access.
          </li>
          <li>
            <strong>Revoke Org:</strong> Calls <code>chaincode.revokeOrg(orgId)</code> to create
            an immutable revocation record on the Hyperledger Fabric blockchain.
          </li>
          <li>
            <strong>Access Denial:</strong> When a revoked org attempts <code>GET /resource/:id</code>,
            the system returns <code>403 Forbidden</code> and logs a <code>DENIED</code> event to the blockchain.
          </li>
          <li>
            <strong>Audit Log:</strong> All denied access attempts are recorded via
            <code>chaincode.logAccess(resourceId, orgId, 'DENIED', timestamp)</code>.
          </li>
        </ol>
        
        <p style={{ marginTop: '1rem' }}>
          <strong>References:</strong>
        </p>
        <ul style={{ marginLeft: '1.5rem' }}>
          <li>
            <a href="https://hyperledger-fabric.readthedocs.io/en/release-2.2/chaincode4ade.html" target="_blank" rel="noopener noreferrer">
              Hyperledger Fabric Chaincode Developer Guide
            </a>
          </li>
          <li>
            <a href="https://hyperledger-fabric.readthedocs.io/en/release-2.2/developapps/application.html" target="_blank" rel="noopener noreferrer">
              Fabric Application Development
            </a>
          </li>
        </ul>
      </div>
    </div>
  );
}

export default AdminControl;
