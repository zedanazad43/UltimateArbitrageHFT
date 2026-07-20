# Kryll.io Integration: Strategy Optimization & Deployment

**Purpose**: Extend Bitsgap backtesting with Kryll visual strategy builder, optimization, and controlled live deployment.  
**Status**: Ready to integrate  
**Time**: 15–20 minutes

---

## 🤖 What Kryll Adds on Top of Bitsgap

1. **Visual strategy builder**: No-code blocks for arbitrage logic.
2. **Market replay backtesting**: Validation on historical candles/orderbook snapshots.
3. **Optimization runs**: Parameter sweep for profit threshold, size, timeout.
4. **Paper/live bots**: Deploy directly to connected exchanges from validated strategies.
5. **Monitoring & alerts**: Track bot execution, drawdown, and missed opportunities.

---

## 🚀 Quick Setup

### Step 1: Get Kryll API Key

1. Go to: https://kryll.io/dashboard/settings/api
2. Generate API key
3. Add to `.env.local`:
   ```bash
   KRYLL_API_KEY=your_key_here
   ```

### Step 2: Run Kryll Workflow

```bash
npm run kryll:setup
```

**Output**:
```
🤖 Kryll Integration Starting...
✅ Kryll API authenticated
📈 Syncing strategies from Railway HFT...
📤 Uploading strategies to Kryll...
🧪 Running backtests...
🚀 Deploying best strategies...
```

### Step 3: Review Results

Check console for:
- ✅ Backtest profit % and trade count per strategy
- ✅ Win rate and max drawdown
- ✅ Strategy deployment in paper mode

### Step 4: Promote to Live

When satisfied:
```bash
npm run kryll:deploy
```

---

## 📊 Metrics & Thresholds

| Metric | Target |
|--------|--------|
| Profit % | +1% to +3% |
| Win Rate | 75%+ |
| Max Drawdown | <10% |
| Trade Count | 50+ |

---

## 📈 Combined Workflow

```bash
# 1. Bitsgap backtesting
npm run backtest:run

# 2. Kryll optimization + visual backtest
npm run kryll:setup

# 3. Review results

# 4. Paper trade
npm run hummingbot:start:paper

# 5. Live
npm run hummingbot:start
npm run kryll:deploy
```

---

## ⚠️ Troubleshooting

| Issue | Fix |
|-------|-----|
| `KRYLL_API_KEY not set` | Add key to `.env.local` |
| Backtest upload fails | Verify strategy schema format |
| Deploy blocked | Ensure account tier allows live bots |

---

## 🔗 Architecture

```
Railway HFT Engine
       │
       ├─► Bitsgap Integration → Historical backtests + confidence score
       │
       └─► Kryll Integration → Visual strategy builder + optimization + deploy
                 │
                 ▼
          Hummingbot Connector → paper → live
```

---

## ✅ Next Steps

1. Add real `BITSGAP_API_KEY`
2. Add real `KRYLL_API_KEY`
3. Run `npm run backtest:run`
4. Run `npm run kryll:setup`
5. Monitor paper trading before live capital
