# Start CodeGeeX Local Server
# Usage: .\start-codegeex-server.ps1

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  CodeGeeX Local Server Startup" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Set working directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

# Check if Python is available
$venvPython = Join-Path $scriptDir ".venv\Scripts\python.exe"
if (Test-Path $venvPython) {
    $pythonCmd = $venvPython
    Write-Host "✓ Using project virtual environment: $pythonCmd" -ForegroundColor Green
}
else {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        Write-Host "❌ Python not found. Please install Python 3.10-3.12 (recommended for vLLM)" -ForegroundColor Red
        exit 1
    }
    $pythonCmd = $python.Source
    Write-Host "✓ Python found: $pythonCmd" -ForegroundColor Green
}

# Check whether at least one backend is available (vLLM or Ollama)
$backendCheck = & $pythonCmd -c "
import importlib.util
import sys
ok_vllm = importlib.util.find_spec('vllm') is not None
ok_ollama = False
try:
    import requests
    r = requests.get('http://127.0.0.1:11434/api/tags', timeout=2)
    ok_ollama = r.ok
except Exception:
    pass
print('vllm=' + str(ok_vllm).lower() + ';ollama=' + str(ok_ollama).lower())
sys.exit(0 if (ok_vllm or ok_ollama) else 1)
" 2>$null

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ No local backend available." -ForegroundColor Red
    Write-Host "   Option A (recommended on Windows): start Ollama + CodeGeeX model" -ForegroundColor Yellow
    Write-Host "     1) ollama serve" -ForegroundColor Yellow
    Write-Host "     2) ollama pull codegeex4" -ForegroundColor Yellow
    Write-Host "   Option B: WSL2 Ubuntu + Python 3.10-3.12 + vLLM" -ForegroundColor Yellow
    exit 1
}

Write-Host "✓ Backend check: $backendCheck" -ForegroundColor Green

Write-Host "✓ Starting CodeGeeX server..." -ForegroundColor Green
Write-Host ""
Write-Host "⏳ First start may take 5-10 minutes to download and load the model (9.2 GB)" -ForegroundColor Yellow
Write-Host ""

# Start the server
& $pythonCmd codegeex-server.py

# If script reaches here, server has stopped
Write-Host ""
Write-Host "⚠️  Server stopped" -ForegroundColor Yellow
