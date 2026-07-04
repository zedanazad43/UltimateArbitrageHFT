# Hero-Super-Agent Deployment Guide

## Overview

Hero-Super-Agent is a multi-service architecture with:
- **Cloudflare Worker** - Serverless compute (main deployment target)
- **API Package** - Express/Node.js API server
- **Web Package** - Frontend/static web interface

---

## Quick Start

### Local Development
```bash
# Start hero-super-agent
npm run hero:start

# Check status
npm run hero:status
```

### Build & Deploy

#### Build Only
```bash
npm run hero:build
```

#### Dry-Run Deploy (verify before deployment)
```bash
npm run hero:deploy:dry
```

#### Full Deployment
```bash
npm run hero:deploy
```

#### Verify (test + dry-run)
```bash
npm run hero:verify
```

---

## Architecture

### Cloudflare Worker (`hero-super-agent/packages/cloudflare`)
- Main serverless deployment target
- Deployed via Wrangler CLI
- Handles: HTTP requests, routing, business logic

**Deployment:**
```bash
cd hero-super-agent/packages/cloudflare
npm install
wrangler deploy
```

### API Package (`hero-super-agent/packages/api`)
- Node.js/Express backend server
- Optional: Can run standalone or as fallback
- Deploy to Railway or other Node.js platform

**Deployment:**
```bash
cd hero-super-agent/packages/api
npm install
npm run deploy  # If deploy script exists
```

### Web Package (`hero-super-agent/packages/web`)
- Static frontend files
- Optional: Served via Docker Compose or CDN
- Deploy to GitHub Pages or S3

**Deployment:**
```bash
cd hero-super-agent/packages/web
npm install
npm run build
# Upload to CDN/Pages
```

---

## Deployment Methods

### Method 1: Automated (Recommended)
Automatic deployment on code push to main:

```bash
git push origin main
# Triggers: .github/workflows/hero-deploy.yml
```

**Workflow includes:**
1. Install dependencies
2. Build Cloudflare package
3. Deploy to Cloudflare
4. Deploy API (if configured)
5. Telegram notifications

### Method 2: Manual Local Deployment
```bash
# From repo root
npm run hero:deploy

# Or manually
cd hero-super-agent/packages/cloudflare
wrangler deploy
```

### Method 3: Docker Compose (for local/staging)
```bash
# Start all services locally
docker-compose -f hero-super-agent/docker-compose.yml up

# Services run on:
# - API: http://localhost:3001
# - Web: http://localhost:8080
```

---

## Deployment Scripts

### Pre-deployment Checklist
```bash
# Run before deploying
npm run hero:verify
```

Checks:
- Tests pass (if available)
- Wrangler can compile (dry-run)
- No build errors

### Deploy Script (`scripts/deploy/hero-super-agent-deploy.sh`)
Full deployment pipeline:
1. Installs dependencies
2. Builds Cloudflare package
3. Builds API (if available)
4. Builds Web (if available)
5. Deploys to Cloudflare

**Run:**
```bash
bash scripts/deploy/hero-super-agent-deploy.sh
```

### GitHub Actions Workflow (`.github/workflows/hero-deploy.yml`)
Automatic deployment when:
- Code pushed to `main`
- Changes in `hero-super-agent/**` directory
- Manually triggered via workflow_dispatch

**View status:**
```bash
gh run list -w hero-deploy.yml
```

---

## Configuration

### Environment Variables (`.env` or `wrangler.toml`)

Required for Cloudflare deployment:
```env
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-api-token
CLOUDFLARE_ZONE_ID=your-zone-id
```

### Wrangler Configuration
Located in: `hero-super-agent/packages/cloudflare/wrangler.toml`

**Required settings:**
```toml
name = "hero-super-agent"
account_id = "your-account-id"
workers_dev = true

[env.production]
name = "hero-super-agent-prod"
workers_dev = false
```

### API Configuration
Located in: `hero-super-agent/packages/api`

**For Railway deployment:**
```toml
[build]
builder = "NIXPACKS"

[deploy]
healthcheckPath = "/health"
```

---

## Monitoring & Verification

### Post-Deployment Checks

```bash
# Check Cloudflare deployment
curl https://hero-super-agent.workers.dev/health

# View logs
wrangler tail

# Test API (if deployed)
curl https://api.hero-super-agent.com/health

# Check status
npm run hero:status
```

### Rollback (if needed)

```bash
# Rollback to previous Cloudflare deployment
wrangler rollback

# Or redeploy from git
git checkout previous-commit
npm run hero:deploy
```

---

## Integration with Main Deployment

### Deployment Order
1. **Main app** deploys first (via `deploy.yml`)
2. **Hero-super-agent** deploys second (via `hero-deploy.yml`)
3. **Both** trigger only on `main` branch push

### Both Deployments Together
```bash
# Deploy both in sequence
git push origin main
# Main app deploys → completes → hero-super-agent deploys

# Or deploy just hero-super-agent
git push hero-super-agent-changes
# Triggers only hero-deploy.yml
```

---

## Troubleshooting

### Build Fails
```bash
# Clear and reinstall
cd hero-super-agent/packages/cloudflare
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Wrangler Authentication Issues
```bash
# Login to Cloudflare
wrangler login

# Or set token
export CLOUDFLARE_API_TOKEN=your-token
```

### Deployment Timeout
```bash
# Increase timeout or deploy with verbose output
wrangler deploy --verbose
```

### Port Already in Use (Docker)
```bash
# Use different ports
docker-compose -f hero-super-agent/docker-compose.yml up -p 3002:3001 -p 8081:80
```

---

## Maintenance

### Regular Tasks

**Daily:**
- Monitor Cloudflare logs
- Check error rates

**Weekly:**
- Test deployment process
- Review performance metrics

**Monthly:**
- Update dependencies: `npm update`
- Check Cloudflare quota usage

### Dependency Updates
```bash
cd hero-super-agent/packages/cloudflare
npm update
npm audit fix
git push origin new-update-branch
```

---

## Support & Escalation

### Deployment Issues
1. Check logs: `wrangler tail`
2. Check errors: `npm run hero:verify`
3. Rollback: `wrangler rollback`

### Performance Issues
1. Profile: `wrangler analytics engine`
2. Optimize: Bundle size, cold starts
3. Scale: Increase CPU/memory (if available)

### Contact
- Telegram alerts configured for failures
- GitHub Actions workflow notifications
- Slack channel for deployments (if configured)

---

## References

- **Wrangler Docs:** https://developers.cloudflare.com/workers/wrangler/
- **Cloudflare Workers:** https://developers.cloudflare.com/workers/
- **Railway Docs:** https://docs.railway.app/
- **Docker Compose:** https://docs.docker.com/compose/

---

**Last Updated:** 2026-07-04  
**Status:** Production Ready
