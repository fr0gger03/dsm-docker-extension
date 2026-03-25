# Stage 1: Build the React frontend
FROM node:22-alpine AS ui-builder
WORKDIR /app/ui
COPY ui/package*.json ./
RUN npm install
COPY ui/ .
RUN npm run build

# Stage 2: Assemble the final Docker Extension image
FROM python:3.11-slim

LABEL org.opencontainers.image.title="VMwareDSMExtension" \
      org.opencontainers.image.description="Provision DSM databases natively from Docker Desktop" \
      org.opencontainers.image.vendor="You/YourOrg" \
      com.docker.desktop.extension.api.version="0.3.4" \
      com.docker.extension.categories="database,development"

# Copy metadata and icon to root
COPY metadata.json /
COPY icon.svg /
COPY docker-compose.yaml /

# Copy UI dist to a location the extension can extract
COPY --from=ui-builder /app/ui/dist /ui/dist

# Set up the Python Backend
WORKDIR /backend
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/main.py .
