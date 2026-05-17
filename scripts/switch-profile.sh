#!/usr/bin/env bash
# switch-profile.sh — Switch the deployed Worker between production routing profiles.
#
# Usage:
#   bash scripts/switch-profile.sh <profile> [--allowed-ips <ip1,ip2,...>] [--proxy-list <url1,url2,...>] [--dry-run]
#
# Profiles:
#   direct  — PROXY_MODE=off    (all exchanges go direct, no proxy)
#   mixed   — PROXY_MODE=auto   (direct for fast exchanges, proxy fallback for others)
#   strict  — PROXY_MODE=required (all traffic through proxy; requires PROXY_LIST secret)
#
# Examples:
#   bash scripts/switch-profile.sh direct
#   bash scripts/switch-profile.sh mixed --allowed-ips "203.0.113.10,198.51.100.20"
#   bash scripts/switch-profile.sh strict --proxy-list "http://p1:port,http://p2:port" --allowed-ips "203.0.113.10"
#   bash scripts/switch-profile.sh mixed --dry-run

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────
PROFILE=""
ALLOWED_IPS=""
PROXY_LIST=""
DRY_RUN=false

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    direct|mixed|strict)
      PROFILE="$1"
      shift
      ;;
    --allowed-ips)
      ALLOWED_IPS="$2"
      shift 2
      ;;
    --proxy-list)
      PROXY_LIST="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: bash scripts/switch-profile.sh <direct|mixed|strict> [--allowed-ips IPs] [--proxy-list URLs] [--dry-run]" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PROFILE" ]]; then
  echo "Error: profile argument required (direct | mixed | strict)" >&2
  echo "Usage: bash scripts/switch-profile.sh <direct|mixed|strict> [--allowed-ips IPs] [--proxy-list URLs] [--dry-run]" >&2
  exit 1
fi

# ── Profile config ────────────────────────────────────────────────────────────
case "$PROFILE" in
  direct)
    PROXY_MODE="off"
    DIRECT_EXCHANGES=""
    echo "Profile: DIRECT (no proxy — all exchanges go direct)"
    ;;
  mixed)
    PROXY_MODE="auto"
    DIRECT_EXCHANGES="bitmart,mexc"
    echo "Profile: MIXED (auto — bitmart+mexc direct, others proxy-fallback)"
    ;;
  strict)
    PROXY_MODE="required"
    DIRECT_EXCHANGES=""
    echo "Profile: STRICT PROXY (required — all traffic through proxy)"
    if [[ -z "$PROXY_LIST" ]]; then
      echo "Warning: --proxy-list not provided. PROXY_LIST secret will not be updated." >&2
      echo "         Ensure PROXY_LIST is already configured, or strict mode will fail." >&2
    fi
    ;;
esac

# ── Dry-run output ────────────────────────────────────────────────────────────
if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "─── DRY RUN — commands that would run ─────────────────────────────────"
  echo "  wrangler vars set PROXY_MODE=\"${PROXY_MODE}\""
  echo "  wrangler vars set DIRECT_EXCHANGES=\"${DIRECT_EXCHANGES}\""
  [[ -n "$PROXY_LIST" ]]   && echo "  printf '%s' '<PROXY_LIST>'  | wrangler secret put PROXY_LIST"
  [[ -n "$ALLOWED_IPS" ]]  && echo "  printf '%s' '${ALLOWED_IPS}' | wrangler secret put ALLOWED_IPS"
  echo "  wrangler deploy"
  echo "────────────────────────────────────────────────────────────────────────"
  exit 0
fi

# ── Apply wrangler.toml vars in-place ─────────────────────────────────────────
TOML="wrangler.toml"

update_var() {
  local key="$1"
  local value="$2"
  # Replace the line `KEY = "..."` under [vars] section
  if grep -qE "^${key}\s*=" "$TOML"; then
    sed -i "s|^${key}\s*=.*|${key} = \"${value}\"|" "$TOML"
    echo "  wrangler.toml: set ${key} = \"${value}\""
  else
    echo "  wrangler.toml: WARNING — key '${key}' not found, skipping in-place update" >&2
  fi
}

echo ""
echo "─── Updating wrangler.toml ─────────────────────────────────────────────"
update_var "PROXY_MODE" "$PROXY_MODE"
update_var "DIRECT_EXCHANGES" "$DIRECT_EXCHANGES"

# ── Upload secrets ─────────────────────────────────────────────────────────────
echo ""
echo "─── Uploading secrets ──────────────────────────────────────────────────"

if [[ -n "$PROXY_LIST" ]]; then
  printf '%s' "$PROXY_LIST" | npx wrangler secret put PROXY_LIST
  echo "  PROXY_LIST uploaded."
fi

if [[ -n "$ALLOWED_IPS" ]]; then
  printf '%s' "$ALLOWED_IPS" | npx wrangler secret put ALLOWED_IPS
  echo "  ALLOWED_IPS uploaded."
fi

if [[ -z "$PROXY_LIST" && -z "$ALLOWED_IPS" ]]; then
  echo "  (no secrets provided — skipped)"
fi

# ── Deploy ────────────────────────────────────────────────────────────────────
echo ""
echo "─── Deploying Worker ───────────────────────────────────────────────────"
npx wrangler deploy

# ── Post-deploy health check ──────────────────────────────────────────────────
WORKER_URL="https://ultimatearbitragehft.zedanazad43.workers.dev"

echo ""
echo "─── Post-deploy checks ─────────────────────────────────────────────────"
echo "  Health endpoint:"
curl -sS --max-time 10 "${WORKER_URL}/health" | head -c 300
echo ""
echo ""
echo "Profile '${PROFILE}' applied successfully."
echo "  PROXY_MODE      = ${PROXY_MODE}"
echo "  DIRECT_EXCHANGES = ${DIRECT_EXCHANGES:-<none>}"
echo ""
echo "Run the following to verify runtime stats:"
echo "  curl -sS -H 'x-admin-token: \$ADMIN_TOKEN' ${WORKER_URL}/api/status | node -e \"process.stdin.setEncoding('utf8');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).proxyRouting||'(no proxyRouting field)'));\""
