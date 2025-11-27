/**
 * Hospital Upload Page
 * 
 * Upload FHIR JSON and optional image files to the decentralized health database.
 * Files are encrypted and uploaded to IPFS via the backend.
 * 
 * Features:
 * - FHIR JSON input (paste or file upload)
 * - Optional image/document attachment
 * - Patient ID and resource type specification
 * - Upload progress and result display
 * - Success/error banners
 * 
 * Backend endpoint: POST /upload
 * Per backend/src/routes/upload.js
 */

import React, { useState, useRef } from 'react';
import { uploadFile, getUploadInfo, ApiError } from '../services/api';
import { formatSize } from '../services/ipfs';

// Minimal inline styles
const styles = {
  container: {
    maxWidth: '800px',
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
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem'
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  label: {
    fontWeight: '600',
    color: '#333'
  },
  required: {
    color: '#e53e3e'
  },
  input: {
    padding: '0.75rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '1rem',
    transition: 'border-color 0.2s'
  },
  select: {
    padding: '0.75rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '1rem',
    background: 'white'
  },
  textarea: {
    padding: '0.75rem',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '0.9rem',
    fontFamily: 'monospace',
    minHeight: '200px',
    resize: 'vertical'
  },
  fileInput: {
    padding: '0.75rem',
    border: '2px dashed #ddd',
    borderRadius: '4px',
    background: '#fafafa',
    cursor: 'pointer',
    textAlign: 'center'
  },
  fileInputActive: {
    borderColor: '#1a73e8',
    background: '#e8f0fe'
  },
  button: {
    padding: '1rem 2rem',
    background: '#1a73e8',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background 0.2s'
  },
  buttonDisabled: {
    background: '#ccc',
    cursor: 'not-allowed'
  },
  row: {
    display: 'flex',
    gap: '1rem'
  },
  col: {
    flex: 1
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
  result: {
    background: '#f8f9fa',
    border: '1px solid #e9ecef',
    borderRadius: '4px',
    padding: '1rem',
    marginTop: '1rem'
  },
  resultTitle: {
    fontWeight: '600',
    marginBottom: '0.5rem'
  },
  resultItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '0.5rem 0',
    borderBottom: '1px solid #eee'
  },
  resultLabel: {
    color: '#666'
  },
  resultValue: {
    fontFamily: 'monospace',
    wordBreak: 'break-all'
  },
  hint: {
    fontSize: '0.875rem',
    color: '#666'
  },
  fileInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem',
    background: '#e8f0fe',
    borderRadius: '4px',
    marginTop: '0.5rem'
  },
  clearButton: {
    background: 'none',
    border: 'none',
    color: '#1a73e8',
    cursor: 'pointer',
    padding: '0.25rem'
  }
};

// FHIR resource types
const FHIR_RESOURCE_TYPES = [
  'Patient',
  'Observation',
  'DiagnosticReport',
  'ImagingStudy',
  'Condition',
  'MedicationRequest',
  'Procedure',
  'AllergyIntolerance',
  'Immunization',
  'CarePlan',
  'DocumentReference',
  'Binary'
];

// Sample FHIR JSON for demo
const SAMPLE_FHIR = {
  resourceType: 'Observation',
  id: 'blood-pressure-001',
  status: 'final',
  category: [{
    coding: [{
      system: 'http://terminology.hl7.org/CodeSystem/observation-category',
      code: 'vital-signs',
      display: 'Vital Signs'
    }]
  }],
  code: {
    coding: [{
      system: 'http://loinc.org',
      code: '85354-9',
      display: 'Blood pressure panel'
    }]
  },
  subject: {
    reference: 'Patient/patient-demo-001'
  },
  effectiveDateTime: new Date().toISOString(),
  component: [
    {
      code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic BP' }] },
      valueQuantity: { value: 120, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' }
    },
    {
      code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic BP' }] },
      valueQuantity: { value: 80, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' }
    }
  ]
};

function HospitalUpload() {
  // Form state
  const [patientId, setPatientId] = useState('patient-demo-001');
  const [resourceType, setResourceType] = useState('Observation');
  const [fhirJson, setFhirJson] = useState(JSON.stringify(SAMPLE_FHIR, null, 2));
  const [selectedFile, setSelectedFile] = useState(null);
  const [orgId, setOrgId] = useState('hospital-org1');
  
  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [banner, setBanner] = useState(null); // { type: 'success'|'error', message }
  const [result, setResult] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  
  const fileInputRef = useRef(null);

  // Handle file selection
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Handle drag and drop
  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  // Clear selected file
  const clearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Load sample FHIR JSON
  const loadSample = () => {
    const sample = { ...SAMPLE_FHIR };
    sample.subject.reference = `Patient/${patientId}`;
    sample.id = `${resourceType.toLowerCase()}-${Date.now()}`;
    sample.resourceType = resourceType;
    setFhirJson(JSON.stringify(sample, null, 2));
    setBanner({ type: 'success', message: 'Sample FHIR JSON loaded. Modify as needed.' });
    setTimeout(() => setBanner(null), 3000);
  };

  // Validate FHIR JSON
  const validateFhirJson = () => {
    try {
      const parsed = JSON.parse(fhirJson);
      if (!parsed.resourceType) {
        return { valid: false, error: 'FHIR JSON must include "resourceType"' };
      }
      return { valid: true, data: parsed };
    } catch (e) {
      return { valid: false, error: `Invalid JSON: ${e.message}` };
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setBanner(null);
    setResult(null);

    // Validate FHIR JSON
    const validation = validateFhirJson();
    if (!validation.valid) {
      setBanner({ type: 'error', message: validation.error });
      return;
    }

    // Prepare FHIR metadata
    const fhirMeta = {
      ...validation.data,
      patientId: patientId,
      resourceType: resourceType
    };

    // Create file to upload (FHIR JSON or selected file)
    let fileToUpload;
    if (selectedFile) {
      // If there's an attached file (image, PDF), upload that
      fileToUpload = selectedFile;
      // Include FHIR reference in metadata
      fhirMeta.attachmentFilename = selectedFile.name;
      fhirMeta.attachmentSize = selectedFile.size;
    } else {
      // Otherwise, upload the FHIR JSON itself
      const fhirBlob = new Blob([fhirJson], { type: 'application/fhir+json' });
      fileToUpload = new File([fhirBlob], `${resourceType}-${Date.now()}.json`, {
        type: 'application/fhir+json'
      });
    }

    setIsLoading(true);

    try {
      const response = await uploadFile(fileToUpload, fhirMeta, { orgId });
      
      setResult(response);
      setBanner({ 
        type: 'success', 
        message: `Successfully uploaded ${resourceType} to IPFS! CID: ${response.cid}` 
      });
    } catch (error) {
      console.error('Upload failed:', error);
      setBanner({ 
        type: 'error', 
        message: error instanceof ApiError 
          ? `Upload failed: ${error.message}` 
          : `Network error: ${error.message}`
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Hospital Upload</h1>
      <p style={styles.subtitle}>
        Upload FHIR resources and medical documents to the decentralized health database.
        Files are encrypted with AES-256-GCM before storage on IPFS.
      </p>

      {/* Banner */}
      {banner && (
        <div style={{
          ...styles.banner,
          ...(banner.type === 'success' ? styles.bannerSuccess : styles.bannerError)
        }}>
          {banner.message}
        </div>
      )}

      <form onSubmit={handleSubmit} style={styles.form}>
        {/* Row: Patient ID and Org ID */}
        <div style={styles.row}>
          <div style={{ ...styles.formGroup, ...styles.col }}>
            <label style={styles.label}>
              Patient ID <span style={styles.required}>*</span>
            </label>
            <input
              type="text"
              style={styles.input}
              value={patientId}
              onChange={(e) => setPatientId(e.target.value)}
              placeholder="e.g., patient-demo-001"
              required
            />
          </div>
          <div style={{ ...styles.formGroup, ...styles.col }}>
            <label style={styles.label}>
              Organization ID <span style={styles.required}>*</span>
            </label>
            <input
              type="text"
              style={styles.input}
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="e.g., hospital-org1"
              required
            />
          </div>
        </div>

        {/* Resource Type */}
        <div style={styles.formGroup}>
          <label style={styles.label}>
            FHIR Resource Type <span style={styles.required}>*</span>
          </label>
          <select
            style={styles.select}
            value={resourceType}
            onChange={(e) => setResourceType(e.target.value)}
          >
            {FHIR_RESOURCE_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        {/* FHIR JSON */}
        <div style={styles.formGroup}>
          <label style={styles.label}>
            FHIR JSON <span style={styles.required}>*</span>
            <button 
              type="button" 
              onClick={loadSample}
              style={{ 
                ...styles.clearButton, 
                marginLeft: '1rem',
                fontSize: '0.875rem'
              }}
            >
              Load Sample
            </button>
          </label>
          <textarea
            style={styles.textarea}
            value={fhirJson}
            onChange={(e) => setFhirJson(e.target.value)}
            placeholder='{"resourceType": "Observation", ...}'
            required
          />
          <p style={styles.hint}>
            Enter valid FHIR R4 JSON. The resourceType, id, and patientId fields are used for metadata.
          </p>
        </div>

        {/* File Attachment */}
        <div style={styles.formGroup}>
          <label style={styles.label}>
            Attachment (Optional)
          </label>
          <div
            style={{
              ...styles.fileInput,
              ...(dragActive ? styles.fileInputActive : {})
            }}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              accept="image/*,.pdf,.dicom"
            />
            <p>📎 Drag and drop a file here, or click to select</p>
            <p style={styles.hint}>
              Supported: Images (JPEG, PNG), PDF, DICOM
            </p>
          </div>
          
          {selectedFile && (
            <div style={styles.fileInfo}>
              <span>📄 {selectedFile.name}</span>
              <span style={styles.hint}>({formatSize(selectedFile.size)})</span>
              <button 
                type="button" 
                onClick={clearFile}
                style={styles.clearButton}
              >
                ✕ Remove
              </button>
            </div>
          )}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          style={{
            ...styles.button,
            ...(isLoading ? styles.buttonDisabled : {})
          }}
          disabled={isLoading}
        >
          {isLoading ? '⏳ Uploading...' : '🚀 Upload to IPFS'}
        </button>
      </form>

      {/* Result Display */}
      {result && (
        <div style={styles.result}>
          <div style={styles.resultTitle}>✅ Upload Successful</div>
          
          <div style={styles.resultItem}>
            <span style={styles.resultLabel}>IPFS CID:</span>
            <span style={styles.resultValue}>{result.cid}</span>
          </div>
          
          <div style={styles.resultItem}>
            <span style={styles.resultLabel}>SHA-256:</span>
            <span style={styles.resultValue}>{result.sha256}</span>
          </div>
          
          <div style={styles.resultItem}>
            <span style={styles.resultLabel}>FHIR Type:</span>
            <span style={styles.resultValue}>{result.fhirType}</span>
          </div>
          
          <div style={styles.resultItem}>
            <span style={styles.resultLabel}>FHIR ID:</span>
            <span style={styles.resultValue}>{result.fhirId}</span>
          </div>
          
          <div style={styles.resultItem}>
            <span style={styles.resultLabel}>Storage Backend:</span>
            <span style={styles.resultValue}>{result.backend}</span>
          </div>
          
          <div style={styles.resultItem}>
            <span style={styles.resultLabel}>File Size:</span>
            <span style={styles.resultValue}>
              Original: {formatSize(result.fileSize?.original || 0)} → 
              Encrypted: {formatSize(result.fileSize?.encrypted || 0)}
            </span>
          </div>
          
          {result.chaincode && (
            <div style={styles.resultItem}>
              <span style={styles.resultLabel}>Chaincode:</span>
              <span style={styles.resultValue}>
                {result.chaincode.success !== false ? '✅ Recorded on-chain' : '⚠️ Stub mode'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default HospitalUpload;
