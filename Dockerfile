# Dockerfile — UltimateArbitrageHFT multi-stage build
# Stage 1: Build React frontend
# Stage 2: Production Node.js backend (local deployment)
#
# Usage:
#   docker build -t ultimate-arbitrage-hft .
#   docker run -p 3000:3000 --env-file .env.local.example ultimate-arbitrage-hft
#
# For Cloudflare Workers deployment use: npm run build (wrangler deploy)

# ── Stage 1: Frontend build ───────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend dependencies and install
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --prefer-offline 2>/dev/null || npm install

# Copy frontend source and build
COPY frontend/ .
RUN npm run build

# ── Stage 2: Backend runtime ──────────────────────────────────────────────────
FROM node:20-alpine AS backend

# Install wrangler for local dev mode (optional, not deployed here)
RUN apk add --no-cache dumb-init

WORKDIR /app

# Copy backend source files
COPY src/                ./src/
COPY workers/            ./workers/
COPY index.js            ./index.js
COPY wrangler.toml       ./wrangler.toml
COPY wrangler.mjs        ./wrangler.mjs

# Copy built frontend static files into public/
COPY --from=frontend-builder /app/frontend/dist ./public/

# Copy environment example (actual secrets are mounted at runtime via --env-file)
COPY .env.local.example  ./.env.example

# Expose the default local server port
EXPOSE 3000

# Use dumb-init to properly handle signals
ENTRYPOINT ["dumb-init", "--"]

# Default: start local development server via Node.js
# Override CMD for production: ["node", "index.js"]
CMD ["node", "index.js"]

# ── Labels ─────────────────────────────────────────────────────────────────────
LABEL maintainer="UltimateArbitrageHFT"
LABEL description="HFT Arbitrage Bot — Node.js backend + React frontend"
LABEL version="2.0.0"
