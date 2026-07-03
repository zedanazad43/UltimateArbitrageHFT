#!/usr/bin/env bash
set -euo pipefail

# Uploads exchange/HFT secrets from current shell env (if present),
# then runs the production readiness diagnostic.
#
# Usage examples:
#   ADMIN_TOKEN=xxxx ./scripts/remediate-all-exchanges.sh --diagnose-only
#   ADMIN_TOKEN=xxxx MEXC_API_KEY=... MEXC_API_SECRET=... ./scripts/remediate-all-exchanges.sh
#   ADMIN_TOKEN=xxxx ./scripts/remediate-all-exchanges.sh --dry-run

DRY_RUN=0
DIAGNOSE_ONLY=0
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_VARS_FILE="$ROOT_DIR/.dev.vars"

load_dev_vars() {
  if [[ ! -f "$DEV_VARS_FILE" ]]; then
    return 0
  fi

  echo "== Load local secrets from .dev.vars =="
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" == *=* ]]; then
      local key="${line%%=*}"
      local value="${line#*=}"
      key="$(printf '%s' "$key" | xargs)"
      if [[ -n "$key" && -z "${!key:-}" ]]; then
        export "$key=$value"
      fi
    fi
  done < "$DEV_VARS_FILE"
  echo
}

load_dev_vars

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --diagnose-only)
      DIAGNOSE_ONLY=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Supported options: --dry-run | --diagnose-only" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${ADMIN_TOKEN:-}" ]]; then
  echo "ADMIN_TOKEN is required." >&2
  echo "Example: ADMIN_TOKEN=xxxx ./scripts/remediate-all-exchanges.sh --diagnose-only" >&2
  exit 1
fi

# Canonical secret keys expected by the worker.
SECRETS=(
  MEXC_API_KEY
  MEXC_API_SECRET
  BINANCE_API_KEY
  BINANCE_API_SECRET
  KUCOIN_API_KEY
  KUCOIN_SECRET_KEY
  KUCOIN_PASSPHRASE
  OKX_API_KEY       # data-only (BaFin)
  OKX_API_SECRET    # data-only (BaFin)
  OKX_PASSPHRASE    # data-only (BaFin)
  BITGET_API_KEY
  BITGET_SECRET_KEY
  BITGET_API_PASSPHRASE
  BITMART_API_KEY
  BITMART_SECRET_KEY
  BITMART_MEMO
  HTX_API_KEY
  HTX_API_SECRET
  HFT_ENGINE_URL
  HFT_ENGINE_SECRET
)

upload_one() {
  local key="$1"
  local value="${!key:-}"

  if [[ -z "$value" ]]; then
    echo "[SKIP] $key (not set in shell env)"
    return 0
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[DRY]  wrangler secret put $key"
    return 0
  fi

  echo "[PUT]  $key"
  printf '%s' "$value" | npx --yes wrangler@4 secret put "$key" >/dev/null
}

if [[ "$DIAGNOSE_ONLY" -eq 0 ]]; then
  echo "== Upload exchange/HFT secrets from env =="
  for key in "${SECRETS[@]}"; do
    upload_one "$key"
  done
  echo
fi

echo "== Run all-platform readiness diagnostic =="
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[DRY]  ADMIN_TOKEN=*** node scripts/diagnose-exchange-readiness.js"
else
  ADMIN_TOKEN="$ADMIN_TOKEN" node scripts/diagnose-exchange-readiness.js
fi
