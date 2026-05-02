# ── Build stage ───────────────────────────────────────────────────────────────
FROM golang:1.24-alpine AS builder

# Install build dependencies (gcc is needed by go-ethereum's C bindings).
RUN apk add --no-cache gcc musl-dev linux-headers

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=1 GOOS=linux go build -o /hft ./cmd/hft

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM alpine:3.20

# ca-certificates is needed for TLS connections to exchanges and RPC nodes.
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=builder /hft /app/hft

# Default environment (all overridable at runtime via -e or docker-compose env_file).
ENV PAPER_TRADING=true \
    TRADING_ENABLED=false \
    SCAN_INTERVAL_MS=500 \
    METRICS_ADDR=:9090 \
    MIN_NET_PROFIT_PCT=0.05 \
    MAX_SPREAD_PCT=5.0 \
    INITIAL_CAPITAL_USD=1000 \
    MAX_DAILY_LOSS_USD=25 \
    MIN_SECONDS_BETWEEN_TX=30 \
    WIN_RATE=0.55 \
    RISK_REWARD_RATIO=2.0 \
    MAX_GAS_COST_PCT=0.30

EXPOSE 9090

ENTRYPOINT ["/app/hft"]
