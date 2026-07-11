#!/bin/bash
# Docker Hardened Image build and test script for UltimateArbitrageHFT

set -e

REGISTRY="${REGISTRY:-}"
VERSION="${VERSION:-latest}"
ADMIN_TOKEN="${ADMIN_TOKEN:-dev-test-token-$(date +%s)}"

echo "═══════════════════════════════════════════════════════════════"
echo "  UltimateArbitrageHFT — Docker Hardened Image Build & Test"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ─────────────────────────────────────────────────────────────────────
# 1. Build Images
# ─────────────────────────────────────────────────────────────────────
echo "[1/6] Building Go HFT Engine (Dockerfile.dhi)..."
cd hft
docker build \
  -f Dockerfile.dhi \
  -t "ultimatearbitragehft-hft-engine:${VERSION}" \
  --build-arg GOOS=linux \
  --build-arg GOARCH=amd64 \
  .
cd ..
echo "✅ HFT Engine built successfully"
echo ""

echo "[2/6] Building Node.js Worker (Dockerfile.dhi)..."
docker build \
  -f Dockerfile.dhi \
  -t "ultimatearbitragehft-worker:${VERSION}" \
  .
echo "✅ Worker built successfully"
echo ""

# ─────────────────────────────────────────────────────────────────────
# 2. Verify Images Exist
# ─────────────────────────────────────────────────────────────────────
echo "[3/6] Verifying images..."
echo ""

HFT_IMAGE=$(docker images --quiet "ultimatearbitragehft-hft-engine:${VERSION}")
WORKER_IMAGE=$(docker images --quiet "ultimatearbitragehft-worker:${VERSION}")

if [ -z "$HFT_IMAGE" ]; then
  echo "❌ HFT Engine image not found"
  exit 1
fi

if [ -z "$WORKER_IMAGE" ]; then
  echo "❌ Worker image not found"
  exit 1
fi

echo "HFT Engine image:  $HFT_IMAGE"
echo "Worker image:      $WORKER_IMAGE"
echo ""

# ─────────────────────────────────────────────────────────────────────
# 3. Show Image Info
# ─────────────────────────────────────────────────────────────────────
echo "[4/6] Image information:"
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | grep -E "ultimatearbitragehft|REPOSITORY"
echo ""

# ─────────────────────────────────────────────────────────────────────
# 4. Test HFT Engine Security Context
# ─────────────────────────────────────────────────────────────────────
echo "[5/6] Testing HFT Engine security context..."
docker run --rm \
  --entrypoint /bin/sh \
  "ultimatearbitragehft-hft-engine:${VERSION}" \
  -c 'echo "Running as: $(whoami) (uid: $(id -u))"'
echo ""

# ─────────────────────────────────────────────────────────────────────
# 5. Test Worker Security Context
# ─────────────────────────────────────────────────────────────────────
echo "[6/6] Testing Worker security context..."
docker run --rm \
  --entrypoint /sbin/dumb-init \
  "ultimatearbitragehft-worker:${VERSION}" \
  -- node -e 'console.log("Running as:", require("os").userInfo().username, "(uid:", process.getuid(), ")")'
echo ""

# ─────────────────────────────────────────────────────────────────────
# 6. Tag for Registry (optional)
# ─────────────────────────────────────────────────────────────────────
if [ -n "$REGISTRY" ]; then
  echo "Tagging for registry: $REGISTRY"
  docker tag "ultimatearbitragehft-hft-engine:${VERSION}" "${REGISTRY}/ultimatearbitragehft-hft-engine:${VERSION}"
  docker tag "ultimatearbitragehft-worker:${VERSION}" "${REGISTRY}/ultimatearbitragehft-worker:${VERSION}"
  echo ""
fi

# ─────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "  Build Complete ✅"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo ""
echo "  1. Start local stack:"
echo "     docker compose -f docker-compose.dhi.yml up -d"
echo ""
echo "  2. Test Worker:"
echo "     curl -H \"x-admin-token: $ADMIN_TOKEN\" http://localhost:8787/api/status"
echo ""
echo "  3. View logs:"
echo "     docker compose -f docker-compose.dhi.yml logs -f"
echo ""
echo "  4. Stop stack:"
echo "     docker compose -f docker-compose.dhi.yml down"
echo ""
