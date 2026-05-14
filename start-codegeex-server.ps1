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
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "❌ Python not found. Please install Python 3.9+" -ForegroundColor Red
    exit 1
}

Write-Host "✓ Python found: $($python.Source)" -ForegroundColor Green
Write-Host "✓ Starting CodeGeeX server..." -ForegroundColor Green
Write-Host ""
Write-Host "⏳ First start may take 5-10 minutes to download and load the model (9.2 GB)" -ForegroundColor Yellow
Write-Host ""

# Start the server
python codegeex-server.py

# If script reaches here, server has stopped
Write-Host ""
Write-Host "⚠️  Server stopped" -ForegroundColor Yellow
