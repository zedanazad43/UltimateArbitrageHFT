#!/usr/bin/env bash
# skills.sh — unified skill dispatcher for UltimateArbitrageHFT agents
# Usage: skills.sh <skill> [args...]
# Free-first: lean-ctx / local wrangler dry-run / Ollama tried before any paid API.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEAN_CTX="${REPO_ROOT}/lean-ctx/ctx.py"
SKILLS_DIR="${REPO_ROOT}/agents/skills"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
_lean() { python3 "$LEAN_CTX" "$@"; }

_require_lean() {
  if [[ ! -f "$LEAN_CTX" ]]; then
    echo "ERROR: lean-ctx not found at $LEAN_CTX" >&2
    exit 1
  fi
}

_list_skills() {
  cat <<'EOF'
Available skills:
  build-check   — wrangler deploy --dry-run (safe, no deploy)
  deploy        — wrangler deploy (full deploy, requires CLOUDFLARE_API_TOKEN)
  tail          — wrangler tail (live log stream)
  kv-get        — wrangler kv:key get <namespace> <key>
  kv-put        — wrangler kv:key put <namespace> <key> <value>
  d1-query      — wrangler d1 execute <db> --command <sql>
  secret-put    — wrangler secret put <name>
  lint          — eslint (free, local)
  test          — npm test (free, local)
  agent-status  — print active agent env vars
  hermes-start  — start Hermes gateway (local)
  hermes-stop   — stop Hermes gateway (local)
  lean-read     — lean-ctx read <path>
  lean-search   — lean-ctx search <pattern>
  lean-tree     — lean-ctx tree [path]
  lean-shell    — lean-ctx shell <cmd>
  mcp-serve     — run as MCP stdio server (for .mcp.json wiring)
EOF
}

# ---------------------------------------------------------------------------
# MCP stdio server mode
# ---------------------------------------------------------------------------
_mcp_serve() {
  # Minimal JSON-RPC 2.0 stdio loop that exposes every skill as a tool.
  python3 - <<'PYEOF'
import sys, json, subprocess, os

REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
SKILLS_SH  = os.path.join(REPO_ROOT, "skills.sh")

TOOLS = [
    {"name": "build-check",  "description": "wrangler deploy --dry-run",             "inputSchema": {"type": "object", "properties": {}}},
    {"name": "deploy",       "description": "wrangler deploy (full deploy)",          "inputSchema": {"type": "object", "properties": {}}},
    {"name": "lint",         "description": "eslint (free, local)",                   "inputSchema": {"type": "object", "properties": {}}},
    {"name": "test",         "description": "npm test (free, local)",                 "inputSchema": {"type": "object", "properties": {}}},
    {"name": "lean-read",    "description": "lean-ctx read <path>",                   "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}},
    {"name": "lean-search",  "description": "lean-ctx search <pattern>",              "inputSchema": {"type": "object", "properties": {"pattern": {"type": "string"}}, "required": ["pattern"]}},
    {"name": "lean-tree",    "description": "lean-ctx tree [path]",                   "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}}}},
    {"name": "lean-shell",   "description": "lean-ctx shell <cmd>",                   "inputSchema": {"type": "object", "properties": {"cmd": {"type": "string"}}, "required": ["cmd"]}},
    {"name": "agent-status", "description": "print active agent env vars",            "inputSchema": {"type": "object", "properties": {}}},
    {"name": "hermes-start", "description": "start Hermes gateway",                   "inputSchema": {"type": "object", "properties": {}}},
    {"name": "hermes-stop",  "description": "stop Hermes gateway",                    "inputSchema": {"type": "object", "properties": {}}},
]

def run_skill(name, args):
    cmd = ["bash", SKILLS_SH, name] + [str(v) for v in args.values()]
    r = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO_ROOT)
    return (r.stdout + r.stderr).strip()

def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except json.JSONDecodeError:
        continue
    rid  = req.get("id")
    meth = req.get("method", "")

    if meth == "initialize":
        send({"jsonrpc":"2.0","id":rid,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"skills","version":"1.0.0"}}})
    elif meth == "tools/list":
        send({"jsonrpc":"2.0","id":rid,"result":{"tools":TOOLS}})
    elif meth == "tools/call":
        p    = req.get("params", {})
        name = p.get("name","")
        iargs= p.get("arguments", {})
        out  = run_skill(name, iargs)
        send({"jsonrpc":"2.0","id":rid,"result":{"content":[{"type":"text","text":out}]}})
    elif rid is not None:
        send({"jsonrpc":"2.0","id":rid,"error":{"code":-32601,"message":"Method not found"}})
PYEOF
}

# ---------------------------------------------------------------------------
# individual skills
# ---------------------------------------------------------------------------
skill_build_check() {
  cd "$REPO_ROOT"
  npx wrangler deploy --dry-run 2>&1
}

skill_deploy() {
  cd "$REPO_ROOT"
  npx wrangler deploy 2>&1
}

skill_tail() {
  cd "$REPO_ROOT"
  npx wrangler tail "$@" 2>&1
}

skill_kv_get() {
  cd "$REPO_ROOT"
  npx wrangler kv:key get --namespace-id="$1" "$2" 2>&1
}

skill_kv_put() {
  cd "$REPO_ROOT"
  npx wrangler kv:key put --namespace-id="$1" "$2" "$3" 2>&1
}

skill_d1_query() {
  cd "$REPO_ROOT"
  npx wrangler d1 execute "$1" --command "$2" 2>&1
}

skill_secret_put() {
  cd "$REPO_ROOT"
  npx wrangler secret put "$1" 2>&1
}

skill_lint() {
  cd "$REPO_ROOT"
  npx eslint . 2>&1
}

skill_test() {
  cd "$REPO_ROOT"
  npm test 2>&1
}

skill_agent_status() {
  echo "=== Agent env (sanitized) ==="
  for v in HERMES_SKILLS_DIR LEAN_CTX_PATH OPENROUTER_API_KEY CLOUDFLARE_API_TOKEN \
            CLOUDFLARE_ACCOUNT_ID TELEGRAM_TOKEN OLLAMA_HOST; do
    val="${!v:-<unset>}"
    # mask secrets — show only first 4 chars
    if [[ "$v" == *TOKEN* || "$v" == *KEY* || "$v" == *SECRET* ]]; then
      val="${val:0:4}****"
    fi
    echo "  $v=$val"
  done
}

skill_hermes_start() {
  echo "Starting Hermes gateway..."
  hermes gateway &
  echo "Hermes started (PID $!)"
}

skill_hermes_stop() {
  echo "Stopping Hermes gateway..."
  hermes gateway stop 2>/dev/null || true
  pkill -f "hermes.*gateway" 2>/dev/null || true
  echo "Done."
}

skill_lean_read() {
  _require_lean
  _lean read "$@"
}

skill_lean_search() {
  _require_lean
  _lean search "$@"
}

skill_lean_tree() {
  _require_lean
  _lean tree "${1:-.}"
}

skill_lean_shell() {
  _require_lean
  _lean shell "$@"
}

# ---------------------------------------------------------------------------
# dispatch
# ---------------------------------------------------------------------------
SKILL="${1:-}"
shift || true

case "$SKILL" in
  --list|-l|"")    _list_skills ;;
  mcp-serve)       _mcp_serve ;;
  build-check)     skill_build_check "$@" ;;
  deploy)          skill_deploy "$@" ;;
  tail)            skill_tail "$@" ;;
  kv-get)          skill_kv_get "$@" ;;
  kv-put)          skill_kv_put "$@" ;;
  d1-query)        skill_d1_query "$@" ;;
  secret-put)      skill_secret_put "$@" ;;
  lint)            skill_lint "$@" ;;
  test)            skill_test "$@" ;;
  agent-status)    skill_agent_status ;;
  hermes-start)    skill_hermes_start ;;
  hermes-stop)     skill_hermes_stop ;;
  lean-read)       skill_lean_read "$@" ;;
  lean-search)     skill_lean_search "$@" ;;
  lean-tree)       skill_lean_tree "$@" ;;
  lean-shell)      skill_lean_shell "$@" ;;
  *)
    echo "ERROR: unknown skill '$SKILL'" >&2
    _list_skills >&2
    exit 1
    ;;
esac
