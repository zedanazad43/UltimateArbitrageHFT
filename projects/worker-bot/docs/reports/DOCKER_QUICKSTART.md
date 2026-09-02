# Quick Start: Test Containerized UltimateArbitrageHFT

## Prerequisites

- Docker Desktop (v4.20+) or Docker + Docker Compose
- 4+ GB free disk space
- ~10 minutes for first build

## 1. Prepare Environment

```bash
# Copy environment template
cp .env.docker .env.local

# Edit .env.local with your settings (minimal: ADMIN_TOKEN is required)
# vim .env.local
```

Minimum required in `.env.local`:
```env
ADMIN_TOKEN=your-secure-admin-token-here
PAPER_TRADING=true
TRADING_ENABLED=false
POSTGRES_PASSWORD=secure-postgres-password
```

## 2. Build Images (First Time)

Building both images will take 3–5 minutes (Go compilation is the main bottleneck).

```bash
# Build Go HFT Engine (2–3 min, watches: go mod download, CGO build)
cd hft
docker build -f Dockerfile.dhi -t ultimatearbitragehft-hft-engine:latest .
cd ..

# Build Node.js Worker (1–2 min, watches: npm ci)
docker build -f Dockerfile.dhi -t ultimatearbitragehft-worker:latest .
```

**Or use Docker Compose (automatic):**
```bash
docker compose -f docker-compose.dhi.yml build
```

## 3. Start Full Stack

```bash
docker compose -f docker-compose.dhi.yml up -d
```

**Verify services are running:**
```bash
docker compose -f docker-compose.dhi.yml ps
```

You should see:
```
NAME                              STATUS
ultimatearbitragehft-worker      Up (healthy)
ultimatearbitragehft-engine      Up (healthy)
ultimatearbitragehft-postgres    Up (healthy)
```

## 4. Test the Worker Dashboard

```bash
# Get your ADMIN_TOKEN from .env.local
export ADMIN_TOKEN=$(grep ADMIN_TOKEN .env.local | cut -d= -f2)

# Test public health endpoint (no auth required)
curl http://localhost:8787/health

# Expected response (JSON):
# {
#   "status": "ok",
#   "trading_enabled": false,
#   "paper_trading": true,
#   "equity_usd": 1000.00,
#   ...
# }
```

## 5. Test Admin Dashboard (With Auth)

```bash
# Test protected API route
curl -H "x-admin-token: $ADMIN_TOKEN" http://localhost:8787/api/status

# Expected response shows full bot state including balances, config, etc.
```

## 6. View Real-Time Logs

```bash
# Follow all logs
docker compose -f docker-compose.dhi.yml logs -f

# Or individual services
docker compose -f docker-compose.dhi.yml logs -f worker
docker compose -f docker-compose.dhi.yml logs -f hft-engine
docker compose -f docker-compose.dhi.yml logs -f postgres
```

## 7. Test HFT Engine Metrics

The Go engine exposes Prometheus metrics on port 9090:

```bash
curl http://localhost:9090/

# Should return an empty page (Prometheus format — OK if no 404)
```

## 8. Test Postgres Connection

```bash
# Access Postgres from host
psql -h localhost -U arbitrage -d ultimatearbitrage -W

# (Enter password from POSTGRES_PASSWORD in .env.local)

# Inside psql:
\dt  # List tables
SELECT COUNT(*) FROM trades;  # Verify trades table exists
\q   # Exit
```

## 9. Run Unit Tests

```bash
# From host (requires Node.js installed)
npm test

# Or inside the container
docker compose -f docker-compose.dhi.yml exec worker npm test
```

## 10. Stop and Clean Up

```bash
# Stop all services (keep volumes/data)
docker compose -f docker-compose.dhi.yml stop

# Stop and remove containers (keep volumes/data)
docker compose -f docker-compose.dhi.yml down

# Stop and remove everything (including database data — use with caution)
docker compose -f docker-compose.dhi.yml down -v
```

---

## Common Tasks

### Rebuild a Single Service

```bash
# Rebuild worker (without rebuilding engine)
docker compose -f docker-compose.dhi.yml build worker

# Rebuild and restart
docker compose -f docker-compose.dhi.yml up -d --build worker
```

### View Image Sizes

```bash
docker images | grep ultimatearbitragehft

# You should see:
# ultimatearbitragehft-worker    latest    ~200 MB
# ultimatearbitragehft-hft-engine latest    ~30–40 MB
```

### Check Security Context

```bash
# Verify containers run as non-root
docker exec ultimatearbitragehft-worker whoami
# Output: appuser

docker exec ultimatearbitragehft-engine whoami
# Output: appuser
```

### Enable Live Trading (for testing only)

```bash
# Update .env.local
PAPER_TRADING=false
TRADING_ENABLED=true

# Restart worker
docker compose -f docker-compose.dhi.yml up -d --no-deps worker

# Verify new state
curl -H "x-admin-token: $ADMIN_TOKEN" http://localhost:8787/api/status | jq .paper_trading
# Should output: false
```

### Check Read-Only Filesystem

```bash
# Try to write to app directory (should fail)
docker exec ultimatearbitragehft-worker touch /app/test.txt

# Expected: Read-only file system (permission denied)

# Writing to /tmp works (tmpfs)
docker exec ultimatearbitragehft-worker touch /tmp/test.txt
# Should succeed
```

---

## Performance Benchmark

### Build Time
| Component | Time |
|-----------|------|
| Go HFT Engine | 2–3 min |
| Node.js Worker | 1–2 min |
| Total (first build) | 3–5 min |
| Rebuild (with cache) | 10–30 sec |

### Startup Time
| Service | Time to Ready |
|---------|---|
| PostgreSQL | 5–10 sec |
| HFT Engine | 2–5 sec |
| Worker | 3–5 sec |
| Full stack | 10–20 sec |

### Image Sizes
| Image | Size |
|-------|------|
| ultimatearbitragehft-hft-engine | ~30–40 MB |
| ultimatearbitragehft-worker | ~200 MB |
| postgres:16-alpine | ~180 MB |
| **Total** | **~410–420 MB** |

---

## Troubleshooting

### Build fails: "no such file or directory"

**Check .dockerignore** — verify it's not excluding required files.

```bash
# Verify all required source files are present
ls -la hft/cmd/hft/main.go
ls -la index.js
```

### "Health check failed" in `docker compose ps`

**Check logs:**
```bash
docker compose -f docker-compose.dhi.yml logs worker
docker compose -f docker-compose.dhi.yml logs hft-engine
```

**If health check keeps failing, disable for testing:**
```bash
# Edit docker-compose.dhi.yml and comment out HEALTHCHECK lines
# Then rebuild: docker compose -f docker-compose.dhi.yml build
```

### "Connection refused" on port 8787

**Verify worker is running:**
```bash
docker compose -f docker-compose.dhi.yml logs worker
```

**If logs show crashes, check:**
- Is `index.js` valid Node.js ESM? (starts with `import ...`)
- Does it have a default export? (for Hono app)
- Check for require() calls (should be import in ESM)

### Postgres won't start

**Clear postgres volume and restart:**
```bash
docker compose -f docker-compose.dhi.yml down -v
docker compose -f docker-compose.dhi.yml up -d postgres
docker compose -f docker-compose.dhi.yml logs postgres
```

---

## Next: Push to Registry

Once local testing is , push to a container registry for CI/CD:

```bash
# Tag for registry
docker tag ultimatearbitragehft-hft-engine:latest myregistry.azurecr.io/ultimatearbitragehft-hft-engine:latest
docker tag ultimatearbitragehft-worker:latest myregistry.azurecr.io/ultimatearbitragehft-worker:latest

# Push
docker push myregistry.azurecr.io/ultimatearbitragehft-hft-engine:latest
docker push myregistry.azurecr.io/ultimatearbitragehft-worker:latest

# Deploy to Kubernetes or Swarm
kubectl apply -f k8s/
# or
docker stack deploy -c docker-compose.dhi.yml ultimatearbitragehft
```
