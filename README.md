# VMware DSM Docker Extension

A Docker Desktop extension that enables native provisioning of VMware Data Service Manager (DSM) databases directly from your Docker Desktop dashboard.

## Overview

This extension provides a seamless interface for connecting to Kubernetes clusters running VMware DSM and provisioning databases through a simple, intuitive UI. It handles kubeconfig authentication, namespace discovery, policy retrieval, and database provisioning all from within Docker Desktop.

## Features

- **Kubeconfig Integration**: Securely connect to Kubernetes clusters via kubeconfig authentication
- **Namespace Discovery**: Automatically list accessible namespaces based on your RBAC permissions
- **Policy Management**: Retrieve and display available DSM Data Service Policies
- **Database Provisioning**: Create database clusters with configurable engines and policies
- **Real-time Status**: Session-aware connection state with error feedback

## Architecture

This extension consists of two main components:

### Frontend (React + TypeScript + Vite)
Located in `ui/`, the dashboard tab provides:
- Kubeconfig upload/paste interface
- Namespace selector
- Policy browser
- Database provisioning form

**Tech Stack**: React 19, TypeScript, Vite, Docker Extension API Client

### Backend (FastAPI + Python)
Located in `backend/`, the API server provides:
- `/api/connect` - Authenticate with kubeconfig and establish session
- `/api/namespaces` - List namespaces accessible to the authenticated user
- `/api/policies/{namespace}` - Retrieve DSM Data Service Policies in a namespace
- `/api/provision` - Create a new database cluster resource

**Tech Stack**: FastAPI, Python 3.11, Kubernetes Python client

## Prerequisites

- Docker Desktop with Extensions support enabled
- Access to a Kubernetes cluster with VMware DSM installed
- Valid kubeconfig for the target cluster
- Required RBAC permissions to list namespaces, policies, and create DBCluster resources

## Installation

1. Build the extension:
```bash
docker build -t vmware-dsm-extension .
```

2. Install into Docker Desktop:
```bash
docker extension install vmware-dsm-extension
```

Or install directly from the Docker Desktop Extensions marketplace if published.

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
docker-compose up --build
```

This will:
1. Build the React frontend using Node 20 and Vite
2. Assemble the extension image with compiled frontend assets
3. Start the FastAPI backend service

### Project Structure

```
.
├── Dockerfile                 # Multi-stage build (UI + extension assembly)
├── docker-compose.yaml        # Backend service and volume mounts
├── metadata.json              # Docker Extension metadata
├── icon.svg                   # Extension icon
├── ui/                        # React frontend application
│   ├── src/                   # TypeScript/React components
│   ├── package.json           # Frontend dependencies
│   ├── vite.config.ts         # Vite configuration
│   └── tsconfig.json          # TypeScript configuration
└── backend/                   # FastAPI backend
    ├── main.py                # API endpoints and logic
    ├── Dockerfile             # Backend service image
    └── requirements.txt       # Python dependencies
```

## Usage

### Connecting to a Cluster

1. Open Docker Desktop and navigate to the VMware DSM extension
2. Paste your kubeconfig YAML in the connection form
3. Click "Connect" to authenticate and establish a session

### Provisioning a Database

1. Once connected, select a namespace from the dropdown
2. View available policies for that namespace
3. Fill in the database details:
   - **Name**: Cluster name (e.g., `my-postgres-db`)
   - **Engine**: Database engine type (e.g., `postgres`, `mysql`)
   - **Policy**: Select a DSM Data Service Policy
4. Click "Provision" to create the database cluster

The backend will create a `DBCluster` resource in the specified namespace with your chosen configuration.

## Communication

The extension uses Unix domain sockets for secure communication between the frontend and backend:
- Socket path: `/run/guest-services/backend.sock`
- This enables secure IPC within Docker Desktop's guest environment

## Building Custom Images

### Frontend Build
The Dockerfile uses a multi-stage approach:
```dockerfile
# Stage 1: Build React with Node
FROM node:20-alpine AS ui-builder
...
# Stage 2: Package extension with compiled assets
FROM alpine:3.18
...
```

### Backend Deployment
The backend runs as a FastAPI application via Uvicorn, listening on a Unix domain socket that Docker Desktop exposes to the extension frontend.

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
