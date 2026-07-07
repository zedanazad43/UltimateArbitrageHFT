# ── Hero Super Agent — Production Dockerfile ─────────────────────────────────
FROM node:22-alpine

ENV NODE_ENV=production

RUN addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser

WORKDIR /app
RUN chown appuser:appuser /app

COPY --chown=appuser:appuser package.json ./
RUN npm install --omit=dev

COPY --chown=appuser:appuser . .

USER appuser:appuser

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 -O- http://localhost:8788/health || exit 1

CMD ["node", "server.js"]
