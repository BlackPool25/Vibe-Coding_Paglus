/**
 * Main Application Component with Routing
 * 
 * Three pages:
 * - HospitalUpload: Upload FHIR JSON and optional image
 * - PatientPortal: List resources, request/create shares
 * - AuditViewer: Show on-chain audit events
 * 
 * References:
 * - React Router: https://reactrouter.com/en/main/start/tutorial
 */

import React from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';

import HospitalUpload from './pages/HospitalUpload';
import PatientPortal from './pages/PatientPortal';
import AuditViewer from './pages/AuditViewer';

// Minimal inline styles (no CSS framework)
const styles = {
  app: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column'
  },
  header: {
    background: '#1a73e8',
    color: 'white',
    padding: '1rem 2rem',
    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
  },
  headerContent: {
    maxWidth: '1200px',
    margin: '0 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '1rem'
  },
  logo: {
    fontSize: '1.5rem',
    fontWeight: 'bold',
    textDecoration: 'none',
    color: 'white'
  },
  nav: {
    display: 'flex',
    gap: '1.5rem'
  },
  navLink: {
    color: 'rgba(255,255,255,0.8)',
    textDecoration: 'none',
    padding: '0.5rem 0',
    borderBottom: '2px solid transparent',
    transition: 'all 0.2s'
  },
  navLinkActive: {
    color: 'white',
    borderBottom: '2px solid white'
  },
  main: {
    flex: 1,
    padding: '2rem',
    maxWidth: '1200px',
    margin: '0 auto',
    width: '100%'
  },
  footer: {
    background: '#333',
    color: '#aaa',
    padding: '1rem 2rem',
    textAlign: 'center',
    fontSize: '0.875rem'
  }
};

function App() {
  return (
    <div style={styles.app}>
      {/* Header with Navigation */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <span style={styles.logo}>🏥 Decen-Health-DB</span>
          <nav style={styles.nav}>
            <NavLink 
              to="/upload" 
              style={({ isActive }) => ({
                ...styles.navLink,
                ...(isActive ? styles.navLinkActive : {})
              })}
            >
              Hospital Upload
            </NavLink>
            <NavLink 
              to="/patient" 
              style={({ isActive }) => ({
                ...styles.navLink,
                ...(isActive ? styles.navLinkActive : {})
              })}
            >
              Patient Portal
            </NavLink>
            <NavLink 
              to="/audit" 
              style={({ isActive }) => ({
                ...styles.navLink,
                ...(isActive ? styles.navLinkActive : {})
              })}
            >
              Audit Viewer
            </NavLink>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        <Routes>
          <Route path="/" element={<HospitalUpload />} />
          <Route path="/upload" element={<HospitalUpload />} />
          <Route path="/patient" element={<PatientPortal />} />
          <Route path="/audit" element={<AuditViewer />} />
        </Routes>
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <p>
          Decentralized Health DB • Hyperledger Fabric • IPFS • HashiCorp Vault
        </p>
      </footer>
    </div>
  );
}

export default App;
