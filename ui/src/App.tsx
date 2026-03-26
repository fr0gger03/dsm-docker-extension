import { useState, useEffect, useCallback } from 'react';
import { createDockerDesktopClient } from '@docker/extension-api-client';

const client = createDockerDesktopClient();

// --- Types ---
interface Database { name: string; engine: string; status: string; created: string; databaseName?: string; adminUsername?: string; }
interface ConnectionInfo { host: string; port: string; databaseName: string; adminUsername: string; connectionString: string; note: string; }
interface VmClass { name: string; requests?: { cpu: string; memory: string }; }
interface InfraPolicy { name: string; status: string; vmClasses: VmClass[]; storagePolicies: string[]; zoneCount: number; }
interface EngineConfig { engine: string; versions: string[]; allowedReplicas?: number[]; allowedMembers?: number[]; }
interface NamespaceConfig {
  engines: EngineConfig[];
  infrastructurePolicies: InfraPolicy[];
  backupLocations: string[];
  maxStorage: Record<string, string>;
}

const DAYS = ['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY'];

export default function App() {
  // --- Connection state ---
  const [kubeconfig, setKubeconfig] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [selectedNamespace, setSelectedNamespace] = useState('');
  const [databases, setDatabases] = useState<Database[]>([]);
  const [status, setStatus] = useState('Checking session...');
  const [isLoading, setIsLoading] = useState(false);
  const [appVersion, setAppVersion] = useState('');

  // --- Namespace config (from policy bindings) ---
  const [nsConfig, setNsConfig] = useState<NamespaceConfig | null>(null);

  // --- Provision form state ---
  const [engine, setEngine] = useState('');
  const [version, setVersion] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [databaseName, setDatabaseName] = useState('');
  const [adminUsername, setAdminUsername] = useState('pgadmin');
  const [adminPassword, setAdminPassword] = useState('');
  const [topology, setTopology] = useState('single');
  const [infraPolicy, setInfraPolicy] = useState('');
  const [storagePolicy, setStoragePolicy] = useState('');
  const [vmClass, setVmClass] = useState('');
  const [storageSpaceGi, setStorageSpaceGi] = useState(20);
  const [backupLocation, setBackupLocation] = useState('');
  const [backupRetention, setBackupRetention] = useState(30);
  const [maintDay, setMaintDay] = useState('SATURDAY');
  const [maintTime, setMaintTime] = useState('23:59');

  // --- Connection info modal ---
  const [connInfo, setConnInfo] = useState<ConnectionInfo | null>(null);
  const [connDbName, setConnDbName] = useState('');

  // --- Helpers ---
  const extractError = (error: unknown): string => {
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
        const bodyMatch = /HTTP response body: (\{[\s\S]*\})/.exec(obj.detail);
        if (bodyMatch) {
          try { const body = JSON.parse(bodyMatch[1]); if (typeof body.message === 'string') return body.message; } catch { /* ignore */ }
        }
        return obj.detail;
      }
      try { const s = JSON.stringify(error); return s === '{}' ? String(error) : s; } catch { /* ignore */ }
    }
    return String(error);
  };

  const callGet = async (path: string) => {
    const r = await client.extension.vm?.service?.get(path);
    if (!r) throw new Error('No response');
    return typeof r === 'string' ? JSON.parse(r) : r;
  };
  const callPost = async (path: string, body?: Record<string, unknown>) => {
    const r = await client.extension.vm?.service?.post(path, body);
    if (!r) throw new Error('No response');
    return typeof r === 'string' ? JSON.parse(r) : r;
  };
  const callDelete = async (path: string) => {
    const r = await client.extension.vm?.service?.delete(path);
    if (!r) throw new Error('No response');
    return typeof r === 'string' ? JSON.parse(r) : r;
  };

  // --- Data fetching ---
  const fetchDatabases = useCallback(async (ns: string) => {
    if (!ns) return;
    try { const d = await callGet(`/api/databases/${ns}`); setDatabases(d.databases || []); }
    catch { setDatabases([]); }
  }, []);

  const fetchNamespaceConfig = useCallback(async (ns: string) => {
    if (!ns) { setNsConfig(null); return; }
    try {
      const cfg: NamespaceConfig = await callGet(`/api/namespace-config/${ns}`);
      setNsConfig(cfg);
      // Auto-select first engine
      if (cfg.engines.length > 0) {
        const eng = cfg.engines[0];
        setEngine(eng.engine);
        setAdminUsername(eng.engine === 'mysql' ? 'root' : 'pgadmin');
        if (eng.versions.length > 0) setVersion(eng.versions[0]);
      } else {
        setEngine('');
        setVersion('');
      }
      // Auto-select first infra policy
      if (cfg.infrastructurePolicies.length > 0) {
        const ip = cfg.infrastructurePolicies[0];
        setInfraPolicy(ip.name);
        if (ip.storagePolicies.length > 0) setStoragePolicy(ip.storagePolicies[0]);
        if (ip.vmClasses.length > 0) setVmClass(ip.vmClasses[0].name);
      }
      setBackupLocation(cfg.backupLocations.length > 0 ? cfg.backupLocations[0] : '');
    } catch (error: unknown) {
      setStatus(`Error loading config: ${extractError(error)}`);
      setNsConfig(null);
    }
  }, []);

  // --- Session restore on mount ---
  useEffect(() => {
    const check = async () => {
      try { const v = await callGet('/api/version'); setAppVersion(v.version || ''); } catch { /* ignore */ }
      try {
        const d = await callGet('/api/status');
        if (d.connected) { setIsConnected(true); setNamespaces(d.namespaces || []); setStatus('Ready'); }
        else { setStatus('Not connected'); }
      } catch { setStatus('Not connected'); }
      finally { setIsCheckingSession(false); }
    };
    check();
  }, []);

  // --- Fetch config + databases when namespace changes ---
  useEffect(() => {
    if (!selectedNamespace || !isConnected) return;
    fetchNamespaceConfig(selectedNamespace);
    fetchDatabases(selectedNamespace);
  }, [selectedNamespace, isConnected, fetchNamespaceConfig, fetchDatabases]);

  // --- Derived state ---
  const selectedEngineConfig = nsConfig?.engines.find(e => e.engine === engine);
  const selectedInfraPolicy = nsConfig?.infrastructurePolicies.find(p => p.name === infraPolicy);

  // When engine changes, update defaults
  useEffect(() => {
    if (!selectedEngineConfig) return;
    setAdminUsername(engine === 'mysql' ? 'root' : 'pgadmin');
    if (selectedEngineConfig.versions.length > 0 && !selectedEngineConfig.versions.includes(version)) {
      setVersion(selectedEngineConfig.versions[0]);
    }
  }, [engine, selectedEngineConfig, version]);

  // --- Handlers ---
  const handleConnect = async () => {
    if (!kubeconfig.trim()) return;
    setIsLoading(true); setStatus('Connecting...');
    try {
      await callPost('/api/connect', { kubeconfig_yaml: kubeconfig });
      setIsConnected(true);
      const ns = await callGet('/api/namespaces');
      setNamespaces(ns.namespaces || []);
      setStatus('Ready');
    } catch (error: unknown) { setStatus(`Error: ${extractError(error)}`); }
    finally { setIsLoading(false); }
  };

  const handleDisconnect = async () => {
    try { await callPost('/api/disconnect'); } catch { /* ignore */ }
    setIsConnected(false); setNamespaces([]); setSelectedNamespace('');
    setDatabases([]); setNsConfig(null); setKubeconfig(''); setStatus('Disconnected');
  };

  const handleProvision = async () => {
    setIsLoading(true); setStatus('Provisioning...');
    try {
      const result = await callPost('/api/provision', {
        namespace: selectedNamespace,
        engine,
        instance_name: instanceName,
        database_name: databaseName,
        admin_username: adminUsername,
        admin_password: adminPassword,
        version,
        infrastructure_policy: infraPolicy,
        storage_policy_name: storagePolicy,
        vm_class: vmClass,
        storage_space_gi: storageSpaceGi,
        topology,
        backup_location: backupLocation || null,
        backup_retention_days: backupLocation ? backupRetention : null,
        maintenance_day: maintDay,
        maintenance_time: maintTime,
        maintenance_duration: '6h',
      });
      setStatus(`Success: ${result.message}`);
      setInstanceName(''); setDatabaseName('');
      fetchDatabases(selectedNamespace);
    } catch (error: unknown) { setStatus(`Error: ${extractError(error)}`); }
    finally { setIsLoading(false); }
  };

  const handleDeleteDb = async (db: Database) => {
    if (!confirm(`Delete database "${db.name}"?`)) return;
    setIsLoading(true);
    try {
      await callDelete(`/api/databases/${selectedNamespace}/${db.name}?engine=${db.engine}`);
      setStatus(`Deleted ${db.name}`);
      fetchDatabases(selectedNamespace);
    } catch (error: unknown) { setStatus(`Error: ${extractError(error)}`); }
    finally { setIsLoading(false); }
  };

  const handleShowConnection = async (db: Database) => {
    try {
      const info: ConnectionInfo = await callGet(`/api/databases/${selectedNamespace}/${db.name}/connection?engine=${db.engine}`);
      setConnInfo(info);
      setConnDbName(db.name);
    } catch (error: unknown) { setStatus(`Error: ${extractError(error)}`); }
  };

  // --- Styles ---
  const card: React.CSSProperties = { border: '1px solid #ddd', padding: '15px', borderRadius: '4px', marginBottom: '15px' };
  const field: React.CSSProperties = { marginBottom: '12px' };
  const lbl: React.CSSProperties = { display: 'block', fontWeight: 'bold', marginBottom: '4px', fontSize: '13px' };
  const inp: React.CSSProperties = { width: '100%', padding: '6px', boxSizing: 'border-box' };
  const row: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' };
  const row3: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' };
  const btn: React.CSSProperties = { padding: '8px 16px', backgroundColor: '#0066cc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' };
  const btnDanger: React.CSSProperties = { ...btn, backgroundColor: '#cc3333', padding: '4px 10px', fontSize: '12px' };
  const btnSec: React.CSSProperties = { ...btn, backgroundColor: '#666', padding: '6px 12px', fontSize: '12px' };
  const btnSmall: React.CSSProperties = { ...btn, padding: '4px 10px', fontSize: '12px' };
  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 };
  const modal: React.CSSProperties = { backgroundColor: 'white', borderRadius: '8px', padding: '20px', maxWidth: '600px', width: '90%', maxHeight: '80vh', overflow: 'auto' };
  const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: '13px', backgroundColor: '#f4f4f4', padding: '8px', borderRadius: '4px', wordBreak: 'break-all', userSelect: 'all' };

  if (isCheckingSession) return <div style={{ padding: '20px' }}><p>Checking session...</p></div>;

  const canProvision = engine && version && instanceName && databaseName && adminUsername && adminPassword && infraPolicy && storagePolicy && vmClass && storageSpaceGi > 0;

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '860px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 style={{ margin: '0 0 4px 0' }}>VMware Data Services Manager</h1>
        {appVersion && <span style={{ fontSize: '11px', color: '#999' }}>v{appVersion}</span>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>Status: {status}</p>
        {isConnected && <button onClick={handleDisconnect} style={btnSec} disabled={isLoading}>Disconnect</button>}
      </div>

      {!isConnected ? (
        <div style={card}>
          <h3>Authenticate</h3>
          <textarea rows={10} style={{ width: '100%', marginBottom: '10px', fontFamily: 'monospace', padding: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }}
            placeholder="Paste kubeconfig YAML..." value={kubeconfig} onChange={e => setKubeconfig(e.target.value)} disabled={isLoading} />
          <button onClick={handleConnect} disabled={isLoading || !kubeconfig.trim()} style={btn}>
            {isLoading ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      ) : (
        <>
          {/* Namespace */}
          <div style={card}>
            <div style={field}>
              <label style={lbl}>Namespace</label>
              <select value={selectedNamespace} onChange={e => setSelectedNamespace(e.target.value)} disabled={isLoading} style={inp}>
                <option value="">Select...</option>
                {namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
              </select>
            </div>
          </div>

          {/* Databases table */}
          {selectedNamespace && (
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h3 style={{ margin: 0 }}>Databases</h3>
                <button onClick={() => fetchDatabases(selectedNamespace)} style={btnSec} disabled={isLoading}>Refresh</button>
              </div>
              {databases.length === 0 ? (
                <p style={{ color: '#999', fontSize: '14px' }}>No databases in this namespace.</p>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                  <thead><tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                    <th style={{ padding: '6px' }}>Name</th><th style={{ padding: '6px' }}>Engine</th>
                    <th style={{ padding: '6px' }}>Status</th><th style={{ padding: '6px' }}>Created</th><th style={{ padding: '6px' }}></th><th></th>
                  </tr></thead>
                  <tbody>{databases.map(db => (
                    <tr key={`${db.engine}-${db.name}`} style={{ borderBottom: '1px solid #eee' }}>
                      <td style={{ padding: '6px' }}>{db.name}</td><td style={{ padding: '6px' }}>{db.engine}</td>
                      <td style={{ padding: '6px' }}>{db.status}</td><td style={{ padding: '6px' }}>{db.created}</td>
                      <td style={{ padding: '6px' }}><button onClick={() => handleShowConnection(db)} style={btnSmall} disabled={isLoading}>Connect</button></td>
                      <td style={{ padding: '6px' }}><button onClick={() => handleDeleteDb(db)} style={btnDanger} disabled={isLoading}>Delete</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          )}

          {/* Provision form */}
          {selectedNamespace && nsConfig && nsConfig.engines.length > 0 && (
            <div style={card}>
              <h3>Provision Database</h3>

              {/* Engine & Version */}
              <div style={row}>
                <div style={field}>
                  <label style={lbl}>Engine</label>
                  <select value={engine} onChange={e => setEngine(e.target.value)} style={inp} disabled={isLoading}>
                    {nsConfig.engines.map(eng => (
                      <option key={eng.engine} value={eng.engine}>{eng.engine === 'postgres' ? 'PostgreSQL' : 'MySQL'}</option>
                    ))}
                  </select>
                </div>
                <div style={field}>
                  <label style={lbl}>Version</label>
                  <select value={version} onChange={e => setVersion(e.target.value)} style={inp} disabled={isLoading}>
                    {(selectedEngineConfig?.versions || []).map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              {/* Basic Info */}
              <div style={row}>
                <div style={field}>
                  <label style={lbl}>Instance Name</label>
                  <input value={instanceName} onChange={e => setInstanceName(e.target.value)} placeholder="my-postgres" style={inp} disabled={isLoading} />
                </div>
                <div style={field}>
                  <label style={lbl}>Database Name</label>
                  <input value={databaseName} onChange={e => setDatabaseName(e.target.value)} placeholder="mydb" style={inp} disabled={isLoading} />
                </div>
              </div>
              <div style={row}>
                <div style={field}>
                  <label style={lbl}>Admin Username</label>
                  <input value={adminUsername} onChange={e => setAdminUsername(e.target.value)} style={inp} disabled={isLoading} />
                </div>
                <div style={field}>
                  <label style={lbl}>Admin Password</label>
                  <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="Required" style={inp} disabled={isLoading} />
                </div>
              </div>

              {/* Topology */}
              <div style={field}>
                <label style={lbl}>Topology</label>
                <select value={topology} onChange={e => setTopology(e.target.value)} style={inp} disabled={isLoading}>
                  <option value="single">Single Server</option>
                  <option value="ha">HA Cluster ({engine === 'postgres' ? '1 replica' : '3 members'})</option>
                </select>
              </div>

              {/* Infrastructure */}
              <div style={row}>
                <div style={field}>
                  <label style={lbl}>Infrastructure Policy</label>
                  <select value={infraPolicy} onChange={e => setInfraPolicy(e.target.value)} style={inp} disabled={isLoading}>
                    {nsConfig.infrastructurePolicies.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
                <div style={field}>
                  <label style={lbl}>Storage Policy</label>
                  <select value={storagePolicy} onChange={e => setStoragePolicy(e.target.value)} style={inp} disabled={isLoading}>
                    {(selectedInfraPolicy?.storagePolicies || []).map(sp => <option key={sp} value={sp}>{sp}</option>)}
                  </select>
                </div>
              </div>
              <div style={row}>
                <div style={field}>
                  <label style={lbl}>VM Class</label>
                  <select value={vmClass} onChange={e => setVmClass(e.target.value)} style={inp} disabled={isLoading}>
                    {(selectedInfraPolicy?.vmClasses || []).map(vc => (
                      <option key={vc.name} value={vc.name}>
                        {vc.name}{vc.requests ? ` (${vc.requests.cpu} CPU, ${vc.requests.memory} RAM)` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={field}>
                  <label style={lbl}>Disk Size (GiB){nsConfig.maxStorage[engine] ? ` — max ${nsConfig.maxStorage[engine]}` : ''}</label>
                  <input type="number" min={1} value={storageSpaceGi} onChange={e => setStorageSpaceGi(parseInt(e.target.value) || 1)} style={inp} disabled={isLoading} />
                </div>
              </div>

              {/* Backup */}
              {nsConfig.backupLocations.length > 0 && (
                <div style={row}>
                  <div style={field}>
                    <label style={lbl}>Backup Location</label>
                    <select value={backupLocation} onChange={e => setBackupLocation(e.target.value)} style={inp} disabled={isLoading}>
                      <option value="">None</option>
                      {nsConfig.backupLocations.map(bl => <option key={bl} value={bl}>{bl}</option>)}
                    </select>
                  </div>
                  {backupLocation && (
                    <div style={field}>
                      <label style={lbl}>Backup Retention (days)</label>
                      <input type="number" min={1} value={backupRetention} onChange={e => setBackupRetention(parseInt(e.target.value) || 1)} style={inp} disabled={isLoading} />
                    </div>
                  )}
                </div>
              )}

              {/* Maintenance Window */}
              <div style={row3}>
                <div style={field}>
                  <label style={lbl}>Maintenance Day</label>
                  <select value={maintDay} onChange={e => setMaintDay(e.target.value)} style={inp} disabled={isLoading}>
                    {DAYS.map(d => <option key={d} value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>)}
                  </select>
                </div>
                <div style={field}>
                  <label style={lbl}>Maintenance Time</label>
                  <input type="time" value={maintTime} onChange={e => setMaintTime(e.target.value)} style={inp} disabled={isLoading} />
                </div>
                <div style={{ ...field, display: 'flex', alignItems: 'flex-end' }}>
                  <button onClick={handleProvision} disabled={isLoading || !canProvision} style={{ ...btn, width: '100%' }}>
                    {isLoading ? 'Provisioning...' : 'Provision'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {selectedNamespace && nsConfig && nsConfig.engines.length === 0 && (
            <div style={card}><p style={{ color: '#999' }}>No database engines available in this namespace.</p></div>
          )}
        </>
      )}

      {/* Connection info modal */}
      {connInfo && (
        <div style={overlay} onClick={() => setConnInfo(null)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0 }}>Connection — {connDbName}</h3>
              <button onClick={() => setConnInfo(null)} style={{ ...btnSec, padding: '2px 8px' }}>✕</button>
            </div>
            {connInfo.note ? (
              <p style={{ color: '#999' }}>{connInfo.note}</p>
            ) : (
              <>
                <div style={{ marginBottom: '8px' }}>
                  <label style={lbl}>Connection String</label>
                  <div style={mono}>{connInfo.connectionString}</div>
                </div>
                <div style={row}>
                  <div><label style={lbl}>Host</label><div style={mono}>{connInfo.host}</div></div>
                  <div><label style={lbl}>Port</label><div style={mono}>{connInfo.port}</div></div>
                </div>
                <div style={{ ...row, marginTop: '8px' }}>
                  <div><label style={lbl}>Database</label><div style={mono}>{connInfo.databaseName}</div></div>
                  <div><label style={lbl}>Username</label><div style={mono}>{connInfo.adminUsername}</div></div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
