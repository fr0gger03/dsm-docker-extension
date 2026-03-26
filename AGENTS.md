# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## What This Is

A Docker Desktop extension for provisioning VMware Data Services Manager (DSM) databases. It connects to a Kubernetes cluster via kubeconfig, discovers namespaces and DSM policies, and creates `DBCluster` custom resources.

## Build and Run

### Build the extension image (multi-stage: compiles UI then assembles final image)
```
docker build -t vmware-dsm-extension .
```

### Install into Docker Desktop
```
docker extension install vmware-dsm-extension:latest
```

### Full build-and-install shortcut
```
./install-extension.sh
```

### Local development (two terminals)
```
# Frontend (hot reload on localhost:5173)
cd ui && npm run dev

# Backend (auto-reload)
cd backend && uvicorn main:app --reload
```

### Production-style via compose
```
docker-compose up --build
```

### Standalone mode (outside Docker Desktop, exposes port 3000)
```
docker-compose -f docker-compose.standalone.yml up
```

## Lint and Type Check

```
# Frontend lint
cd ui && npm run lint

# Frontend type check (runs as part of build)
cd ui && tsc -b
```

There are no tests configured for either the frontend or backend.

## Architecture

### Two-component system

**Backend** (`backend/main.py`) — A single-file FastAPI app that holds an in-memory kubeconfig session (persists across UI navigations since the backend container keeps running). Endpoints:
- `GET /api/status` — Returns whether a session exists and pre-fetches namespaces (used by frontend to restore state on mount)
- `POST /api/connect` — Validates and stores kubeconfig
- `POST /api/disconnect` — Clears the stored kubeconfig session
- `GET /api/namespaces` — Lists K8s namespaces via `CoreV1Api`
- `GET /api/policies/{namespace}` — Lists DSM policies; falls back to `dataservicepolicybindings` and extracts policy names from `status.policies`
- `POST /api/provision` — Creates a database CR (`PostgresCluster` or `MySQLCluster`) based on engine selection
- `GET /api/databases/{namespace}` — Lists provisioned databases across all engine types
- `DELETE /api/databases/{namespace}/{name}?engine=...` — Deletes a provisioned database

The backend also mounts the compiled UI as static files at `/` (fallback, for standalone mode).

**Frontend** (`ui/src/App.tsx`) — A single-component React app. All UI logic lives in `App.tsx`. It communicates with the backend through the Docker Desktop extension service client (`@docker/extension-api-client`). The `callBackend` helper in `App.tsx` wraps this, using `client.extension.vm.service.get()` for GET endpoints and `.post()` for POST endpoints — the HTTP method must match the backend route.

### Docker Desktop Extension wiring

- `metadata.json` — Declares the dashboard tab (rooted at `/ui`), the VM service, and the backend socket name via `vm.exposes.socket` and `ui.dashboard-tab.backend.socket`. Both must be set for Docker Desktop to wire up frontend-to-backend communication.
- `docker-compose.yaml` — Runs the backend image with `uvicorn` listening on a Unix socket at `/run/guest-services/backend.sock`. The `${DESKTOP_PLUGIN_IMAGE}` variable is injected by Docker Desktop at runtime.
- `Dockerfile` — Multi-stage: Stage 1 builds the React app with Node 22, Stage 2 copies the dist into a Python 3.13-slim image and installs backend dependencies. The `CMD` also starts uvicorn on the socket.

### Extension gotchas

- **UI root path**: Docker Desktop prepends `ui/` when resolving the metadata `root` path. The Dockerfile must `COPY` built UI files to `/ui` (not `/ui/dist`) and `metadata.json` must set `root: "/ui"`. Using a nested path like `/ui/dist` causes a doubled `ui/ui/dist/` path that breaks loading.
- **Vite base path**: `vite.config.ts` must set `base: './'` so asset paths in the built HTML are relative. Absolute paths (`/assets/...`) fail inside Docker Desktop's extension iframe context.
- **Backend socket**: The backend MUST listen on a Unix socket (`/run/guest-services/backend.sock`), not TCP. Docker Desktop's `vm.service` API communicates through this socket. The socket filename must be declared in `metadata.json` in both `vm.exposes.socket` and `ui.dashboard-tab.backend.socket`. Docker Desktop automatically mounts `/run/guest-services/<extension-name>/` into the container at `/run/guest-services/`. Do NOT add an explicit `/run/guest-services` volume mount in docker-compose.yaml — it will override DD's automatic mount and break socket routing.
- **POST body format**: The DD extension SDK's `.post(path, body)` takes the body object directly. Do NOT wrap it in `{ body: JSON.stringify(...) }` — FastAPI will receive a nested object instead of the expected fields.
- **Updating the extension**: After rebuilding the Docker image, run `docker extension update vmware-dsm-extension:latest` (not `install`). A local `npm run build` alone does NOT update the installed extension — the Docker image must be rebuilt.
- **Debug mode**: Run `docker extension dev debug vmware-dsm-extension` to open Chrome DevTools for the extension UI. Reset with `docker extension dev reset vmware-dsm-extension`.

### DSM Kubernetes CRDs

The backend interacts with VMware DSM custom resources across two API groups:
- `infrastructure.dataservices.vmware.com/v1alpha1`:
  - `dataservicepolicies` (read) — per-namespace policies, often empty
  - `dataservicepolicybindings` (read, fallback) — bindings that reference policies; actual policy names are in `status.policies[*].name`
- `databases.dataservices.vmware.com/v1alpha1`:
  - `postgresclusters` (create/list/delete) — PostgreSQL databases
  - `mysqlclusters` (create/list/delete) — MySQL databases

There is no generic `dbclusters` resource — databases are provisioned as engine-specific CRs. The `ENGINE_CRD_MAP` in `main.py` maps UI engine names to CRD plural names and Kind.
