# Go HFT Engine Bridge — Design Doc

> **Status:** Approved 2026-06-16
> **Goal:** Connect the Go HFT engine API to the Cloudflare Worker permanently

## Current State
- Go engine at hft/cmd/hft/main.go has full API (/api/health, /api/scan, /api/execute)
- src/hft-client.js already has client code to call these endpoints
- wrangler.toml has HFT_ENGINE_URL pointing to ephemeral 	rycloudflare.com tunnel
- Engine is NOT deployed anywhere permanent — the tunnel expires

## Design

### Architecture
`
Cloudflare Worker  ──HTTP──>  Railway/Render (Go HFT Engine)
(index.js)                   ├─ /api/health  (no auth)
(src/hft-client.js)          ├─ /api/scan    (Bearer auth)
                             └─ /api/execute (Bearer auth)
`

### Decisions
1. **Deploy to Railway.app** (free tier, 500h/mo, Go native support)
   - Railway auto-detects Go from go.mod 
   - Add ailway.json for service config
   - Set env vars via Railway dashboard
2. **Add HFT_ENGINE_SECRET** to both Railway and Cloudflare secrets
3. **Update wrangler.toml** HFT_ENGINE_URL to Railway URL once deployed
4. **Add Dockerfile.render** if needed for Go build on Railway

### Files
- Create: hft/railway.json — Railway service config
- Create: hft/Dockerfile.render — multi-stage Go build for Railway  
- Modify: wrangler.toml — update HFT_ENGINE_URL after deploy
- Modify: src/hft-client.js — add health check retry logic
