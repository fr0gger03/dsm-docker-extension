import { useState, useEffect } from 'react';
import { createDockerDesktopClient } from '@docker/extension-api-client';

const client = createDockerDesktopClient();

export default function App() {
  const [kubeconfig, setKubeconfig] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [policies, setPolicies] = useState<string[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState('');
  const [engine, setEngine] = useState('postgres');
  const [dbName, setDbName] = useState('');
  const [status, setStatus] = useState('Initializing extension client...');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setStatus('Extension client ready');
  }, []);

  // Use extension service client to communicate with backend
  const callBackend = async (path: string, method: 'get' | 'post' = 'get', body?: any) => {
    try {
      let response;
      if (method === 'post') {
        const requestBody = body ? JSON.stringify(body) : '';
        response = await client.extension.vm?.service?.post(
          path,
          { body: requestBody }
        );
      } else {
        response = await client.extension.vm?.service?.get(path);
      }

      if (!response) throw new Error('No response from service');
      
      const data = typeof response === 'string' ? JSON.parse(response) : response;
      return data;
    } catch (error: any) {
      throw new Error(error.message || 'Service communication failed');
    }
  };

  const handleConnect = async () => {
    if (!kubeconfig.trim()) {
      setStatus('Please paste a kubeconfig first');
      return;
    }

    setIsLoading(true);
    setStatus('Connecting...');
    try {
      await callBackend('/api/connect', 'post', { kubeconfig_yaml: kubeconfig });
      setIsConnected(true);
      setStatus('Connected! Fetching namespaces...');
      const ns = await callBackend('/api/namespaces');
      setNamespaces(ns.namespaces || []);
      setStatus('Ready');
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedNamespace || !isConnected) return;
    
    const fetchPolicies = async () => {
      try {
        const data = await callBackend(`/api/policies/${selectedNamespace}`);
        setPolicies(data.policies || []);
      } catch (error: any) {
        setStatus(`Error fetching policies: ${error.message}`);
      }
    };
    
    fetchPolicies();
  }, [selectedNamespace, isConnected]);

  const handleProvision = async () => {
    setIsLoading(true);
    setStatus('Provisioning...');
    try {
      const result = await callBackend('/api/provision', 'post', {
        namespace: selectedNamespace,
        db_name: dbName,
        engine,
        policy: selectedPolicy
      });
      setStatus(`Success: ${result.message}`);
      setDbName('');
    } catch (error: any) {
      setStatus(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '800px' }}>
      <h1>VMware Data Services Manager</h1>
      <p style={{ fontSize: '12px', color: '#666' }}>Status: {status}</p>

      {!isConnected ? (
        <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px' }}>
          <h3>Authenticate</h3>
          <textarea
            rows={10}
            style={{ width: '100%', marginBottom: '10px', fontFamily: 'monospace', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }}
            placeholder="Paste kubeconfig YAML..."
            value={kubeconfig}
            onChange={(e) => setKubeconfig(e.target.value)}
            disabled={isLoading}
          />
          <button
            onClick={handleConnect}
            disabled={isLoading || !kubeconfig.trim()}
            style={{ padding: '8px 16px', backgroundColor: '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {isLoading ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      ) : (
        <div style={{ border: '1px solid #ddd', padding: '15px', borderRadius: '4px' }}>
          <h3>Provision Database</h3>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Namespace</label>
            <select
              value={selectedNamespace}
              onChange={(e) => setSelectedNamespace(e.target.value)}
              disabled={isLoading}
              style={{ width: '100%', padding: '6px' }}
            >
              <option value="">Select...</option>
              {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Engine</label>
            <select
              value={engine}
              onChange={(e) => setEngine(e.target.value)}
              disabled={isLoading}
              style={{ width: '100%', padding: '6px' }}
            >
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL</option>
            </select>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Policy</label>
            <select
              value={selectedPolicy}
              onChange={(e) => setSelectedPolicy(e.target.value)}
              disabled={!selectedNamespace || isLoading}
              style={{ width: '100%', padding: '6px' }}
            >
              <option value="">Select...</option>
              {policies.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Database Name</label>
            <input
              type="text"
              placeholder="my-db"
              value={dbName}
              onChange={(e) => setDbName(e.target.value)}
              disabled={isLoading}
              style={{ width: '100%', padding: '6px', boxSizing: 'border-box' }}
            />
          </div>

          <button
            onClick={handleProvision}
            disabled={!selectedNamespace || !selectedPolicy || !dbName || isLoading}
            style={{ padding: '8px 16px', backgroundColor: '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            {isLoading ? 'Provisioning...' : 'Provision'}
          </button>
        </div>
      )}
    </div>
  );
}
