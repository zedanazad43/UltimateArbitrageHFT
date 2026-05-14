# CodeGeeX Local Setup Guide

## Overview

This guide enables local CodeGeeX deployment via Ollama (cross-platform) or vLLM (Linux/WSL2). 
The setup integrates with [official CodeGeeX local mode](https://zhipu-ai.feishu.cn/wiki/space/7304237817729810433) 
and provides additional production-grade features: auto-backend detection, extended timeouts, and graceful fallbacks.

> **Platform notes:** 
> - **Windows (recommended):** Use Ollama backend (native Windows support, no WSL required)
> - **macOS/Linux:** Use vLLM (GPU support, faster inference) or Ollama
> - **WSL2 Ubuntu:** Use vLLM (better performance than Windows native)

## Windows Fast Path (Ollama backend)

1. Start Ollama server (keep running in background):

```powershell
$env:OLLAMA_ORIGINS = "*"  # Enable cross-origin requests (required for IDE integration)
ollama serve
```

2. In another terminal, pull the model once:

```powershell
ollama pull codegeex4
```

3. Start the local API bridge:

```powershell
.\start-codegeex-server.ps1
```

4. Use local backend in app terminal:

```powershell
$env:AI_BACKEND = "local"
$env:LOCAL_AI_ENDPOINT = "http://localhost:8000"
```

The bridge auto-selects available backend in this order: `vLLM` → `Ollama`.

### 1️⃣ Start the CodeGeeX Server
```powershell
# Terminal 1: Start the server (takes 5-10 min on first run)
.\start-codegeex-server.ps1
```

⏳ **First run will download the CodeGeeX model (9.2 GB)**
✓ You should see: `Starting CodeGeeX server on 127.0.0.1:8000`

**What this does:**
- Detects available backend (vLLM or Ollama)
- Wraps the model in an OpenAI-compatible API bridge
- Handles extended timeouts for CPU-based inference
- Provides unified interface for application code

### 2️⃣ Set Environment Variable
```powershell
# Terminal 2: Set the environment variable
$env:AI_BACKEND = "local"
```

Or create a `.env.local` file in the project root:
```
AI_BACKEND=local
LOCAL_AI_ENDPOINT=http://localhost:8000
```

### 3️⃣ Start Your HFT Application
```powershell
# Terminal 2: Start the app
npm start
# or your normal startup command
```

---

## System Requirements

| Component | Requirement |
|-----------|-----------|
| **CPU** | 4+ cores recommended |
| **RAM** | 16+ GB minimum (24+ GB recommended) |
| **Storage** | 12+ GB free (for model download) |
| **GPU** | Optional but recommended (NVIDIA/CUDA) |

### Recommended Python Version

- Python 3.10 to 3.12 for vLLM compatibility
- Avoid Python 3.14 for this stack

---

## Windows + WSL2 Setup (recommended)

1. Install or enable WSL2 Ubuntu.
2. Open Ubuntu and run:

```bash
sudo apt update
sudo apt install -y python3.11 python3.11-venv python3-pip build-essential
python3.11 -m venv ~/codegeex-venv
source ~/codegeex-venv/bin/activate
pip install --upgrade pip
pip install vllm flask requests
```

3. From Ubuntu, run the server from your repo path:

```bash
cd /mnt/c/Users/azadz/OneDrive/UltimateArbitrageHFT
python codegeex-server.py
```

4. In PowerShell (your app terminal), keep:

```powershell
$env:AI_BACKEND = "local"
$env:LOCAL_AI_ENDPOINT = "http://localhost:8000"
```

---

## API Endpoints

Once the server is running, it exposes OpenAI-compatible endpoints:

### Health Check
```bash
curl http://localhost:8000/health
```

### Chat Completions (used by ai-client.js)
```bash
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "max_tokens": 100,
    "temperature": 0.7
  }'
```

### Text Completions
```bash
curl -X POST http://localhost:8000/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Hello!",
    "max_tokens": 100,
    "temperature": 0.7
  }'
```

---

## Troubleshooting

### ❌ "Connection refused" or "Connection error"
- Ensure the server is running in Terminal 1
- Check `http://localhost:8000/health` in browser
- Verify port 8000 is not blocked by firewall

### ❌ "Model not loaded" error
- Server may still be downloading the model (check Terminal 1 logs)
- Wait 5-10 minutes for first-time startup
- Check disk space: `Get-Volume` in PowerShell
- Ensure `vllm` imports in the same Python runtime used by the server
- On Windows, prefer WSL2 Ubuntu if native install fails

### ❌ "Out of Memory" error
- Your system doesn't have enough RAM
- Close other applications
- Consider upgrading to 24+ GB RAM

### ❌ Slow inference (>15 seconds per query)
- You're using CPU inference (GPU recommended)
- Install CUDA: https://developer.nvidia.com/cuda-downloads
- Verify GPU support: `python -c "import torch; print(torch.cuda.is_available())"`

---

## Switching Between Backends

### To use **Cloudflare Workers AI** (remote):
```powershell
$env:AI_BACKEND = "cloudflare"  # or just unset it (default)
```

### To use **Local CodeGeeX**:
```powershell
$env:AI_BACKEND = "local"
```

---

## Advanced Configuration

Edit `codegeex-server.py` to customize:

| Setting | Default | Purpose |
|---------|---------|---------|
| `MODEL_NAME` | `THUDM/codegeex4-all-9b` | Model identifier |
| `PORT` | `8000` | Server port |
| `MAX_TOKENS` | `512` | Maximum response length |
| `TEMPERATURE` | `0.7` | Creativity level (0.0-1.0) |
| `gpu_memory_utilization` | `0.8` | GPU usage percentage |

### Example: Use a smaller/faster model
```python
MODEL_NAME = "THUDM/codegeex4-all-1b"  # Smaller & faster (1B instead of 9B)
```

---

## Performance Tips

1. **Use GPU**: Install CUDA for 10x+ speedup
2. **Reduce model size**: Switch to `codegeex4-all-1b` (1B) vs 9B
3. **Cache responses**: Your orchestrator can cache AI decisions
4. **Batch requests**: Send multiple requests in parallel

---

## Monitoring

Check server logs:
```powershell
# Terminal 1 shows:
# - Model loading progress
# - Requests processed
# - Memory usage
# - Any errors
```

View real-time usage:
```bash
curl http://localhost:8000/health -w "\n"
```

---

## Next Steps

- ✅ Run `.\start-codegeex-server.ps1` to start the server
- ✅ Set `$env:AI_BACKEND = "local"` in your app terminal
- ✅ Start your HFT application
- ✅ Monitor logs and verify AI decisions are being made

Questions? Check `/src/ai-client.js` for the integration logic.

---

## Official CodeGeeX Local Mode

This setup implements the [official CodeGeeX local mode workflow](https://zhipu-ai.feishu.cn/wiki/space/7304237817729810433):

| Official Step | This Repo Implementation |
|---|---|
| Download IDE extension (VS Code/JetBrains) | Use `codegeex-server.py` bridge as custom endpoint |
| Enable local mode in extension settings | Point extension to `http://localhost:8000` |
| Start Ollama server (keep running) | ✅ `ollama serve` (with `OLLAMA_ORIGINS="*"`) |
| Enter API address + model name | ✅ Automatic via bridge auto-detection |

**Key enhancement:** This repo's bridge adds production features:
- ✅ Auto-detect backend (vLLM or Ollama)
- ✅ Extended timeouts for CPU inference
- ✅ Graceful fallback to cloud/heuristic
- ✅ Application-level AI integration (`src/ai-client.js`)

You can use **either** approach:
- **Official CLI-based workflow:** Follow Zhipu AI tutorial for VS Code/JetBrains IDE integration
- **Application-level integration:** Use `npm start` with `AI_BACKEND=local` to leverage app-level AI decisions
