import { useState, useEffect, useCallback } from 'react';
import { createDockerDesktopClient } from '@docker/extension-api-client';

const client = createDockerDesktopClient();

interface Database {
  name: string;
  engine: string;
  status: string;
  created: string;
}

export default function App() {
  const [kubeconfig, setKubeconfig] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [policies, setPolicies] = useState<string[]>([]);
  const [selectedPolicy, setSelectedPolicy] = useState('');
  const [engine, setEngine] = useState('postgres');
  const [dbName, setDbName] = useState('');
  const [databases, setDatabases] = useState<Database[]>([]);
  const [status, setStatus] = useState('Checking session...');
  const [isLoading, setIsLoading] = useState(false);

  // --- Error extraction helper ---
  // DD SDK errors may be nested objects, plain objects, Error instances, or strings.
  // Backend errors from FastAPI come as {detail: "..."} where detail contains the
  // full K8s ApiException string. We parse out the HTTP response body's message.
  const extractError = (error: unknown): string => {
    // If it's a JSON string, parse it and recurse
    if (typeof error === 'string') {
      if (error.startsWith('{')) {
        try { return extractError(JSON.parse(error)); } catch { /* not JSON */ }
      }
      return error;
    }
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null) {
      const obj = error as Record<string, unknown>;
      if (typeof obj.message === 'string') return obj.message;
      if (typeof obj.detail === 'string') {
        // Try to extract the K8s "message" from the embedded JSON body
        const bodyMatch = /HTTP response body: (\{[\s\S]*\})/.exec(obj.detail);
        if (bodyMatch) {
          try {
            const body = JSON.parse(bodyMatch[1]);
            if (typeof body.message === 'string') return body.message;
          } catch { /* fall through to raw detail */ }
        }
        return obj.detail;
      }
      if (typeof obj.body === 'string') {
        try {
          const body = JSON.parse(obj.body);
          if (body.detail) return typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
        } catch { return obj.body; }
      }
      if (typeof obj.statusMessage === 'string') return obj.statusMessage;
      try {
        const s = JSON.stringify(error);
        return s === '{}' ? String(error) : s;
      } catch { /* fall through */ }
    }
    return String(error);
  };

  // --- Backend communication helpers ---
  const callGet = async (path: string) => {
    const response = await client.extension.vm?.service?.get(path);
    if (!response) throw new Error('No response from service');
    return typeof response === 'string' ? JSON.parse(response) : response;
  };

  const callPost = async (path: string, body?: Record<string, unknown>) => {
    const response = await client.extension.vm?.service?.post(path, body);
    if (!response) throw new Error('No response from service');
    return typeof response === 'string' ? JSON.parse(response) : response;
  };

  const callDelete = async (path: string) => {
    const response = await client.extension.vm?.service?.delete(path);
    if (!response) throw new Error('No response from service');
    return typeof response === 'string' ? JSON.parse(response) : response;
  };

  // --- Fetch databases for selected namespace ---
  const fetchDatabases = useCallback(async (ns: string) => {
    if (!ns) return;
    try {
      const data = await callGet(`/api/databases/${ns}`);
      setDatabases(data.databases || []);
    } catch {
      setDatabases([]);
    }
  }, []);

  // --- Check for existing session on mount ---
  useEffect(() => {
    const checkSession = async () => {
      try {
        const data = await callGet('/api/status');
        if (data.connected) {
          setIsConnected(true);
          setNamespaces(data.namespaces || []);
          setStatus('Ready');
        } else {
          setStatus('Not connected');
        }
      } catch {
        setStatus('Not connected');
      } finally {
        setIsCheckingSession(false);
      }
    };
    checkSession();
  }, []);

  // --- Fetch policies + databases when namespace changes ---
  useEffect(() => {
    if (!selectedNamespace || !isConnected) return;

    const fetchData = async () => {
      try {
        const data = await callGet(`/api/policies/${selectedNamespace}`);
        setPolicies(data.policies || []);
      } catch (error: unknown) {
        setStatus(`Error fetching policies: ${extractError(error)}`);
      }
      fetchDatabases(selectedNamespace);
    };
    fetchData();
  }, [selectedNamespace, isConnected, fetchDatabases]);

  // --- Handlers ---
  const handleConnect = async () => {
    if (!kubeconfig.trim()) { setStatus('Please paste a kubeconfig first'); return; }
    setIsLoading(true);
    setStatus('Connecting...');
    try {
      await callPost('/api/connect', { kubeconfig_yaml: kubeconfig });
      setIsConnected(true);
      setStatus('Connected! Fetching namespaces...');
      const ns = await callGet('/api/namespaces');
      setNamespaces(ns.namespaces || []);
      setStatus('Ready');
    } catch (error: unknown) {
      setStatus(`Error: ${extractError(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await callPost('/api/disconnect');
    } catch { /* ignore */ }
    setIsConnected(false);
    setNamespaces([]);
    setSelectedNamespace('');
    setPolicies([]);
    setDatabases([]);
    setKubeconfig('');
    setStatus('Disconnected');
  };

  const handleProvision = async () => {
    setIsLoading(true);
    setStatus('Provisioning...');
    try {
      const result = await callPost('/api/provision', {
        namespace: selectedNamespace, db_name: dbName, engine, policy: selectedPolicy
      });
      setStatus(`Success: ${result.message}`);
      setDbName('');
      fetchDatabases(selectedNamespace);
    } catch (error: unknown) {
      setStatus(`Error: ${extractError(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteDb = async (db: Database) => {
    if (!confirm(`Delete database "${db.name}"?`)) return;
    setIsLoading(true);
    try {
      await callDelete(`/api/databases/${selectedNamespace}/${db.name}?engine=${db.engine}`);
      setStatus(`Deleted ${db.name}`);
      fetchDatabases(selectedNamespace);
    } catch (error: unknown) {
      setStatus(`Error: ${extractError(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  // --- Styles ---
  const card = { border: '1px solid #ddd', padding: '15px', borderRadius: '4px', marginBottom: '15px' };
  const field = { marginBottom: '15px' };
  const labelStyle: React.CSSProperties = { display: 'block', fontWeight: 'bold', marginBottom: '5px' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '6px', boxSizing: 'border-box' };
  const btnPrimary: React.CSSProperties = { padding: '8px 16px', backgroundColor: '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' };
  const btnDanger: React.CSSProperties = { padding: '4px 10px', backgroundColor: '#cc3333', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' };
  const btnSecondary: React.CSSProperties = { padding: '6px 12px', backgroundColor: '#666', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' };

  if (isCheckingSession) {
    return <div style={{ padding: '20px', fontFamily: 'sans-serif' }}><p>Checking session...</p></div>;
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '800px' }}>
      <h1>VMware Data Services Manager</h1>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>Status: {status}</p>
        {isConnected && (
          <button onClick={handleDisconnect} style={btnSecondary} disabled={isLoading}>
            Disconnect
          </button>
        )}
      </div>

      {!isConnected ? (
        <div style={card}>
          <h3>Authenticate</h3>
          <textarea
            rows={10}
            style={{ width: '100%', marginBottom: '10px', fontFamily: 'monospace', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }}
            placeholder="Paste kubeconfig YAML..."
            value={kubeconfig}
            onChange={(e) => setKubeconfig(e.target.value)}
            disabled={isLoading}
          />
          <button onClick={handleConnect} disabled={isLoading || !kubeconfig.trim()} style={btnPrimary}>
            {isLoading ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      ) : (
        <>
          {/* Namespace selector */}
          <div style={card}>
            <div style={field}>
              <label style={labelStyle}>Namespace</label>
              <select value={selectedNamespace} onChange={(e) => setSelectedNamespace(e.target.value)} disabled={isLoading} style={inputStyle}>
                <option value="">Select...</option>
                {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
              </select>
            </div>
          </div>

          {/* Databases in selected namespace */}
          {selectedNamespace && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ margin: 0 }}>Databases</h3>
                <button onClick={() => fetchDatabases(selectedNamespace)} style={btnSecondary} disabled={isLoading}>
                  Refresh
                </button>
              </div>
              {databases.length === 0 ? (
                <p style={{ color: '#999', fontSize: '14px' }}>No databases in this namespace.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                      <th style={{ padding: '6px' }}>Name</th>
                      <th style={{ padding: '6px' }}>Engine</th>
                      <th style={{ padding: '6px' }}>Status</th>
                      <th style={{ padding: '6px' }}>Created</th>
                      <th style={{ padding: '6px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {databases.map(db => (
                      <tr key={`${db.engine}-${db.name}`} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '6px' }}>{db.name}</td>
                        <td style={{ padding: '6px' }}>{db.engine}</td>
                        <td style={{ padding: '6px' }}>{db.status}</td>
                        <td style={{ padding: '6px' }}>{db.created}</td>
                        <td style={{ padding: '6px' }}>
                          <button onClick={() => handleDeleteDb(db)} style={btnDanger} disabled={isLoading}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Provision form */}
          {selectedNamespace && (
            <div style={card}>
              <h3>Provision Database</h3>
              <div style={field}>
                <label style={labelStyle}>Engine</label>
                <select value={engine} onChange={(e) => setEngine(e.target.value)} disabled={isLoading} style={inputStyle}>
                  <option value="postgres">PostgreSQL</option>
                  <option value="mysql">MySQL</option>
                </select>
              </div>
              <div style={field}>
                <label style={labelStyle}>Policy</label>
                <select value={selectedPolicy} onChange={(e) => setSelectedPolicy(e.target.value)} disabled={!selectedNamespace || isLoading} style={inputStyle}>
                  <option value="">Select...</option>
                  {policies.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={field}>
                <label style={labelStyle}>Database Name</label>
                <input type="text" placeholder="my-db" value={dbName} onChange={(e) => setDbName(e.target.value)} disabled={isLoading} style={inputStyle} />
              </div>
              <button onClick={handleProvision} disabled={!selectedNamespace || !selectedPolicy || !dbName || isLoading} style={btnPrimary}>
                {isLoading ? 'Provisioning...' : 'Provision'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

