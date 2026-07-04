# ── UltimateArbitrageHFT — Root Production Dockerfile ─────────────────────────
# Serves the Node.js Cloudflare Worker API layer on port 8787.
# Mirrors the hardened structure of Dockerfile.dhi.

# ── Stage 1: Build ─────────────────────────────────────────────────────────────
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --only=production && npm prune --production

# ── Stage 2: Hardened runtime ──────────────────────────────────────────────────
FROM alpine:3.20

RUN apk add --no-cache nodejs dumb-init && \
    addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser

ENV NODE_ENV=production

WORKDIR /app
RUN chown appuser:appuser /app && chmod 755 /app

COPY --from=builder --chown=appuser:appuser /app/node_modules ./node_modules
COPY --chown=appuser:appuser . .

USER appuser:appuser

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 -O- http://localhost:8787/health || exit 1

ENTRYPOINT ["/sbin/dumb-init", "--"]
CMD ["node", "--enable-source-maps", "index.js"]
