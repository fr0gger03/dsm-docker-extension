# Stage 1: Build the React frontend
FROM node:20-alpine AS ui-builder
WORKDIR /app/ui

# Copy package files and install dependencies
COPY ui/package*.json ./
RUN npm install --prefer-offline --no-audit

# Copy the rest of the UI source and build it
COPY ui/ .
RUN npm run build

# Stage 2: Assemble the Docker Extension image
FROM alpine:3.18

# Standard extension labels
LABEL org.opencontainers.image.title="VMware DSM Extension" \
      org.opencontainers.image.description="Provision DSM databases natively from Docker Desktop" \
      org.opencontainers.image.vendor="You/YourOrg" \
      com.docker.desktop.extension.api.version="0.3.4" \
      com.docker.extension.categories="database,development"

# Copy the required extension files
COPY metadata.json .
COPY docker-compose.yaml .

# Copy the compiled Vite frontend from the build stage
COPY --from=ui-builder /app/ui/dist ui