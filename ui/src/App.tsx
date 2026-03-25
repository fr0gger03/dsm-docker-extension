import { useState, useEffect } from 'react';
import { createDockerDesktopClient } from '@docker/extension-api-client';

// Initialize the Docker Desktop Extension Client
const ddClient = createDockerDesktopClient();

export default function App() {
  const [kubeconfig, setKubeconfig] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  
  // Form State
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [policies, setPolicies] = useState<string[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState('');
  const [engine, setEngine] = useState('postgres');
  const [dbName, setDbName] = useState('');
  
  // UI State
  const [status, setStatus] = useState('');

  // 1. Connect and Fetch Namespaces
  const handleConnect = async () => {
    setStatus('Connecting and validating RBAC...');
    try {
      await ddClient.extension.vm?.service?.request({
        url: '/api/connect',
        method: 'POST',
        headers: {},
        data: { kubeconfig_yaml: kubeconfig }
      });
      setIsConnected(true);
      setStatus('Connected! Fetching namespaces...');
      fetchNamespaces();
    } catch (error: any) {
      setStatus(`Connection Failed: ${error.message}`);
    }
  };

  const fetchNamespaces = async () => {
    try {
      const res = await ddClient.extension.vm?.service?.request({
        url: '/api/namespaces',
        method: 'GET',
        headers: {},
        data: {}
      });
      // @ts-ignore - bypassing strict type checking for the custom response
      setNamespaces(res?.namespaces || []);
      setStatus('Ready.');
    } catch (error: any) {
      setStatus(`Failed to load namespaces: ${error.message}`);
    }
  };

  // 2. Fetch Policies dynamically when a namespace is selected
  useEffect(() => {
    if (!selectedNamespace) return;
    
    const fetchPolicies = async () => {
      setStatus(`Fetching policies for ${selectedNamespace}...`);
      try {
        const res = await ddClient.extension.vm?.service?.request({
          url: `/api/policies/${selectedNamespace}`,
          method: 'GET',
          headers: {},
          data: {}
        });
        // @ts-ignore
        setPolicies(res?.policies || []);
        setStatus('Ready.');
      } catch (error: any) {
        setStatus(`Failed to load policies: ${error.message}`);
      }
    };
    
    fetchPolicies();
  }, [selectedNamespace]);

  // 3. Provision the Database
  const handleProvision = async () => {
    setStatus('Provisioning Database...');
    try {
      const res = await ddClient.extension.vm?.service?.request({
        url: '/api/provision',
        method: 'POST',
        headers: {},
        data: {
          namespace: selectedNamespace,
          db_name: dbName,
          engine: engine,
          policy: selectedPolicy
        }
      });
      // @ts-ignore
      setStatus(`Success: ${res?.message}. Check your cluster!`);
    } catch (error: any) {
      setStatus(`Provisioning Failed: ${error.message}`);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>VMware Data Services Manager</h1>
      
      {!isConnected ? (
        <div>
          <h3>Step 1: Authenticate</h3>
          <p>Paste your DSM Kubeconfig YAML below. Entitlements are automatically enforced.</p>
          <textarea 
            rows={10} 
            style={{ width: '100%', marginBottom: '10px', fontFamily: 'monospace' }}
            placeholder="apiVersion: v1..."
            value={kubeconfig}
            onChange={(e) => setKubeconfig(e.target.value)}
          />
          <button onClick={handleConnect}>Connect via Kubeconfig</button>
        </div>
      ) : (
        <div>
          <h3>Step 2: Provision Database</h3>
          
          <div style={{ marginBottom: '10px' }}>
            <label>Namespace: </label>
            <select onChange={(e) => setSelectedNamespace(e.target.value)} value={selectedNamespace}>
              <option value="">-- Select a Namespace --</option>
              {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label>Engine: </label>
            <select onChange={(e) => setEngine(e.target.value)} value={engine}>
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
            </select>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label>Data Service Policy: </label>
            <select onChange={(e) => setSelectedPolicy(e.target.value)} value={selectedPolicy} disabled={!selectedNamespace}>
              <option value="">-- Select a Policy --</option>
              {policies.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '10px' }}>
            <label>Database Name: </label>
            <input 
              type="text" 
              placeholder="e.g., my-dev-db" 
              value={dbName} 
              onChange={(e) => setDbName(e.target.value)} 
            />
          </div>

          <button 
            onClick={handleProvision} 
            disabled={!selectedNamespace || !selectedPolicy || !dbName}
          >
            Provision to DSM
          </button>
        </div>
      )}

      {/* Status Footer */}
      <div style={{ marginTop: '20px', padding: '10px', backgroundColor: '#f0f0f0', borderRadius: '4px' }}>
        <strong>Status:</strong> {status || 'Waiting for input...'}
      </div>
    </div>
  );
}