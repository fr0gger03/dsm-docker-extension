# Stage 1: Build the React frontend
FROM node:22-alpine AS ui-builder
WORKDIR /app/ui
COPY ui/ .
RUN npm ci --prefer-offline --no-audit && npm run build

# Stage 2: Python dependencies (cached layer)
FROM python:3.13-slim AS python-deps
RUN --mount=type=cache,target=/root/.cache/pip \
    apt-get update && apt-get clean && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt

# Strip Python cache and compiled files
RUN find /usr/local/lib/python3.13 -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true && \
    find /usr/local/lib/python3.13 -type f -name "*.pyc" -delete && \
    find /usr/local/lib/python3.13 -type f -name "*.pyo" -delete && \
    find /usr/local/lib/python3.13 -type f -name "*.dist-info/RECORD" -exec sed -i '/\.pyc/d; /\.pyo/d' {} + 2>/dev/null || true

# Stage 3: Final minimal image
FROM python:3.13-slim

ARG APP_VERSION=0.2.0

LABEL org.opencontainers.image.title="VMwareDSMExtension" \
      org.opencontainers.image.description="Provision DSM databases natively from Docker Desktop" \
      org.opencontainers.image.vendor="VMware DSM" \
      org.opencontainers.image.version="${APP_VERSION}" \
      com.docker.desktop.extension.api.version="0.3.4" \
      com.docker.extension.categories="database,development"

# Clean base image
RUN apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/* /usr/share/doc/* /usr/share/man/* /usr/share/info/* && \
    find /usr/local/lib/python3.13 -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true && \
    find /usr/local/lib/python3.13 -type f \( -name "*.pyc" -o -name "*.pyo" -o -name "*.egg-info" \) -delete

# Copy pre-built dependencies from deps stage
COPY --from=python-deps /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=python-deps /usr/local/bin /usr/local/bin

# Copy app files
COPY metadata.json icon.svg docker-compose.yaml /
COPY --from=ui-builder /app/ui/dist /ui

ENV APP_VERSION=${APP_VERSION}

WORKDIR /backend
COPY backend/main.py .

CMD ["uvicorn", "main:app", "--uds", "/run/guest-services/backend.sock"]
