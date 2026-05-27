#!/bin/bash
# Deploy UltimateArbitrageHFT to Cloudflare Workers
# Usage: bash cloudflare-deploy.sh [token]

set -e

echo "🚀 Cloudflare Worker Deployment Script v2.1.0"
echo "================================================"
echo ""

# Configuration
WORKER_NAME="ultimatearbitragehft"
GITHUB_REPO="https://github.com/zedanazad43/UltimateArbitrageHFT"

# Check if we're in the right directory
if [ ! -f "wrangler.toml" ]; then
    echo "❌ Error: wrangler.toml not found"
    echo "Please run this script from the project root"
    exit 1
fi

# Check dependencies
echo "📋 Checking dependencies..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    exit 1
fi

if ! command -v npx &> /dev/null; then
    echo "❌ npx not found"
    exit 1
fi

echo "✅ Dependencies found"
echo ""

# Set token if provided
if [ -n "$1" ]; then
    export CLOUDFLARE_API_TOKEN="$1"
    echo "✅ Using provided token"
else
    if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
        echo "❌ CLOUDFLARE_API_TOKEN environment variable not set"
        echo ""
        echo "Options to set token:"
        echo "1. Set environment variable: export CLOUDFLARE_API_TOKEN=your_token"
        echo "2. Pass as argument: bash cloudflare-deploy.sh your_token"
        echo "3. Use Cloudflare CLI: npx wrangler login"
        exit 1
    fi
    echo "✅ Using CLOUDFLARE_API_TOKEN environment variable"
fi

echo ""
echo "📦 Pre-deployment checks..."
echo "  - Running linting..."
npm run lint --silent || {
    echo "❌ Linting failed"
    exit 1
}
echo "    ✅ Linting passed"

echo "  - Running tests..."
npm test --silent || {
    echo "❌ Tests failed"
    exit 1
}
echo "    ✅ Tests passed"

echo "  - Checking secrets..."
npm run check:secrets --silent || {
    echo "⚠️  Warning: Secret check may have issues"
}
echo "    ✅ Secret check completed"

echo ""
echo "🚀 Deploying to Cloudflare..."
echo "  Worker: $WORKER_NAME"
echo "  Repository: $GITHUB_REPO"
echo ""

# Deploy
if npx wrangler deploy; then
    echo ""
    echo "✅ Deployment successful!"
    echo ""
    echo "🎉 Worker is now live!"
    echo ""
    echo "📊 New endpoints available:"
    echo "  • GET /api/analytics (Performance metrics)"
    echo "  • GET /api/performance (System performance)"
    echo "  • GET /api/health (Health status)"
    echo "  • POST /api/metrics/reset (Reset metrics)"
    echo ""
    echo "📍 Worker URL: https://$WORKER_NAME.zedanazad43.workers.dev"
    echo ""
    echo "🔗 Monitor logs:"
    echo "   npx wrangler tail"
    echo ""
    echo "✅ Next steps:"
    echo "   1. Test endpoints: npm run test"
    echo "   2. Monitor logs: npm run tail"
    echo "   3. View dashboard: https://dash.cloudflare.com"
        echo ""
        if [ -n "$WORKFLOW_ADMIN_TOKEN" ] || [ -n "$ADMIN_TOKEN" ]; then
            echo "🧪 Running post-deploy smoke checks (workers.dev + custom domain)..."
            CUSTOM_BASE_URL="https://api.ecostamp.net" EXPECTED_WORKER_NAME="$WORKER_NAME" WORKFLOW_ADMIN_TOKEN="${WORKFLOW_ADMIN_TOKEN:-$ADMIN_TOKEN}" REQUIRE_READY_FOR_LIVE="false" node ./scripts/verify-production-endpoints.js
            echo "✅ Smoke checks passed"
        else
            echo "⚠️ Skipping smoke checks (set WORKFLOW_ADMIN_TOKEN or ADMIN_TOKEN to enable)"
        fi
    echo ""
    exit 0
else
    echo ""
    echo "❌ Deployment failed"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check token permissions"
    echo "  2. Verify IP whitelist in Cloudflare"
    echo "  3. Try authentication: npx wrangler login"
    echo "  4. Check logs: npx wrangler tail"
    echo ""
    exit 1
fi
