FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init curl

RUN addgroup -S bot && adduser -S bot -G bot

COPY package.json ./

RUN npm install --omit=dev --legacy-peer-deps 2>/dev/null || echo "Warning: npm install had issues"

COPY . .

RUN chown -R bot:bot /app

USER bot

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8787/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
