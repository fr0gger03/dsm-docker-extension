from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from kubernetes import client, config
import yaml
import os

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
    db_name: str
    engine: str
    policy: str

# --- Helper to get an authenticated K8s client ---
def get_k8s_client():
    if not session_state["kubeconfig"]:
        raise HTTPException(status_code=401, detail="Not connected. Please provide a kubeconfig.")
    
    # Load the configuration purely in memory
    config.load_kube_config_from_dict(session_state["kubeconfig"])
    return client.CoreV1Api(), client.CustomObjectsApi()

# --- Endpoints ---

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
        raise HTTPException(status_code=403, detail=f"Failed to list namespaces. Check RBAC: {str(e)}")

@app.get("/api/policies/{namespace}")
def get_policies(namespace: str):
    _, custom_api = get_k8s_client()
    try:
        # Querying the DSM Data Service Policies CRD
        # (Note: Plural names might vary slightly based on exact DSM 9.x CRD definitions)
        policies = custom_api.list_namespaced_custom_object(
            group="dsm.vmware.com",
            version="v1alpha1",
            namespace=namespace,
            plural="dataservicepolicies" 
        )
        return {"policies": [p["metadata"]["name"] for p in policies.get("items", [])]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/provision")
def provision_db(req: ProvisionRequest):
    _, custom_api = get_k8s_client()
    
    # Construct the YAML manifest for DSM
    manifest = {
        "apiVersion": "dsm.vmware.com/v1alpha1",
        "kind": "DBCluster",
        "metadata": {
            "name": req.db_name, 
            "namespace": req.namespace
        },
        "spec": {
            "engine": req.engine,
            "dataServicePolicy": req.policy
        }
    }
    
    try:
        # Apply the DBCluster resource to the user's namespace
        custom_api.create_namespaced_custom_object(
            group="dsm.vmware.com",
            version="v1alpha1",
            namespace=req.namespace,
            plural="dbclusters",
            body=manifest
        )
        return {"status": "Provisioning Started", "message": f"Created {req.db_name} in {req.namespace}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files for UI (must be last to not intercept /api routes)
# In the Docker image, built files are at /ui; in local dev, they're at ../ui/dist
ui_path = os.path.join(os.path.dirname(__file__), "..", "ui", "dist")
if not os.path.exists(os.path.join(ui_path, "index.html")):
    ui_path = os.path.join(os.path.dirname(__file__), "..", "ui")
if os.path.exists(os.path.join(ui_path, "index.html")):
    app.mount("/", StaticFiles(directory=ui_path, html=True), name="static")
