#!/usr/bin/env bash
set -euo pipefail

# One-shot operations script:
# 1) Load .dev.vars into env (if present)
# 2) Upload worker secrets via Wrangler
# 3) Optionally trigger deploy via empty commit push
# 4) Run readiness diagnostics + endpoint verification
#
# Usage:
#   ADMIN_TOKEN=xxxx bash scripts/ops-full-remediation.sh
#   ADMIN_TOKEN=xxxx bash scripts/ops-full-remediation.sh --skip-push-trigger
#   ADMIN_TOKEN=xxxx bash scripts/ops-full-remediation.sh --diagnose-only

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SKIP_PUSH_TRIGGER=0
DIAGNOSE_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-push-trigger)
      SKIP_PUSH_TRIGGER=1
      shift
      ;;
    --diagnose-only)
      DIAGNOSE_ONLY=1
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Supported: --skip-push-trigger | --diagnose-only" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${ADMIN_TOKEN:-}" ]]; then
  echo "ADMIN_TOKEN is required." >&2
  echo "Example: ADMIN_TOKEN=xxxx bash scripts/ops-full-remediation.sh" >&2
  exit 1
fi

if [[ -f .dev.vars ]]; then
  echo "== Load .dev.vars =="
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" == *=* ]]; then
      key="${line%%=*}"
      value="${line#*=}"
      key="$(printf '%s' "$key" | xargs)"
      if [[ -n "$key" && -z "${!key:-}" ]]; then
        export "$key=$value"
      fi
    fi
  done < .dev.vars
  echo
fi

if [[ "$DIAGNOSE_ONLY" -eq 0 ]]; then
  echo "== Upload worker secrets via Wrangler =="
  KEYS=(
    MEXC_API_KEY MEXC_API_SECRET
    BINANCE_API_KEY BINANCE_API_SECRET
    KUCOIN_API_KEY KUCOIN_SECRET_KEY KUCOIN_PASSPHRASE
    OKX_API_KEY OKX_API_SECRET OKX_PASSPHRASE  # data-only (BaFin)
    BITGET_API_KEY BITGET_SECRET_KEY BITGET_API_PASSPHRASE
    BITMART_API_KEY BITMART_SECRET_KEY BITMART_MEMO
    HTX_API_KEY HTX_API_SECRET
    HFT_ENGINE_URL HFT_ENGINE_SECRET
    ADMIN_TOKEN
  )

  for key in "${KEYS[@]}"; do
    value="${!key:-}"
    if [[ -z "$value" ]]; then
      echo "[SKIP] $key"
      continue
    fi
    echo "[PUT]  $key"
    printf '%s' "$value" | npx --yes wrangler@4 secret put "$key" >/dev/null
  done
  echo
fi

if [[ "$SKIP_PUSH_TRIGGER" -eq 0 ]]; then
  echo "== Trigger deploy pipeline via empty commit =="
  if git diff --quiet && git diff --cached --quiet; then
    git commit --allow-empty -m "chore: trigger deploy workflow (ops full remediation)" >/dev/null || true
  else
    echo "Workspace has uncommitted changes; skipping empty commit trigger."
  fi

  if [[ "$(git rev-parse --abbrev-ref HEAD)" == "main" ]]; then
    git push origin main >/dev/null || true
  else
    echo "Not on main branch; skipping push trigger."
  fi
  echo
fi

echo "== Verify production endpoints =="
WORKFLOW_ADMIN_TOKEN="$ADMIN_TOKEN" REQUIRE_READY_FOR_LIVE="false" node scripts/verify-production-endpoints.js

echo
echo "== Exchange readiness diagnostic =="
ADMIN_TOKEN="$ADMIN_TOKEN" node scripts/diagnose-exchange-readiness.js

echo
echo "Done."
