from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from typing import Optional
from kubernetes import client, config
from kubernetes.client.exceptions import ApiException
import yaml
import os
import json
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

APP_VERSION = os.environ.get("APP_VERSION", "dev")

app = FastAPI()

# Enable CORS for Docker Desktop extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory storage for the active session's kubeconfig
session_state = {"kubeconfig": None}

# --- Pydantic Models for our API Requests ---
class ConnectRequest(BaseModel):
    kubeconfig_yaml: str

class ProvisionRequest(BaseModel):
    namespace: str
    engine: str
    instance_name: str
    database_name: str
    admin_username: str
    admin_password: str
    version: str
    infrastructure_policy: str
    storage_policy_name: str
    vm_class: str
    storage_space_gi: int
    topology: str  # "single" or "ha"
    backup_location: Optional[str] = None
    backup_retention_days: Optional[int] = None
    maintenance_day: str = "SATURDAY"
    maintenance_time: str = "23:59"
    maintenance_duration: str = "6h"

def extract_k8s_error(e: Exception) -> str:
    """Extract a clean error message from a K8s ApiException."""
    if isinstance(e, ApiException):
        try:
            body = json.loads(e.body)
            if "message" in body:
                return body["message"]
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass
        return f"{e.reason} ({e.status})" if e.reason else str(e)
    return str(e)

# --- Helper to get an authenticated K8s client ---
def get_k8s_client():
    if not session_state["kubeconfig"]:
        raise HTTPException(status_code=401, detail="Not connected. Please provide a kubeconfig.")
    
    # Load the configuration purely in memory
    config.load_kube_config_from_dict(session_state["kubeconfig"])
    # DSM clusters may use CA certs with non-critical Basic Constraints,
    # which Python's SSL rejects. Disable verification as a workaround.
    client.Configuration._default.verify_ssl = False
    return client.CoreV1Api(), client.CustomObjectsApi()

# --- Endpoints ---

@app.get("/api/version")
def get_version():
    return {"version": APP_VERSION}

@app.get("/api/status")
def get_status():
    """Check if a kubeconfig session exists and return connection state."""
    connected = session_state["kubeconfig"] is not None
    result = {"connected": connected, "namespaces": []}
    if connected:
        try:
            core_api, _ = get_k8s_client()
            ns_list = core_api.list_namespace()
            result["namespaces"] = [ns.metadata.name for ns in ns_list.items]
        except Exception:
            # Session exists but K8s is unreachable — still report connected
            pass
    return result

@app.post("/api/disconnect")
def disconnect():
    """Clear the stored kubeconfig session."""
    session_state["kubeconfig"] = None
    return {"status": "Disconnected"}

@app.post("/api/connect")
def connect(req: ConnectRequest):
    try:
        # Parse the raw string into a Python dictionary
        config_dict = yaml.safe_load(req.kubeconfig_yaml)
        
        # Test the config by attempting to load it
        config.load_kube_config_from_dict(config_dict)
        
        # Save to session state if successful
        session_state["kubeconfig"] = config_dict
        return {"status": "Connected successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid kubeconfig: {str(e)}")

@app.get("/api/namespaces")
def get_namespaces():
    core_api, _ = get_k8s_client()
    try:
        # The K8s API will only return namespaces the user's token is entitled to see
        namespaces = core_api.list_namespace()
        return {"namespaces": [ns.metadata.name for ns in namespaces.items]}
    except Exception as e:
        raise HTTPException(status_code=403, detail=f"Failed to list namespaces: {extract_k8s_error(e)}")

@app.get("/api/namespace-config/{namespace}")
def get_namespace_config(namespace: str):
    """Return full provisioning options derived from policy bindings."""
    _, custom_api = get_k8s_client()
    try:
        bindings = custom_api.list_namespaced_custom_object(
            group="infrastructure.dataservices.vmware.com",
            version="v1alpha1",
            namespace=namespace,
            plural="dataservicepolicybindings"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=extract_k8s_error(e))

    # Merge all bindings in the namespace
    engines = []
    infra_policies = []
    backup_locations = []
    max_storage = {}

    for b in bindings.get("items", []):
        st = b.get("status", {})

        # Engines + versions from dataServiceVersions
        for dsv in st.get("dataServiceVersions", []):
            svc = dsv.get("serviceType", "")
            versions = [v["version"] for v in dsv.get("versions", [])]
            engine_key = None
            if "postgres" in svc:
                engine_key = "postgres"
            elif "mysql" in svc:
                engine_key = "mysql"
            if engine_key:
                existing = next((e for e in engines if e["engine"] == engine_key), None)
                if existing:
                    existing["versions"] = list(set(existing["versions"] + versions))
                else:
                    engines.append({"engine": engine_key, "versions": versions})

        # Topology options from aggregate policies
        pg = st.get("aggregatePostgresPolicy", {})
        if pg:
            max_storage["postgres"] = pg.get("common", {}).get("allowedStorageSpace", {}).get("max", "")
            allowed_replicas = pg.get("allowedReplicas", [])
            e = next((e for e in engines if e["engine"] == "postgres"), None)
            if e:
                e["allowedReplicas"] = allowed_replicas

        my = st.get("aggregateMysqlPolicy", {})
        if my:
            max_storage["mysql"] = my.get("common", {}).get("allowedStorageSpace", {}).get("max", "")
            allowed_members = my.get("allowedMembers", [])
            e = next((e for e in engines if e["engine"] == "mysql"), None)
            if e:
                e["allowedMembers"] = allowed_members

        # Backup locations (from any engine's common block)
        for policy_key in ["aggregatePostgresPolicy", "aggregateMysqlPolicy"]:
            locs = st.get(policy_key, {}).get("common", {}).get("allowedBackupLocations", [])
            for loc in locs:
                name = loc if isinstance(loc, str) else loc.get("name", "")
                if name and name not in backup_locations:
                    backup_locations.append(name)

        # Infrastructure policies with VM classes and storage policies
        for ip in st.get("infrastructurePolicies", []):
            ip_name = ip.get("name", "")
            if any(p["name"] == ip_name for p in infra_policies):
                continue
            infra_policies.append({
                "name": ip_name,
                "status": ip.get("status", ""),
                "vmClasses": ip.get("vmClasses", []),
                "storagePolicies": ip.get("storagePolicies", []),
                "zoneCount": ip.get("zoneCount", 1),
            })

    return {
        "engines": engines,
        "infrastructurePolicies": infra_policies,
        "backupLocations": backup_locations,
        "maxStorage": max_storage,
    }

# Map UI engine names to DSM CRD plural names and Kind
ENGINE_CRD_MAP = {
    "postgres": {"plural": "postgresclusters", "kind": "PostgresCluster"},
    "mysql": {"plural": "mysqlclusters", "kind": "MySQLCluster"},
}

@app.post("/api/provision")
def provision_db(req: ProvisionRequest):
    _, custom_api = get_k8s_client()

    crd_info = ENGINE_CRD_MAP.get(req.engine)
    if not crd_info:
        raise HTTPException(status_code=400, detail=f"Unsupported engine: {req.engine}")

    spec: dict = {
        "adminUsername": req.admin_username,
        "databaseName": req.database_name,
        "version": req.version,
        "storageSpace": f"{req.storage_space_gi}Gi",
        "storagePolicyName": req.storage_policy_name,
        "infrastructurePolicy": {"name": req.infrastructure_policy},
        "vmClass": {"name": req.vm_class},
        "maintenanceWindow": {
            "duration": req.maintenance_duration,
            "startDay": req.maintenance_day,
            "startTime": req.maintenance_time,
        },
    }

    # Engine-specific topology field
    if req.engine == "postgres":
        spec["replicas"] = 1 if req.topology == "ha" else 0
    elif req.engine == "mysql":
        spec["members"] = 3 if req.topology == "ha" else 1

    # Password
    if req.admin_password:
        spec["adminPassword"] = req.admin_password

    # Backup (optional)
    if req.backup_location:
        spec["backupLocation"] = {"name": req.backup_location}
        spec["backupConfig"] = {
            "backupRetentionDays": req.backup_retention_days or 30,
            "schedules": [
                {"name": "full-weekly", "type": "full", "schedule": "59 23 * * 6"},
                {"name": "incr-daily", "type": "incremental", "schedule": "59 23 1/1 * *"},
            ],
        }

    manifest = {
        "apiVersion": "databases.dataservices.vmware.com/v1alpha1",
        "kind": crd_info["kind"],
        "metadata": {"name": req.instance_name, "namespace": req.namespace},
        "spec": spec,
    }

    logger.info(f"Provisioning {req.engine} '{req.instance_name}' in {req.namespace}")
    logger.info(f"Manifest: {json.dumps(manifest, indent=2)}")

    try:
        custom_api.create_namespaced_custom_object(
            group="databases.dataservices.vmware.com",
            version="v1alpha1",
            namespace=req.namespace,
            plural=crd_info["plural"],
            body=manifest,
        )
        return {"status": "Provisioning Started", "message": f"Created {req.instance_name} in {req.namespace}"}
    except Exception as e:
        logger.exception(f"Provision failed for {req.instance_name}")
        raise HTTPException(status_code=500, detail=extract_k8s_error(e))

# Database CRD types to query when listing databases
DATABASE_CRDS = [
    {"plural": "postgresclusters", "engine": "postgres"},
    {"plural": "mysqlclusters", "engine": "mysql"},
]

@app.get("/api/databases/{namespace}")
def list_databases(namespace: str):
    """List all provisioned databases in a namespace."""
    _, custom_api = get_k8s_client()
    databases = []
    for crd in DATABASE_CRDS:
        try:
            result = custom_api.list_namespaced_custom_object(
                group="databases.dataservices.vmware.com",
                version="v1alpha1",
                namespace=namespace,
                plural=crd["plural"]
            )
            for item in result.get("items", []):
                status = item.get("status", {})
                spec = item.get("spec", {})
                databases.append({
                    "name": item["metadata"]["name"],
                    "engine": crd["engine"],
                    "status": status.get("phase", status.get("state", "Unknown")),
                    "created": item["metadata"].get("creationTimestamp", ""),
                    "databaseName": spec.get("databaseName", ""),
                    "adminUsername": spec.get("adminUsername", ""),
                })
        except Exception as e:
            logger.warning(f"Failed to list {crd['plural']} in {namespace}: {e}")
    return {"databases": databases}


def _build_connection_string(engine: str, spec: dict, status: dict) -> dict:
    """Extract connection info from a database CR's spec and status."""
    db_name = spec.get("databaseName", "")
    admin_user = spec.get("adminUsername", "")
    host = ""
    port = ""

    # DSM puts connection info in status — try common locations
    conn = status.get("connection", {})
    if conn:
        host = conn.get("host", conn.get("ip", ""))
        port = str(conn.get("port", ""))

    # Fallback: check status.host / status.ip / status.endpoints
    if not host:
        host = status.get("host", status.get("ip", ""))
    if not port:
        port = str(status.get("port", ""))
    endpoints = status.get("endpoints", [])
    if endpoints and not host:
        ep = endpoints[0] if isinstance(endpoints[0], dict) else {}
        host = ep.get("host", ep.get("ip", ""))
        port = str(ep.get("port", port))

    # Default ports
    if not port:
        port = "5432" if engine == "postgres" else "3306"

    # Build connection string
    if engine == "postgres":
        conn_str = f"postgresql://{admin_user}@{host}:{port}/{db_name}" if host else ""
    elif engine == "mysql":
        conn_str = f"mysql://{admin_user}@{host}:{port}/{db_name}" if host else ""
    else:
        conn_str = ""

    return {
        "host": host,
        "port": port,
        "databaseName": db_name,
        "adminUsername": admin_user,
        "connectionString": conn_str,
        "note": "" if host else "Connection details not yet available (database may still be provisioning)",
    }


@app.get("/api/databases/{namespace}/{name}/connection")
def get_database_connection(namespace: str, name: str, engine: str = Query(...)):
    """Get connection string and details for a specific database."""
    _, custom_api = get_k8s_client()
    crd_info = ENGINE_CRD_MAP.get(engine)
    if not crd_info:
        raise HTTPException(status_code=400, detail=f"Unsupported engine: {engine}")
    try:
        item = custom_api.get_namespaced_custom_object(
            group="databases.dataservices.vmware.com",
            version="v1alpha1",
            namespace=namespace,
            plural=crd_info["plural"],
            name=name,
        )
        return _build_connection_string(engine, item.get("spec", {}), item.get("status", {}))
    except Exception as e:
        raise HTTPException(status_code=500, detail=extract_k8s_error(e))

@app.delete("/api/databases/{namespace}/{name}")
def delete_database(namespace: str, name: str, engine: str = Query(...)):
    """Delete a provisioned database by name and engine type."""
    _, custom_api = get_k8s_client()
    crd_info = ENGINE_CRD_MAP.get(engine)
    if not crd_info:
        raise HTTPException(status_code=400, detail=f"Unsupported engine: {engine}")
    try:
        custom_api.delete_namespaced_custom_object(
            group="databases.dataservices.vmware.com",
            version="v1alpha1",
            namespace=namespace,
            plural=crd_info["plural"],
            name=name,
        )
        return {"status": "Deleted", "message": f"Deleted {name} in {namespace}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=extract_k8s_error(e))

# Mount static files
# In the Docker image, built files are at /ui; in local dev, they're at ../ui/dist
ui_path = os.path.join(os.path.dirname(__file__), "..", "ui", "dist")
if not os.path.exists(os.path.join(ui_path, "index.html")):
    ui_path = os.path.join(os.path.dirname(__file__), "..", "ui")
if os.path.exists(os.path.join(ui_path, "index.html")):
    app.mount("/", StaticFiles(directory=ui_path, html=True), name="static")
