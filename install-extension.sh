#!/bin/bash
# Quick installation script for Docker Desktop Extension

# Version is defined in the Dockerfile ARG and used as the image tag
VERSION=${1:-0.4.0}
IMAGE="vmware-dsm-extension:${VERSION}"

echo "🔨 Building VMware DSM Extension v${VERSION}..."
docker build --no-cache --build-arg APP_VERSION="${VERSION}" -t "${IMAGE}" .

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build successful"
echo ""
echo "📦 Installing extension into Docker Desktop..."

# Check if already installed; update if so, install if not
if docker extension ls 2>/dev/null | grep -q vmware-dsm-extension; then
    echo "y" | docker extension update "${IMAGE}"
else
    docker extension install "${IMAGE}"
fi

if [ $? -ne 0 ]; then
    echo "❌ Installation failed"
    exit 1
fi

echo "✅ Extension v${VERSION} installed successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Open Docker Desktop"
echo "2. Look for 'VMware DSM' in the Extensions section (left sidebar)"
echo "3. Click to open the extension"
echo ""
echo "🐛 To debug:"
echo "   - Show extension containers: Settings > Resources > Show extension containers"
echo "   - View logs: docker logs <container-name>"
echo "   - List extensions: docker extension ls"
