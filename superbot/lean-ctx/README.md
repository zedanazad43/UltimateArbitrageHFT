# lean-ctx

Token-lean context tools that let AI agents (local, GitHub Copilot, VS Code, CI)
inspect and control this repository without burning context on junk.

Tools (see `ctx.py`):

| command | what it does |
|---|---|
| `ctx read <path> [--lines N-M] [--budget 4000]` | read a file slice with line numbers, truncated to a token budget |
| `ctx search <pattern> [--glob '*.py'] [--limit 20]` | git-aware search over **tracked** files (no node_modules/.git noise) |
| `ctx tree [--depth 2] [--dir src]` | compact repo structure, depth-limited |
| `ctx shell "<cmd>" [--budget 4000]` | run a shell command, return compressed/truncated output |

Run from repo root:

```bash
python3 lean-ctx/ctx.py tree --depth 2
python3 lean-ctx/ctx.py search "class.*Arbitrage" --glob '*.js' --limit 10
python3 lean-ctx/ctx.py read src/ai-trading-agent.js --lines 1-40
python3 lean-ctx/ctx.py shell "git status --short"
```

The four tool names match `.github/copilot-instructions.md` so GitHub Copilot and
VS Code Chat can invoke them directly. In CI (GitHub Actions) the same CLI is used
by `.github/workflows/agent-run.yml` to give cloud agents lean context.

---

## Agent dispatch map

lean-ctx can dispatch tasks to any agent in the cooperation mesh.
Set env vars before invoking:

```bash
# Route to specific agent
LEAN_CTX_AGENT=hermes    # long/complex tasks
LEAN_CTX_AGENT=merlin    # web research
LEAN_CTX_AGENT=omni      # multi-model routing (OmniRoute/OpenRouter)
LEAN_CTX_AGENT=manus     # browser automation
LEAN_CTX_AGENT=cloudflare # edge inference (Workers AI)
LEAN_CTX_AGENT=ollama    # local, free, no API key
LEAN_CTX_AGENT=auto      # let UniversalRouter decide (default)
```

### Agent capability matrix

| Agent | Best for | Cost | Requires |
|---|---|---|---|
| `hermes` | Long/complex multi-turn tasks | Mixed (free models available) | `HERMES_API_KEY` |
| `merlin` | Live web search + synthesis | Mixed | `MERLIN_API_KEY` |
| `omni` | Multi-model routing | Mixed (free tier) | `OPENROUTER_API_KEY` |
| `manus` | Browser automation | Free (local) | `MANUS_API_KEY` (optional) |
| `cloudflare` | Edge inference, low latency | Free tier | `CLOUDFLARE_AI_GATEWAY_URL` |
| `ollama` | Local inference | Free | Ollama running locally |
| `codegeex` | Code generation | Free tier | `CODEGEEX_API_KEY` |
| `aimaster` | Multi-model analysis | Free | Any above |

### Cooperation flow

```
lean-ctx / Copilot (GitHub MCP)
     │
     ▼
UniversalRouter (agents/router.ts)
     ├──▶ hermes  → OmniRoute/OpenRouter (free models)
     ├──▶ merlin  → live web research
     ├──▶ omni    → openrouter/auto
     ├──▶ manus   → browser automation
     ├──▶ cloudflare → Workers AI (@cf/llama, @cf/mistral)
     └──▶ ollama  → local free inference
```
