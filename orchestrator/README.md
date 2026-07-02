# Universal Orchestrator

**Token-efficient primary AI agent** for all platforms (CLI, Web, VSCode, GitHub, Cloudflare, Local)

## Features

✅ **Free-only execution** — Uses Ollama (local), CodeGeeX (free), AIMaster (free providers)  
✅ **Aggressive token optimization** — Headroom (20% reserve) + Lean-Context (compression)  
✅ **Intelligent routing** — Selects best agent for task (code, analysis, trading, general)  
✅ **Batch execution** — Prioritizes critical tasks first  
✅ **Health monitoring** — Auto-detects unhealthy agents  
✅ **Graceful degradation** — Falls back when budget tight  

## Quick Start

### 1. CLI (Simplest)

```bash
# Chat request
python3 orchestrator/cli.py chat "Explain arbitrage trading"

# Specialized action
python3 orchestrator/cli.py run-action "analyze market trends"

# Check status
python3 orchestrator/cli.py status

# Batch execute
python3 orchestrator/cli.py batch "task1" "task2" "task3"

# Health check
python3 orchestrator/cli.py health
```

### 2. Python Integration

```python
from aimaster.integrations import AgentOrchestrator

orch = AgentOrchestrator()

# Execute single request
result = orch.ai_master.chat("Your prompt")
print(result.content)

# Get full status
status = orch.health_report()
print(status)
```

### 3. AIMaster Command

```bash
# Start orchestrator as primary agent
python3 aimaster/run.py orchestrator --chat "prompt"

# Check orchestrator status
python3 aimaster/run.py orchestrator --status

# Batch execute
python3 aimaster/run.py orchestrator --batch "task1" "task2"
```

## Architecture

```
┌─ Orchestrator Entry ─────────────────────────────┐
│  CLI / Web / VSCode / GitHub / Cloudflare        │
├──────────────────────────────────────────────────┤
│ Request → Token Manager → Router → Agent Bridge  │
│           (compression)    (routing) (execution) │
├──────────────────────────────────────────────────┤
│ Free Agents: Ollama | CodeGeeX | AIMaster | CLI  │
└──────────────────────────────────────────────────┘
```

## Token Optimization

### Headroom Allocation
- **Total budget**: 100,000 tokens (configurable)
- **Available**: 80% (80,000 tokens)
- **Headroom (emergency reserve)**: 20% (20,000 tokens)
- **Auto-fallback when >95% used**: Switch to CLI only

### Lean-Context Compression
Automatically compresses context by:
- Removing verbose logs
- Removing code examples  
- Compressing URLs
- Collapsing whitespace
- **Target compression ratio**: 30% of original

### Agent Costs
| Agent | Cost | Speed | Best For |
|-------|------|-------|----------|
| Ollama | FREE | Fast | Code, General |
| CodeGeeX | FREE | Fast | Code, Analysis |
| AIMaster | FREE* | Medium | Analysis, Reasoning |
| CLI | FREE | Varies | Commands |
| Arbitrage | FREE | Medium | Trading |

*Uses only free providers (Ollama, CodeGeeX, local DeepSeek)

## Routing Logic

Task type → Best agent selection:

```
Code Tasks        → CodeGeeX → Ollama → CLI
Analysis Tasks    → AIMaster → Ollama → CLI
Trading Tasks     → Arbitrage → AIMaster → CLI
General Tasks     → Ollama → CodeGeeX → CLI
Budget Tight (>80%) → Ollama (free, fast)
Budget Critical (>95%) → CLI only
```

## Configuration

Edit `orchestrator-config.json` to customize:

```json
{
  "orchestration": {
    "token_budget": 100000,      // Total token budget
    "headroom_ratio": 0.2,       // 20% emergency reserve
    "max_context_tokens": 100000, // Max context size
    "auto_fallback": true         // Enable auto-fallback
  },
  "lean_context": {
    "enabled": true,              // Enable compression
    "compression_target": 0.3     // Target 30% of original
  }
}
```

## Examples

### Example 1: Smart Routing Based on Task

```python
from aimaster.integrations import AgentOrchestrator

orch = AgentOrchestrator()

# Code task → automatically uses CodeGeeX
code_result = orch.ai_master.chat("Implement a binary search function")

# Analysis task → automatically uses AIMaster
analysis_result = orch.ai_master.chat("Analyze the arbitrage opportunity")

# Trading task → automatically uses Arbitrage engine
trading_result = orch.arbitrage.analyze("BTCUSDT on Binance vs Kraken")
```

### Example 2: Batch Execution with Priority

```bash
# High priority task (uses best agent)
python3 orchestrator/cli.py chat "CRITICAL: check trading positions"

# Normal task (uses cheaper agent if budget tight)
python3 orchestrator/cli.py chat "What is an exchange rate?"
```

### Example 3: Token-Conscious Execution

```python
# Check budget before executing
orch = AgentOrchestrator()
status = orch.health_report()

if status['token_budget']['used_percent'] > 80:
    # Use cheap agent
    result = orch.ai_master.chat(prompt, provider='ollama')
else:
    # Use best agent
    result = orch.ai_master.chat(prompt)  # auto-selects
```

## Monitoring

### Check Status

```bash
python3 orchestrator/cli.py status
```

Output:
```
📊 Orchestrator Status
============================================================
⏰ Timestamp: 2026-07-02T12:34:56Z
📡 AI Providers: 5 available
   Available: ollama, codegeex, deepseek, codegeex_local, github_copilot
🦙 Ollama: 3 models
📈 Arbitrage: active
📋 Requests processed: 42
============================================================
```

### Health Check

```bash
python3 orchestrator/cli.py health
```

## Platform Support

| Platform | Status | Command |
|----------|--------|---------|
| CLI | ✅ Ready | `python3 orchestrator/cli.py` |
| Web API | ⏳ Coming | Next phase |
| VSCode | ⏳ Coming | Next phase |
| GitHub Actions | ⏳ Coming | Next phase |
| Cloudflare Worker | ⏳ Coming | Next phase |

## Advanced Usage

### Custom Routing

```python
from orchestrator import UniversalRouter, TokenManager

token_mgr = TokenManager(50000)  # 50K token budget
router = UniversalRouter(token_mgr)

decision = router.route({
    "task": "debug this function",
    "context": code_context,
    "priority": "high",
    "agent": "codegeex"  # force agent
})
```

### Token Management

```python
from orchestrator import TokenManager

tokens = TokenManager(100000)

# Compress context
lean = tokens.compressContext(large_context)
print(f"Saved {lean['original_tokens'] - lean['compressed_tokens']} tokens")

# Check budget
if tokens.canFitRequest(5000):
    # execute
else:
    print("Not enough tokens, switch to Ollama")
```

## Troubleshooting

### "Ollama not running"
```bash
# Start ollama
ollama serve
```

### "No AI providers available"
Ensure at least one of these is available:
- Ollama running on localhost:11434
- CodeGeeX server on localhost:8000
- AIMaster with free providers configured

### "Token budget exhausted"
- Reduce `max_context_tokens` in config
- Enable `lean_context` compression
- Use `batch` with priority queue
- Reset budget: `python3 orchestrator/cli.py reset`

## Performance

| Operation | Latency | Token Cost |
|-----------|---------|-----------|
| Simple chat (Ollama) | 100-500ms | 50-200 |
| Analysis (AIMaster) | 500ms-2s | 200-1000 |
| Batch (3 tasks) | 2-5s | 300-800 |

## Next Steps

- [ ] Web API + Dashboard (React)
- [ ] VSCode extension
- [ ] GitHub Actions integration
- [ ] Cloudflare Worker deployment
- [ ] Advanced metrics/monitoring
- [ ] Multi-user session support
- [ ] Persistent state/memory

## Contributing

To add a new agent:
1. Implement in `orchestrator/integration-bridge.ts`
2. Add routing rules to `orchestrator-config.json`
3. Test via CLI: `python3 orchestrator/cli.py`

## License

Same as parent project (UltimateArbitrageHFT)
