# Hummingbot Auto-Trading Setup Guide

**Status**: Ready to execute  
**Time**: 20-30 minutes  
**Integration**: Railway HFT Engine + Geo-Bypass Proxies

---

## 🚀 Quick Start

```bash
# 1. Install Hummingbot (if not already installed)
pip install hummingbot

# 2. Configure exchanges
hummingbot

# 3. Start the connector
node hummingbot-connector.js
```

---

## 📋 Pre-Requirements

### Exchange Accounts (create if needed)
- ✅ Binance (primary)
- ✅ KuCoin (secondary)
- ✅ Bybit (secondary)
- ✅ Gate.io (secondary)
- ✅ MEXC (tertiary)

### API Keys Setup

For each exchange, get these from your account settings:
- **Binance**: https://www.binance.com/en/my/settings/api-management
- **KuCoin**: https://www.kucoin.com/account/api
- **Bybit**: https://www.bybit.com/en-US/user-service/settings/api
- **Gate.io**: https://www.gate.io/myaccount/apimanagement
- **MEXC**: https://www.mexc.com/user/account/api

**API Key Scope**: Must allow:
- ✓ Trading (place/cancel orders)
- ✓ Read balance
- ✓ **DO NOT grant withdraw permissions**

---

## 🔧 Step 1: Install Hummingbot

### macOS/Linux
```bash
# Install Hummingbot
pip install hummingbot

# Verify installation
hummingbot --version
```

### Windows
```powershell
# Install Hummingbot
pip install hummingbot

# Or use Docker (recommended for Windows)
docker pull hummingbot/hummingbot:latest
docker run -it hummingbot/hummingbot:latest
```

---

## 🔐 Step 2: Configure Exchanges in Hummingbot

```bash
hummingbot
```

When prompted, select **"Create a new account"** and configure:

```
? Choose connector [binance/kucoin/bybit/gate/mexc]: binance
? Enter your Binance API key: [PASTE_YOUR_KEY]
? Enter your Binance secret key: [PASTE_YOUR_SECRET]
? Is your Binance testnet enabled? [Y/n]: n
```

Repeat for each exchange.

### Verify connections
```
>>> connect binance
>>> get_balance
>>> get_mid_price BTC/USDT
```

---

## ⚙️ Step 3: Environment Variables

Create `.env.hummingbot` in project root:

```bash
# Hummingbot Configuration
HUMMINGBOT_API_URL=http://localhost:8000
HUMMINGBOT_CONNECTOR_URL=ws://localhost:8001

# Railway HFT Engine
HFT_ENGINE_URL=https://ultimatearbitragehft-production.up.railway.app

# Geo-Bypass Worker
GEO_BYPASS_WORKER_URL=https://ultimatearbitragehft.zedanazad43.workers.dev

# Oxylabs Proxy (for Hummingbot requests)
OXYLABS_USER=zedanazad43_yWbQ8
OXYLABS_PASSWORD=R4bBBvt_1vg38Lyk

# Telegram Alerts (optional)
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here
```

---

## 🎯 Step 4: Start Trading

### Option A: Headless mode (Recommended for production)

```bash
# Terminal 1: Start Hummingbot API
hummingbot --strategy arbitrage_hft_executor --no-ui

# Terminal 2: Start connector
node hummingbot-connector.js
```

### Option B: Interactive mode (Development)

```bash
# Start Hummingbot normally
hummingbot

# In another terminal
node hummingbot-connector.js
```

---

## 📊 Monitoring

### Check connector status
```bash
curl http://localhost:3000/status
```

### View live trades
```bash
# Tail connector logs
tail -f connector.log
```

### Monitor profitability
```bash
# Get daily PnL
curl https://ultimatearbitragehft.zedanazad43.workers.dev/hft/analytics/daily-pnl
```

---

## 🛡️ Safety Features

### Automatic Risk Limits
- **Max concurrent orders**: 5
- **Max daily volume**: $100
- **Max single order**: $10
- **Daily loss limit**: -$500 (stops trading)

### Circuit Breaker
- Stops trading if 3 consecutive losses
- Pause 30 minutes before retry
- Manual override available

### Geo-Bypass Failover
- Primary: Oxylabs proxy
- Secondary: Cloudflare Tunnel (us-bypass)
- Automatic rotation on failure

---

## 🔍 Troubleshooting

### "Cannot connect to Hummingbot"
```bash
# Verify Hummingbot is running
ps aux | grep hummingbot

# Restart if needed
hummingbot
```

### "Exchange connection failed"
- Verify API keys in Hummingbot settings
- Check API key has correct permissions
- Try: `>>> connect [exchange]`

### "No opportunities detected"
- Check geo-bypass is active: `curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report`
- Verify Railway HFT is running: `npm run verify:infra`
- Check market conditions (low volatility = fewer opportunities)

### "Rate limited / 429 errors"
- Increase polling interval in connector (currently 5s)
- Add more delays between orders
- Check proxy rotation is working

---

## 📈 Performance Optimization

### Increase profitability

**Lower minimum profit threshold** (if risk tolerance allows):
```javascript
// In hummingbot-strategy-config.js
minProfitMargin: 0.25,  // Lower from 0.5%
```

**Increase order frequency**:
```javascript
POLLING_INTERVAL: 2000,  // Lower from 5000ms
```

**Add more trading pairs**:
```javascript
tradingPairs: [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'ADA/USDT',
  'DOGE/USDT', 'MATIC/USDT', 'AVAX/USDT', 'LINK/USDT', 'UNI/USDT'
]
```

---

## 🚀 Next Steps

1. **Start with paper trading**:
   ```bash
   TRADING_MODE=paper node hummingbot-connector.js
   ```

2. **Monitor for 1-2 hours** to verify:
   - Opportunities detected ✓
   - Orders executing correctly ✓
   - No errors or warnings ✓

3. **Switch to live trading**:
   ```bash
   TRADING_MODE=live node hummingbot-connector.js
   ```

4. **Set up monitoring**:
   - Telegram alerts
   - Daily PnL reports
   - Performance dashboard

---

## 📞 Support

- **Hummingbot Docs**: https://hummingbot.io/
- **Railway HFT**: `npm run monitor:critical`
- **Geo-Bypass Health**: `curl https://ultimatearbitragehft.zedanazad43.workers.dev/geo-bypass/report`
- **Logs**: Check `connector.log` and `hummingbot.log`

---

## ✅ Success Indicators

After 1 hour of trading, you should see:
- ✅ Multiple opportunities detected (5+)
- ✅ Orders executing across exchanges
- ✅ Positive PnL accumulating
- ✅ No rate limit errors
- ✅ Geo-bypass active on all requests
- ✅ Average profit per trade > $0.50

---

## 🎯 Performance Targets

| Metric | Target | Frequency |
|--------|--------|-----------|
| Daily Profit | $50-100 | Per 8h session |
| Win Rate | 75%+ | Ongoing |
| Avg Trade Profit | $1-5 | Per trade |
| Max Drawdown | < 10% | Monthly |
| Uptime | 99%+ | Continuous |
