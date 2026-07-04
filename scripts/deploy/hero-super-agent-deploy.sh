#!/bin/bash
# Hero-Super-Agent Deployment Script
# Builds and deploys hero-super-agent services

set -e

echo "🚀 Starting Hero-Super-Agent Deployment"
echo "========================================"

# Variables
HERO_DIR="hero-super-agent"
CF_PACKAGE="$HERO_DIR/packages/cloudflare"
API_PACKAGE="$HERO_DIR/packages/api"
WEB_PACKAGE="$HERO_DIR/packages/web"

# Step 1: Install dependencies
echo ""
echo "📦 Installing dependencies..."
cd "$CF_PACKAGE"
npm install
cd ../../../

# Step 2: Build Cloudflare package
echo ""
echo "🔨 Building Cloudflare package..."
cd "$CF_PACKAGE"
npm run build 2>/dev/null || echo "No build script, skipping"
cd ../../../

# Step 3: Build API
echo ""
echo "🔨 Building API package..."
if [ -f "$API_PACKAGE/package.json" ]; then
  cd "$API_PACKAGE"
  npm install 2>/dev/null || true
  npm run build 2>/dev/null || echo "No build script for API"
  cd ../../../
fi

# Step 4: Build Web
echo ""
echo "🔨 Building Web package..."
if [ -f "$WEB_PACKAGE/package.json" ]; then
  cd "$WEB_PACKAGE"
  npm install 2>/dev/null || true
  npm run build 2>/dev/null || echo "No build script for Web"
  cd ../../../
fi

# Step 5: Cloudflare deployment
echo ""
echo "☁️  Deploying to Cloudflare..."
cd "$CF_PACKAGE"
if command -v wrangler &> /dev/null; then
  wrangler deploy
else
  npx wrangler deploy
fi
cd ../../../

echo ""
echo "✅ Hero-Super-Agent deployment complete!"
