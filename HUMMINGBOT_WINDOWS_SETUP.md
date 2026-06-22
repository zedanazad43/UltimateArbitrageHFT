# Hummingbot Setup - Windows 11 (Docker)

**Python Issue**: Your Python 3.14.3 is too new for Hummingbot (needs ≤3.13)  
**Solution**: Use Docker (best for Windows anyway)

---

## ⚡ Quick Start (Docker - 10 minutes)

### Step 1: Install Docker Desktop
Download: https://www.docker.com/products/docker-desktop

After install, verify in PowerShell:
```powershell
docker --version
```

### Step 2: Run Hummingbot Container
```powershell
docker run -it -p 8000:8000 -v hummingbot_data:/root/hummingbot hummingbot/hummingbot:latest
```

This starts Hummingbot in interactive mode.

### Step 3: Configure Exchanges (inside container)
When Hummingbot starts, configure exchanges:

```
>>> connect binance
Enter Binance API key: [PASTE_YOUR_KEY]
Enter Binance secret: [PASTE_YOUR_SECRET]

>>> connect kucoin
[repeat for other exchanges]
```

### Step 4: Start Connector (from your main terminal, NOT in container)
```powershell
npm run hummingbot:start
```

### Step 5: Monitor Trades
```powershell
Get-Content connector.log -Wait
```

---

## 🐳 Docker Approach vs Local

| Aspect | Docker | Local Python |
|--------|--------|--------------|
| Setup Time | 5 min | 30+ min |
| Python Version Issues | ✅ None | ❌ Needs 3.13 |
| Compatibility | ✅ All systems | ❌ Only 3.10-3.13 |
| Performance | ✅ Excellent | ⚠️ Slight overhead |
| Recommended | ✅ YES for Windows | ❌ Linux only |

---

## 🚀 Using Docker (RECOMMENDED)

### Terminal Setup

**Terminal 1** (Hummingbot container):
```powershell
docker run -it -p 8000:8000 -v hummingbot_data:/root/hummingbot hummingbot/hummingbot:latest
```

**Terminal 2** (Your project - connector):
```powershell
cd c:\Users\azadz\UltimateArbitrageHFT
npm run hummingbot:start
```

**Terminal 3** (Monitor logs):
```powershell
Get-Content connector.log -Wait
```

---

## 🔧 Alternative: Downgrade Python (Advanced)

If you prefer local Python instead of Docker:

### Step 1: Install Python 3.13
1. Go to: https://www.python.org/downloads/release/python-3130/
2. Download: Windows installer (64-bit)
3. During install: **CHECK "Add Python to PATH"**

### Step 2: Create Virtual Environment with 3.13
```powershell
py -3.13 -m venv .venv313
.venv313\Scripts\Activate.ps1
```

### Step 3: Install Hummingbot
```powershell
pip install hummingbot
```

### Step 4: Start Hummingbot
```powershell
hummingbot
```

---

## ✅ Success Check

### With Docker:
```powershell
docker ps
# Should show hummingbot container running
```

### Connector Running:
```powershell
npm run hummingbot:status
# Should return connection status
```

### First Trade:
Watch Terminal 3:
```powershell
Get-Content connector.log -Wait
```

Should see:
- ✅ Connected to Hummingbot
- ✅ Fetching opportunities
- ✅ Orders executing

---

## 📊 Expected Output (first 2 minutes)

```
🤖 Hummingbot Auto-Trading Connector Starting...
📡 Initializing Hummingbot connection...
✅ Hummingbot connected
   Mode: paper
   Balance: { BTC: 1.0, USDT: 10000 }

🔍 Monitoring arbitrage opportunities...
📊 Found 3 opportunities
⚡ Executing: BTC/USDT Binance → KuCoin (+0.75%)
✅ Execution queued: hmb-1719097456123
```

---

## 🛑 Common Issues

### "Cannot connect to Docker"
→ Docker Desktop not running
→ Fix: Open Docker Desktop app

### "Port 8000 already in use"
→ Hummingbot container already running
→ Fix: `docker ps` → find container → `docker stop [ID]`

### "Connector can't reach Hummingbot"
→ Container port not exposed
→ Fix: Use `-p 8000:8000` flag (shown above)

### "ECONNREFUSED on localhost:8000"
→ Docker container not running
→ Fix: Start the Docker terminal again

---

## 🎯 Your Setup

**Recommended for you (Windows 11)**:

1. **Install Docker Desktop** (5 min)
2. **Run Hummingbot container** (1 min)
3. **Configure API keys** (5 min)
4. **Start connector** (npm run hummingbot:start)
5. **Monitor** (Get-Content connector.log -Wait)

**Total**: ~15 minutes

---

## 📞 Help

**Docker issues**: https://docs.docker.com/desktop/
**Hummingbot docs**: https://hummingbot.io/
**Your connector logs**: `connector.log` in project root

**Ready?** Run:
```powershell
docker run -it -p 8000:8000 -v hummingbot_data:/root/hummingbot hummingbot/hummingbot:latest
```

Then in another terminal:
```powershell
npm run hummingbot:start
```
