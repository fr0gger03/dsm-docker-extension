# VMware DSM Docker Extension

A Docker Desktop extension that enables native provisioning of VMware Data Service Manager (DSM) databases directly from your Docker Desktop dashboard.

## Overview

This extension provides a seamless interface for connecting to Kubernetes clusters running VMware DSM and provisioning databases through a simple, intuitive UI. It handles kubeconfig authentication, namespace discovery, policy retrieval, and database provisioning all from within Docker Desktop.

## Features

- **Kubeconfig Integration**: Securely connect to Kubernetes clusters via kubeconfig authentication
- **Persistent Sessions**: Kubeconfig is stored in the backend container's memory — navigate away and come back without re-authenticating
- **Namespace Discovery**: Automatically list accessible namespaces based on your RBAC permissions
- **Policy Management**: Retrieve and display available DSM Data Service Policies (with automatic fallback to policy bindings)
- **Database Provisioning**: Full provisioning wizard with engine/version selection, admin credentials, topology, infrastructure policy, storage policy, VM class, disk size, backup, and maintenance window
- **Database Management**: View provisioned databases with status, delete, and retrieve connection strings
- **Connection Strings**: Click "Connect" on any database to see host, port, database name, username, and a kubectl command to retrieve the password
- **Engine Filtering**: Only engines allowed by the namespace's data service policy are shown
- **Versioned Releases**: Version displayed in UI header and embedded in Docker image labels

## Architecture

This extension consists of two main components:

### Frontend (React + TypeScript + Vite)
Located in `ui/`, the dashboard tab provides:
- Kubeconfig upload/paste interface
- Namespace selector with dynamic engine filtering
- Multi-section provisioning wizard (engine, version, credentials, topology, infrastructure, backup, maintenance)
- Database table with status, connection info, and delete
- Connection string modal with kubectl password retrieval command

**Tech Stack**: React 19, TypeScript, Vite, Docker Extension API Client

### Backend (FastAPI + Python)
Located in `backend/`, the API server provides:
- `GET /api/status` - Check for existing session (enables persistent connections)
- `POST /api/connect` - Authenticate with kubeconfig and establish session
- `POST /api/disconnect` - Clear the stored kubeconfig session
- `GET /api/namespaces` - List namespaces accessible to the authenticated user
- `GET /api/namespace-config/{namespace}` - Return provisioning options (engines, versions, infra policies, VM classes, storage policies, backup locations)
- `POST /api/provision` - Create a database with full DSM spec (engine, version, credentials, topology, infrastructure, backup, maintenance)
- `GET /api/databases/{namespace}` - List provisioned databases
- `GET /api/databases/{namespace}/{name}/connection?engine=...` - Get connection string and details
- `DELETE /api/databases/{namespace}/{name}?engine=...` - Delete a provisioned database
- `GET /api/version` - Return the current application version

**Tech Stack**: FastAPI, Python 3.13, Kubernetes Python client

## Prerequisites

- Docker Desktop with Extensions support enabled
- Access to a Kubernetes cluster with VMware DSM installed
- Valid kubeconfig for the target cluster
- Required RBAC permissions to list namespaces, policies, and create/delete database resources

## Installation

Build and install in one step (tags with version number):
```bash
./install-extension.sh
```

Or with a specific version:
```bash
./install-extension.sh 0.2.0
```

Manual steps:
```bash
# Build with version
docker build --build-arg APP_VERSION=0.1.0 -t vmware-dsm-extension:0.1.0 .

# Install (first time)
docker extension install vmware-dsm-extension:0.1.0

# Update (subsequent builds)
docker extension update vmware-dsm-extension:0.1.0
```

## Development

### Quick Start

1. Clone the repository and install dependencies:
```bash
# Frontend
cd ui
npm install

# Backend
cd ../backend
pip install -r requirements.txt
```

2. Start development environment:
```bash
# Terminal 1: Frontend (hot reload)
cd ui
npm run dev

# Terminal 2: Backend API
cd backend
uvicorn main:app --reload
```

The UI will be available at `http://localhost:5173` (default Vite port).

### Building for Production

```bash
# Build with version (used for image tag, label, and UI display)
docker build --build-arg APP_VERSION=0.1.0 -t vmware-dsm-extension:0.1.0 .
```

### Standalone mode (outside Docker Desktop, exposes port 3000)
```bash
docker-compose -f docker-compose.standalone.yml up
```

### Project Structure

```
.
├── Dockerfile                   # Multi-stage build (UI + Python backend)
├── docker-compose.yaml          # Backend service for DD extension (Unix socket)
├── docker-compose.standalone.yml # Standalone mode (TCP port 3000)
├── metadata.json                # Docker Extension metadata + socket config
├── install-extension.sh         # Build + install/update shortcut
├── icon.svg                     # Extension icon
├── ui/                          # React frontend application
│   ├── src/App.tsx              # All UI logic (single component)
│   ├── package.json             # Frontend dependencies + version
│   ├── vite.config.ts           # Vite configuration (base: './')
│   └── tsconfig.json            # TypeScript configuration
└── backend/                     # FastAPI backend
    ├── main.py                  # API endpoints and logic
    └── requirements.txt         # Python dependencies
```

## Usage

### Connecting to a Cluster

1. Open Docker Desktop and navigate to the VMware DSM extension
2. Paste your kubeconfig YAML in the connection form
3. Click "Connect" to authenticate and establish a session

### Provisioning a Database

1. Once connected, select a namespace from the dropdown
2. View existing databases in the **Databases** table
3. Fill in the provisioning wizard:
   - **Engine & Version**: Only engines allowed by the namespace policy are shown
   - **Instance Name / Database Name**: Identify the cluster and default database
   - **Admin Username / Password**: Database administrator credentials
   - **Topology**: Single Server or HA Cluster
   - **Infrastructure Policy / Storage Policy / VM Class / Disk Size**: Resource allocation
   - **Backup Location / Retention**: Optional backup configuration
   - **Maintenance Window**: Day and time for automated maintenance
4. Click **Provision** to create the database

### Managing Databases

- The **Databases** table shows all provisioned databases with engine, status, and creation time
- Click **Connect** to view the connection string, host, port, username, and a kubectl command to retrieve the password from the K8s secret
- Click **Delete** to remove a database
- Click **Refresh** to update the list
- Click **Disconnect** to clear the session and connect with a different kubeconfig

## Communication

The extension uses Unix domain sockets for secure communication between the frontend and backend:
- Socket path: `/run/guest-services/backend.sock`
- This enables secure IPC within Docker Desktop's guest environment

## Versioning

The version is controlled by the `APP_VERSION` build arg in the Dockerfile (default: `0.2.0`). It flows to:
- Docker image label (`org.opencontainers.image.version`)
- Docker image tag (e.g., `vmware-dsm-extension:0.2.0`)
- Backend environment variable → `GET /api/version`
- UI header display ("v0.2.0")

To release a new version:
```bash
./install-extension.sh 0.2.0
```

## Troubleshooting

### "Not connected. Please provide a kubeconfig."
Ensure you've successfully connected with a valid kubeconfig before attempting to provision databases.

### "Failed to list namespaces. Check RBAC"
The kubeconfig user doesn't have permission to list namespaces. Verify RBAC roles and bindings in your cluster.

### "Invalid kubeconfig"
The kubeconfig YAML syntax is invalid. Check for proper indentation and required fields (clusters, contexts, users).

### Backend service won't start
Check Docker logs:
```bash
docker compose logs backend
```

Ensure `/run/guest-services` is available in the Docker Desktop guest environment.

## Contributing

Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Support

For issues, feature requests, or questions about this extension, please open an issue on the repository.

---

**Note**: This extension requires VMware DSM to be installed and configured on your target Kubernetes cluster. It does not provision DSM itself—only creates database resources within an existing DSM deployment.
