# ── UltimateArbitrageHFT Go Engine — Docker Hardened Image (DHI) ───────────────
# Multi-stage build using security hardening for minimal attack surface
# Based on Alpine Linux with non-root user execution

# Build stage: compile Go binary with CGO (required by go-ethereum)
FROM --platform=$BUILDPLATFORM golang:1.25-alpine AS builder

# Install build dependencies (gcc is needed by go-ethereum's C bindings).
RUN apk add --no-cache gcc musl-dev linux-headers

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download

COPY . .

# Cross-platform build support: set GOOS/GOARCH based on build platform
ARG GOOS=linux
ARG GOARCH=amd64
RUN CGO_ENABLED=1 GOOS=${GOOS} GOARCH=${GOARCH} go build -o /hft ./cmd/hft

# ── Runtime stage: Hardened Alpine runtime ────────────────────────────────────────
# Minimal base image with security hardening:
# - Minimal attack surface (only critical runtime deps)
# - Non-root user (appuser:appuser uid 1000:1000)
# - No unnecessary capabilities
FROM alpine:3.20

# Install runtime dependencies only (ca-certificates for TLS, tzdata for timezones)
RUN apk add --no-cache ca-certificates tzdata && \
    # Create non-root appuser for security hardening (uid 1000 is standard unprivileged)
    addgroup -g 1000 appuser && \
    adduser -D -u 1000 -G appuser appuser

# Create app directory with correct permissions
WORKDIR /app
RUN chown appuser:appuser /app && chmod 755 /app

# Copy the compiled binary from builder with correct ownership and permissions
COPY --from=builder --chown=appuser:appuser /hft /app/hft
RUN chmod 755 /app/hft

# Security hardening: run as non-root user (uid 1000)
USER appuser:appuser

# Default environment variables (all overridable at runtime)
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

# Expose metrics port (non-privileged > 1024)
EXPOSE 9090

# Health check: probe metrics port to verify engine is running
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:9090/ || exit 1

# Entrypoint: directly execute the Go binary (no shell wrapper)
ENTRYPOINT ["/app/hft"]
