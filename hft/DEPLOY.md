# ============================================================
# Go HFT Engine Deployment Guide
# ============================================================
# 
# Prerequisites:
#   1. Install Docker Desktop from https://docker.com
#   2. Run: railway login (browser will open)
#
# Then run ONE of these options:
# ============================================================

# Option 1: Deploy to Railway (easiest)
railway link                                 # link to project
railway up --detach                          # deploy!
railway domain                               # get the URL

# Option 2: Deploy to Cloudflare Containers
# (already configured in wrangler.toml)
npx wrangler containers build hft --tag hft-engine:latest --push
# Then deploy from Cloudflare dashboard

# Option 3: Deploy anywhere with Docker
docker build -f hft/Dockerfile -t hft-engine hft/
docker run -d -p 8080:8080 --env-file hft/.env hft-engine

# After getting the URL, update wrangler.toml:
# HFT_ENGINE_URL = "https://your-engine-url.railway.app"
# Then redeploy Worker: npx wrangler deploy
