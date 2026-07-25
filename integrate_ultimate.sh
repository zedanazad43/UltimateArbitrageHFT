#!/bin/bash
# ============================================================
# UltimateArbitrageHFT — Full Integration Script
# Uses wrangler OAuth token for authentication
# ============================================================

ACCOUNT_ID="652e53f35781522e2745784cc4425d9d"
WORKER="ultimatearbitragehft"

# Get OAuth token from wrangler config
CONFIG_FILE="/c/Users/azadz/.wrangler/config/default.toml"
if [ -f "$CONFIG_FILE" ]; then
  API_TOKEN=$(grep -oP 'oauth_token = "\K[^"]+' "$CONFIG_FILE" 2>/dev/null)
fi

if [ -z "$API_TOKEN" ]; then
  echo "ERROR: Could not find OAuth token in wrangler config"
  echo "Please set CLOUDFLARE_API_TOKEN env var"
  exit 1
fi

API="https://api.cloudflare.com/client/v4"
AUTH="Authorization: Bearer $API_TOKEN"
CT="Content-Type: application/json"

echo "=========================================="
echo "  UltimateArbitrageHFT Integration Script"
echo "=========================================="

# --- STEP 1: List all Workers ---
echo ""
echo "[1/7] Listing all Workers on account..."
WORKERS=$(curl -s -X GET "$API/accounts/$ACCOUNT_ID/workers/scripts?per_page=100" \
  -H "$AUTH" -H "$CT")
echo "$WORKERS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    scripts = data['result']
    print(f'  Found {len(scripts)} Workers:')
    for s in scripts:
        print(f'    - {s[\"id\"]}')
else:
    print('  ERROR:', data.get('errors'))
" 2>/dev/null || echo "  (parse error)"

# --- STEP 2: List all Pages projects ---
echo ""
echo "[2/7] Listing all Pages projects..."
PAGES=$(curl -s -X GET "$API/accounts/$ACCOUNT_ID/pages/projects?per_page=100" \
  -H "$AUTH" -H "$CT")
echo "$PAGES" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    projects = data['result']
    print(f'  Found {len(projects)} Pages projects:')
    for p in projects:
        print(f'    - {p[\"name\"]}  (subdomain: {p.get(\"subdomain\",\"N/A\")})')
else:
    print('  ERROR:', data.get('errors'))
" 2>/dev/null || echo "  (parse error)"

# --- STEP 3: Inspect ultimatearbitragehft current bindings ---
echo ""
echo "[3/7] Inspecting $WORKER current settings/bindings..."
SETTINGS=$(curl -s -X GET "$API/accounts/$ACCOUNT_ID/workers/scripts/$WORKER/settings" \
  -H "$AUTH" -H "$CT")
echo "$SETTINGS" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    r = data['result']
    bindings = r.get('bindings', [])
    print(f'  Current bindings ({len(bindings)}):')
    for b in bindings:
        print(f'    - {b.get(\"name\",\"?\")}  type={b.get(\"type\",\"?\")}')
    routes = r.get('routes', [])
    if routes:
        print(f'  Routes ({len(routes)}):')
        for rt in routes:
            print(f'    - {rt}')
else:
    print('  ERROR:', data.get('errors'))
" 2>/dev/null || echo "  (parse error)"

# --- STEP 4: Add Service Binding for Hermes agent ---
echo ""
echo "[4/7] Adding HERMES_AGENT service binding to $WORKER..."
HERMES_CANDIDATES=("hermes" "hermes-agent" "hermesagent" "HermesAgent")
HERMES_FOUND=""
for candidate in "${HERMES_CANDIDATES[@]}"; do
  CHECK=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API/accounts/$ACCOUNT_ID/workers/scripts/$candidate" \
    -H "$AUTH" -H "$CT")
  if [ "$CHECK" = "200" ]; then
    HERMES_FOUND="$candidate"
    break
  fi
done

if [ -n "$HERMES_FOUND" ]; then
  echo "  Found Hermes Worker: $HERMES_FOUND"
  RESULT=$(curl -s -X PATCH "$API/accounts/$ACCOUNT_ID/workers/scripts/$WORKER/settings" \
    -H "$AUTH" -H "$CT" \
    -d "{\"bindings\":[{\"type\":\"service\",\"name\":\"HERMES_AGENT\",\"service\":\"$HERMES_FOUND\"}]}")
  echo "$RESULT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    print('  ✓ HERMES_AGENT binding added successfully')
else:
    print('  ✗ Binding failed:', data.get('errors'))
" 2>/dev/null || echo "  (check result manually)"
else
  echo "  ⚠ Hermes Worker not found by common names."
  echo "    Tried: ${HERMES_CANDIDATES[*]}"
fi

# --- STEP 5: Add Service Binding for Copilot agent ---
echo ""
echo "[5/7] Adding COPILOT_AGENT service binding to $WORKER..."
COPILOT_CANDIDATES=("copilot" "copilot-agent" "copilotagent" "CopilotAgent")
COPILOT_FOUND=""
for candidate in "${COPILOT_CANDIDATES[@]}"; do
  CHECK=$(curl -s -o /dev/null -w "%{http_code}" -X GET \
    "$API/accounts/$ACCOUNT_ID/workers/scripts/$candidate" \
    -H "$AUTH" -H "$CT")
  if [ "$CHECK" = "200" ]; then
    COPILOT_FOUND="$candidate"
    break
  fi
done

if [ -n "$COPILOT_FOUND" ]; then
  echo "  Found Copilot Worker: $COPILOT_FOUND"
  RESULT=$(curl -s -X PATCH "$API/accounts/$ACCOUNT_ID/workers/scripts/$WORKER/settings" \
    -H "$AUTH" -H "$CT" \
    -d "{\"bindings\":[{\"type\":\"service\",\"name\":\"COPILOT_AGENT\",\"service\":\"$COPILOT_FOUND\"}]}")
  echo "$RESULT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    print('  ✓ COPILOT_AGENT binding added successfully')
else:
    print('  ✗ Binding failed:', data.get('errors'))
" 2>/dev/null || echo "  (check result manually)"
else
  echo "  ⚠ Copilot Worker not found by common names."
  echo "    Tried: ${COPILOT_CANDIDATES[*]}"
fi

# --- STEP 6: Connect Pages project to ultimatearbitragehft ---
echo ""
echo "[6/7] Connecting Pages projects to $WORKER..."
PAGES_NAMES=$(echo "$PAGES" | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data.get('success'):
    for p in data['result']:
        print(p['name'])
" 2>/dev/null)

if [ -n "$PAGES_NAMES" ]; then
  for PAGE_NAME in $PAGES_NAMES; do
    echo "  Pages project: $PAGE_NAME"
    echo "    (Service bindings configured in dashboard → Settings → Functions)"
  done
else
  echo "  No Pages projects found"
fi

# --- STEP 7: Deploy ultimatearbitragehft ---
echo ""
echo "[7/7] Deploying $WORKER via Wrangler..."
cd "/c/Users/azadz/OneDrive/UltimateArbitrageHFT"
npx wrangler deploy 2>&1 | tail -10

# --- SUMMARY ---
echo ""
echo "=========================================="
echo "  Integration Summary"
echo "=========================================="
echo "  Worker:       $WORKER"
echo "  Hermes:       ${HERMES_FOUND:-NOT FOUND}"
echo "  Copilot:      ${COPILOT_FOUND:-NOT FOUND}"
echo "  Account ID:   $ACCOUNT_ID"
echo "  Frontend R2:  ultimate-arbitrage-frontend"
echo "  Bindings:     FRONTEND, TRADE_LOGS, R2, BACKUPS, AIWORKER"
echo "=========================================="