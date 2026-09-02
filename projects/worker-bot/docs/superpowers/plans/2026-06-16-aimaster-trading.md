# AIMaster Trading Integration — Design Doc

> **Status:** Approved 2026-06-16
> **Goal:** Route trading decisions through AIMaster (DeepSeek) for AI-powered strategy execution

## Current State
- AIMaster has 144 skills loaded but is completely disconnected from trading
- src/strategies/auto-executor.js uses static logic (threshold-based)
- src/self-evaluation.js uses basic heuristic evaluation
- src/routes/ai-routes.js uses Workers AI (@cf/meta/llama) — not AIMaster

## Design

### Architecture
`
Worker cron  ──> orchestrator.js  ──> auto-executor.js
                     │                      │
                     ▼                      ▼
              AIMaster.chat()         skill: trading-analysis
              (via DeepSeek)          + market data context
`

### Three Integration Points

#### 1. /api/ai/aimaster/strategy (NEW)
- POST endpoint that accepts market data snapshot
- Routes to AIMaster with 	rading-analysis skill prompt
- Returns AI-generated trading recommendation
- File: src/routes/aimaster-routes.js (NEW)

#### 2. Auto-Executor AI Mode
- Add env var AI_EXECUTOR_MODE=on to toggle AI-powered execution
- When on, uto-executor.js calls AIMaster before executing
- AIMaster analyzes opportunities and returns execute/skip decisions
- File: src/strategies/auto-executor.js (MODIFY)

#### 3. Self-Evaluation via AIMaster
- Replace heuristic evaluation with AI analysis
- Every N cycles, send recent trades + PnL to AIMaster
- Get strategy adjustment recommendations
- File: src/self-evaluation.js (MODIFY)

### Files
- Create: src/routes/aimaster-routes.js — new AI strategy endpoint
- Create: src/aimaster-bridge.js — JS wrapper for calling AIMaster Python
- Create: scripts/aimaster-strategy-server.js — local server for AIMaster calls
- Modify: src/strategies/auto-executor.js — add AI executor mode
- Modify: src/self-evaluation.js — AI-powered evaluation
- Modify: index.js — register new routes
