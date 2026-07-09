# HFT Live Trading — Phase 3 Handoff

**Status:** Engine is **LIVE** and running. Real funds at risk.

## Current run

| Field | Value |
|---|---|
| PID | 1930 (bash job) — actual Windows PID may differ; use `tasklist | findstr hft-engine` |
| Binary | `hft/hft-engine.exe` |
| Log file | `hft/phase3-live.log` |
| Working dir | `c:\Users\azadz\UltimateArbitrageHFT\hft` |
| Mode | `paper=false trading=true` |
| Equity | `$100.00` (start) |
| Live venues | **MEXC + Binance only** (Go engine `executeLive` switch limit) |
| Excluded | Bybit, Bitget, HTX, KuCoin, Bitmart, Coinbase |
| Started | 2026-06-21 09:19:02 local |
| 5-min check | 686 scans, 0 trades, 0 errors, equity intact |

## Kill switch (use any of these)

```bash
# Windows
tasklist | findstr hft-engine
taskkill /F /IM hft-engine.exe

# Verify down
curl http://localhost:8080/api/health   # should refuse connection
```

## Monitoring

```bash
curl http://localhost:8080/api/health                  # equity, dailyPnL, trades
curl http://localhost:9090/metrics | grep hft_trades   # trade counters
tail -f hft/phase3-live.log                            # live log
```

Telegram alerts fire to chat `1771005847` on every trade and engine start/stop.

## Safety gates in force

- `MAX_DAILY_LOSS_USD=10` → engine auto-stops trading at $10 loss
- `MIN_NET_PROFIT_PCT=0.15` → only edges ≥0.15% net trigger orders
- `INITIAL_CAPITAL_USD=100` → position sizing pinned to $100 base
- `MAX_PER_TRADE_LOSS_PCT=0.02` → per-trade stop at 2%

## Scaling (manual — do not automate)

Edit `hft/.env`, then restart binary:

| Target | INITIAL_CAPITAL_USD | MAX_DAILY_LOSS_USD |
|---|---|---|
| Step up #1 | 250 | 25 |
| Step up #2 | 1000 | 50 |
| Production | 5000 | 100 |

Wait minimum **24h** between scale-ups; confirm positive daily P&L and no incidents.

## 24/7 hosting (Railway)

```bash
railway login
railway link
# Set env vars in Railway dashboard (do NOT commit .env)
railway up --detach
railway domain
```

**⚠️ Gotcha:** `hft/Dockerfile` defaults to `PAPER_TRADING=false TRADING_ENABLED=true`. Any Railway/Docker deploy goes **live immediately**. Set env vars in dashboard before first push.

## Known limitations (carry-over from plan)

1. **Bitget / HTX selected by user → not executable.** Go engine `executeLive` (`hft/cmd/hft/main.go:296-352`) only has cases for mexc/binance/bybit. Adding Bitget/HTX requires source changes (new case branches + executor implementations).
2. **JS orchestrator runs separately.** It has Bitget in its allowlist but executes via Cloudflare Worker, not via this binary.
3. **PostgreSQL warning is benign** — trade logging disabled; engine runs fine without it. To enable: start Postgres at `localhost:5432` user/db `hft`.

## Incident response

1. `taskkill /F /IM hft-engine.exe`
2. Check MEXC + Binance web UIs for open orders / positions; cancel/close manually if any
3. `grep -E "ERROR|trade.*mode=live" hft/phase3-live.log`
4. Verify exchange balances vs. expected $100 ± P&L

## Files written this session

- `hft/.env` (gitignored, contains real keys — do not commit)
- `hft/phase3-live.log` (engine log)
- `hft/phase3.pid` (bash job marker)
- `PHASE3-LIVE-HANDOFF.md` (this file)
