#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# UltimateArbitrageHFT — Cloudflare Worker Secrets Setup
# ──────────────────────────────────────────────────────────────────────────────
# Interactively prompts for every secret the worker needs, then sets each one
# via `wrangler secret put`.  Only secrets that are non-empty will be set.
#
# Usage:
#   bash scripts/setup-cloudflare-secrets.sh            # production (default)
#   bash scripts/setup-cloudflare-secrets.sh --env staging
#
# Prerequisites:
#   - wrangler installed and authenticated (`wrangler login`)
#   - run from the repo root (or any directory containing wrangler.toml)
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

ENV_FLAG=""
if [[ "${1:-}" == "--env" && -n "${2:-}" ]]; then
  ENV_FLAG="--env $2"
  echo "▶ Targeting environment: $2"
fi

# Helper — prompt for a secret value, then set it.
# Skips setting if the user leaves the value empty.
set_secret() {
  local key="$1"
  local hint="$2"
  local value

  echo ""
  echo "──────────────────────────────────"
  echo "  SECRET: $key"
  echo "  HINT  : $hint"
  echo "──────────────────────────────────"
  read -r -s -p "  Enter value (empty = skip): " value
  echo ""  # newline after silent input

  if [[ -z "$value" ]]; then
    echo "  ⚠  Skipped (no value entered)"
    return 0
  fi

  echo "$value" | wrangler secret put "$key" $ENV_FLAG
  echo "  ✅ $key set"
}

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   UltimateArbitrageHFT — Cloudflare Secrets Setup Wizard    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "This script will walk through every required secret."
echo "Press Enter to skip any secret you don't have yet."
echo ""

# ── Admin ────────────────────────────────────────────────────────────────────
echo "=== ADMIN ==="
set_secret ADMIN_TOKEN \
  "Password for all admin endpoints (e.g. a long random string)"

# ── Telegram alerts ──────────────────────────────────────────────────────────
echo ""
echo "=== TELEGRAM ALERTS (optional but recommended) ==="
set_secret TELEGRAM_TOKEN \
  "Bot token from @BotFather (format: 123456:ABC-DEF...)"
set_secret TELEGRAM_CHAT_ID \
  "Chat/channel ID where alerts are sent (e.g. -100123456789)"

# ── MEXC ─────────────────────────────────────────────────────────────────────
echo ""
echo "=== MEXC (primary execution exchange) ==="
set_secret MEXC_API_KEY    "MEXC API key — create at https://www.mexc.com/user/openapi"
set_secret MEXC_API_SECRET "MEXC API secret"

# ── Binance ──────────────────────────────────────────────────────────────────
echo ""
echo "=== BINANCE ==="
set_secret BINANCE_API_KEY    "Binance API key — create at https://www.binance.com/en/my/settings/api-management"
set_secret BINANCE_API_SECRET "Binance API secret"

# ── KuCoin ───────────────────────────────────────────────────────────────────
echo ""
echo "=== KUCOIN ==="
set_secret KUCOIN_API_KEY        "KuCoin API key — create at https://www.kucoin.com/account/api"
set_secret KUCOIN_API_SECRET     "KuCoin API secret"
set_secret KUCOIN_API_PASSPHRASE "KuCoin API passphrase (set when creating the key)"

# ── Bitget ───────────────────────────────────────────────────────────────────
echo ""
echo "=== BITGET ==="
set_secret BITGET_API_KEY        "Bitget API key — create at https://www.bitget.com/en/account/newapi"
set_secret BITGET_API_SECRET     "Bitget API secret"
set_secret BITGET_API_PASSPHRASE "Bitget API passphrase"

# ── BitMart ──────────────────────────────────────────────────────────────────
echo ""
echo "=== BITMART ==="
set_secret BITMART_API_KEY    "BitMart API key — create at https://www.bitmart.com/api-config/en-US"
set_secret BITMART_API_SECRET "BitMart API secret"
set_secret BITMART_API_MEMO   "BitMart API memo (optional label you set when creating key)"

# ── HTX (Huobi) ──────────────────────────────────────────────────────────────
echo ""
echo "=== HTX (HUOBI) ==="
set_secret HTX_API_KEY    "HTX API key — create at https://www.htx.com/apikey/"
set_secret HTX_API_SECRET "HTX API secret"

# ── External proxy (optional) ────────────────────────────────────────────────
echo ""
echo "=== EXTERNAL PROXY (optional — improves exchange API reliability) ==="
echo "  Supported providers: bright_data | oxylabs | smartproxy | none"
set_secret EXTERNAL_PROXY_PROVIDER \
  "Proxy provider name (bright_data / oxylabs / smartproxy / none)"
set_secret EXTERNAL_PROXY_USERNAME "Proxy username / zone credential"
set_secret EXTERNAL_PROXY_PASSWORD "Proxy password"

# ── Alchemy / DEX (optional) ─────────────────────────────────────────────────
echo ""
echo "=== ALCHEMY / DEX (optional — enables on-chain DEX scanning) ==="
set_secret ALCHEMY_API_KEY \
  "Alchemy API key — create at https://www.alchemy.com/ (enables Ethereum DEX)"

# ── HFT Engine (optional) ────────────────────────────────────────────────────
echo ""
echo "=== HFT ENGINE (optional — enables Go-based high-frequency execution) ==="
set_secret HFT_ENGINE_URL    "URL of the Go HFT engine (e.g. https://hft.example.com)"
set_secret HFT_ENGINE_SECRET "Shared secret for HFT engine auth"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Setup complete!  Verify with:                               ║"
echo "║    wrangler secret list                                      ║"
echo "║  Then trigger a deploy to pick up the new values:            ║"
echo "║    git push origin main  (triggers GitHub Actions deploy)    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
