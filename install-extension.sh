#!/bin/bash
# Quick installation script for Docker Desktop Extension

echo "🔨 Building VMware DSM Extension..."
docker build --no-cache -t vmware-dsm-extension:latest .

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build successful"
echo ""
echo "📦 Installing extension into Docker Desktop..."
docker extension install vmware-dsm-extension:latest

if [ $? -ne 0 ]; then
    echo "❌ Installation failed"
    exit 1
fi

echo "✅ Extension installed successfully!"
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
