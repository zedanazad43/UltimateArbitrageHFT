#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://ultimatearbitragehft.zedanazad43.workers.dev}"
ADMIN_TOKEN_VALUE="${ADMIN_TOKEN:-}"
TMP_ROOT="${TMPDIR:-/tmp}"

health_out="${TMP_ROOT}/prod_health.json"
version_out="${TMP_ROOT}/prod_version.json"
dashboard_out="${TMP_ROOT}/prod_dashboard.html"
perf_out="${TMP_ROOT}/prod_performance.json"
analytics_out="${TMP_ROOT}/prod_analytics.json"
api_health_out="${TMP_ROOT}/prod_api_health.json"
platforms_out="${TMP_ROOT}/prod_platforms.json"
exec_health_out="${TMP_ROOT}/prod_exec_health.json"
balances_out="${TMP_ROOT}/prod_balances.json"
status_out="${TMP_ROOT}/prod_status.json"
proxy_stats_out="${TMP_ROOT}/prod_proxy_stats.json"

if [[ -z "${ADMIN_TOKEN_VALUE}" ]]; then
  echo "ERROR: ADMIN_TOKEN is required."
  echo "Usage: ADMIN_TOKEN='<token>' $0 [base_url]"
  exit 1
fi

echo "Checking public endpoints on ${BASE_URL}"

health_code=$(curl -s -o "${health_out}" -w "%{http_code}" "${BASE_URL}/health")
version_code=$(curl -s -o "${version_out}" -w "%{http_code}" "${BASE_URL}/api/version")
dashboard_code=$(curl -s -o "${dashboard_out}" -w "%{http_code}" "${BASE_URL}/dashboard")

printf "  /health      -> %s\n" "${health_code}"
printf "  /api/version -> %s\n" "${version_code}"
printf "  /dashboard   -> %s\n" "${dashboard_code}"

if [[ "${health_code}" != "200" || "${version_code}" != "200" ]]; then
  echo "ERROR: Public endpoint checks failed"
  exit 1
fi

if [[ "${dashboard_code}" != "200" && "${dashboard_code}" != "302" ]]; then
  echo "ERROR: /dashboard expected 200 or 302, got ${dashboard_code}"
  exit 1
fi

if [[ "${dashboard_code}" == "200" ]]; then
  echo "Checking dashboard platform markers"
  if ! grep -q 'id="platformsGrid"' "${dashboard_out}"; then
    echo "ERROR: dashboard does not contain platformsGrid marker"
    exit 1
  fi
  if ! grep -q 'id="platformModal"' "${dashboard_out}"; then
    echo "ERROR: dashboard does not contain platformModal marker"
    exit 1
  fi
  if ! grep -q 'setInterval(() => loadPlatformsGrid(), PLATFORM_REFRESH_MS)' "${dashboard_out}"; then
    echo "ERROR: dashboard does not contain platforms auto-refresh marker"
    exit 1
  fi
else
  echo "Skipping dashboard marker checks (302 redirect to auth is expected in production)"
fi

echo "Checking protected endpoints with admin token"

perf_code=$(curl -s -o "${perf_out}" -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/performance")
analytics_code=$(curl -s -o "${analytics_out}" -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/analytics?capital=10000")
api_health_code=$(curl -s -o "${api_health_out}" -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/health")
platforms_code=$(curl -s -o "${platforms_out}" -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/platforms")
exec_health_code=$(curl -s -o "${exec_health_out}" -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/execution-health")
balances_code=$(curl -s -o "${balances_out}" -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/balances")
status_code=$(curl -s -o "${status_out}" -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/status")
proxy_stats_code=$(curl -s -o "${proxy_stats_out}" -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/proxy-stats")

printf "  /api/performance     -> %s\n" "${perf_code}"
printf "  /api/analytics       -> %s\n" "${analytics_code}"
printf "  /api/health          -> %s\n" "${api_health_code}"
printf "  /api/platforms       -> %s\n" "${platforms_code}"
printf "  /api/execution-health-> %s\n" "${exec_health_code}"
printf "  /api/balances        -> %s\n" "${balances_code}"
printf "  /api/status          -> %s\n" "${status_code}"
printf "  /api/proxy-stats     -> %s\n" "${proxy_stats_code}"

if [[ "${perf_code}" != "200" || "${analytics_code}" != "200" || "${api_health_code}" != "200" || "${platforms_code}" != "200" ]]; then
  echo "ERROR: One or more core protected endpoint checks failed"
  echo "Hint: verify ADMIN_TOKEN value matches Cloudflare Worker secret"
  exit 1
fi

if [[ "${exec_health_code}" != "200" ]]; then
  echo "WARNING: /api/execution-health returned ${exec_health_code} (MEXC credentials may be missing)"
fi

if [[ "${balances_code}" != "200" ]]; then
  echo "WARNING: /api/balances returned ${balances_code}"
fi

if [[ "${status_code}" != "200" ]]; then
  echo "ERROR: /api/status returned ${status_code}"
  exit 1
fi

if [[ "${proxy_stats_code}" != "200" ]]; then
  echo "WARNING: /api/proxy-stats returned ${proxy_stats_code}"
fi

echo "Checking /api/platforms response shape"
if ! grep -q '"success"' "${platforms_out}"; then
  echo "ERROR: /api/platforms missing success field"
  exit 1
fi
if ! grep -q '"platforms"' "${platforms_out}"; then
  echo "ERROR: /api/platforms missing platforms field"
  exit 1
fi
if ! grep -q '"metamask"' "${platforms_out}"; then
  echo "ERROR: /api/platforms missing metamask entry"
  exit 1
fi

echo "Checking /api/proxy-stats response shape"
if [[ "${proxy_stats_code}" == "200" ]]; then
  if ! grep -q '"proxyRouting"' "${proxy_stats_out}"; then
    echo "ERROR: /api/proxy-stats missing proxyRouting field"
    exit 1
  fi
  if ! grep -q '"success"' "${proxy_stats_out}"; then
    echo "ERROR: /api/proxy-stats missing success field"
    exit 1
  fi
fi

echo "All production endpoint checks passed"
