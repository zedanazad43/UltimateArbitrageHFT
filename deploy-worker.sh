#!/bin/bash
set -e
echo "=== UAHFT Worker Deploy Script ==="
echo "Usage: bash deploy-worker.sh [worker-name]"
WORKER=${1:-ultimatearbitragehft}
cd "$(dirname "$0")"
echo "Deploying $WORKER..."
npx wrangler deploy --no-bundle 2>&1 | tail -5
echo "=== Deploy complete ==="
