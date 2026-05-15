#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://ultimatearbitragehft.zedanazad43.workers.dev}"
ADMIN_TOKEN_VALUE="${ADMIN_TOKEN:-}"

if [[ -z "${ADMIN_TOKEN_VALUE}" ]]; then
  echo "ERROR: ADMIN_TOKEN is required."
  echo "Usage: ADMIN_TOKEN='<token>' $0 [base_url]"
  exit 1
fi

echo "Checking public endpoints on ${BASE_URL}"

health_code=$(curl -s -o /tmp/prod_health.json -w "%{http_code}" "${BASE_URL}/health")
version_code=$(curl -s -o /tmp/prod_version.json -w "%{http_code}" "${BASE_URL}/api/version")

printf "  /health      -> %s\n" "${health_code}"
printf "  /api/version -> %s\n" "${version_code}"

if [[ "${health_code}" != "200" || "${version_code}" != "200" ]]; then
  echo "ERROR: Public endpoint checks failed"
  exit 1
fi

echo "Checking protected endpoints with admin token"

perf_code=$(curl -s -o /tmp/prod_performance.json -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/performance")
analytics_code=$(curl -s -o /tmp/prod_analytics.json -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/analytics?capital=10000")
api_health_code=$(curl -s -o /tmp/prod_api_health.json -w "%{http_code}" -H "x-admin-token: ${ADMIN_TOKEN_VALUE}" "${BASE_URL}/api/health")

printf "  /api/performance -> %s\n" "${perf_code}"
printf "  /api/analytics   -> %s\n" "${analytics_code}"
printf "  /api/health      -> %s\n" "${api_health_code}"

if [[ "${perf_code}" != "200" || "${analytics_code}" != "200" || "${api_health_code}" != "200" ]]; then
  echo "ERROR: One or more protected endpoint checks failed"
  echo "Hint: verify ADMIN_TOKEN value matches Cloudflare Worker secret"
  exit 1
fi

echo "All production endpoint checks passed"
