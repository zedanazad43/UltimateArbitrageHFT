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
