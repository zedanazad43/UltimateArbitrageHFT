#Requires -Version 5.1
<#
.SYNOPSIS
    Sets up the local AI-agent development environment for UltimateArbitrageHFT.

.DESCRIPTION
    Steps performed:
      1. Verify winget is available
      2. Install/verify core tools  (Git, VS Code, Python 3.12, Node.js LTS, GitHub CLI, Ollama)
      3. Create and activate a Python 3.12 virtual-environment (.venv)
      4. Upgrade pip + install setuptools/wheel first, then AI packages
      5. Install global Node packages  (pnpm)
      6. Install VS Code extensions
      7. Write ~/.continue/config.yaml for local Ollama models
      8. Pull Ollama models  (qwen2.5-coder:7b, codellama:7b, llama3.1:8b)
      9. Create ~/ai-agents/vscode-agent-lab workspace with agent prompt
     10. Print version summary

.NOTES
    Run from the project root:
        Set-ExecutionPolicy -Scope CurrentUser Bypass -Force
        .\setup-dev-env.ps1

    If you already have a .venv in the project root it will be reused.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Step { param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}
function Write-OK   { param([string]$Message)
    Write-Host "    [OK] $Message" -ForegroundColor Green
}
function Write-Warn { param([string]$Message)
    Write-Host "    [!!] $Message" -ForegroundColor Yellow
}

function Test-CommandExists {
    param([string]$CommandName)
    return [bool](Get-Command $CommandName -ErrorAction SilentlyContinue)
}

function Install-WingetPackage {
    param([string]$PackageId)
    Write-Step "Installing via winget: $PackageId"
    winget install --id $PackageId -e --accept-package-agreements --accept-source-agreements
}

function Ensure-WingetPackage {
    param([string]$PackageId, [string]$CommandName)
    if (Test-CommandExists $CommandName) {
        Write-OK "$CommandName already installed"
    } else {
        Install-WingetPackage $PackageId
    }
}

# ---------------------------------------------------------------------------
# 1. Verify winget
# ---------------------------------------------------------------------------
Write-Step "Checking winget"
if (-not (Test-CommandExists "winget")) {
    throw "winget not found. Install 'App Installer' from the Microsoft Store first."
}
Write-OK "winget available"

# ---------------------------------------------------------------------------
# 2. Core tools
# ---------------------------------------------------------------------------
Write-Step "Installing/verifying core tools"
Ensure-WingetPackage "Git.Git"                     "git"
Ensure-WingetPackage "Microsoft.VisualStudioCode"  "code"
Ensure-WingetPackage "Python.Python.3.12"          "py"
Ensure-WingetPackage "OpenJS.NodeJS.LTS"           "node"
Ensure-WingetPackage "GitHub.cli"                  "gh"
Ensure-WingetPackage "Ollama.Ollama"               "ollama"

# ---------------------------------------------------------------------------
# 3. Python virtual environment  (always use py -3.12 to avoid 3.14 default)
# ---------------------------------------------------------------------------
Write-Step "Setting up Python 3.12 virtual environment (.venv)"

$VenvDir = Join-Path $PSScriptRoot ".venv"

if (-not (Test-Path $VenvDir)) {
    & py -3.12 -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) { throw "Failed to create virtual environment with py -3.12." }
    Write-OK "Virtual environment created at $VenvDir"
} else {
    Write-OK "Virtual environment already exists at $VenvDir"
}

$PipExe    = Join-Path $VenvDir "Scripts\pip.exe"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

# ---------------------------------------------------------------------------
# 4. pip / Python packages
# ---------------------------------------------------------------------------
Write-Step "Upgrading pip inside .venv"
& $PythonExe -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed." }

# Clear pip cache to fix 'Cache entry deserialization failed' warnings
Write-Step "Clearing pip cache"
& $PipExe cache purge 2>$null
Write-OK "pip cache cleared"

# Install build tools FIRST so source-dist packages can compile
Write-Step "Installing build tools (setuptools, wheel)"
& $PipExe install --upgrade setuptools wheel
if ($LASTEXITCODE -ne 0) { throw "setuptools/wheel install failed." }
Write-OK "setuptools and wheel installed"

# Install AI / agent packages
Write-Step "Installing AI packages"
$AiPackages = @(
    "aider-chat",
    "open-interpreter",
    "pyautogen",
    "langchain",
    "langgraph"
)
& $PipExe install --upgrade @AiPackages
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Some AI packages failed. Check output above."
    Write-Warn "You can retry manually: $PipExe install <package>"
} else {
    Write-OK "AI packages installed"
}

# Helpful hint: add venv Scripts to PATH for this session
$VenvScripts = Join-Path $VenvDir "Scripts"
if ($env:PATH -notlike "*$VenvScripts*") {
    $env:PATH = "$VenvScripts;$env:PATH"
    Write-OK "Added .venv\Scripts to PATH for this session"
    Write-Warn "To make it permanent, add '$VenvScripts' to your user PATH."
}

# ---------------------------------------------------------------------------
# 5. Global Node packages
# ---------------------------------------------------------------------------
Write-Step "Installing global Node packages"
npm install -g pnpm
if ($LASTEXITCODE -ne 0) { Write-Warn "pnpm install failed." } else { Write-OK "pnpm installed" }

# ---------------------------------------------------------------------------
# 6. VS Code extensions
#    NOTE: github.copilot-chat is now a built-in extension in recent VS Code
#          versions (>= 1.90) and cannot be installed/downgraded manually.
#          GitHub Copilot itself is still installable.
# ---------------------------------------------------------------------------
Write-Step "Installing VS Code extensions"
$Extensions = @(
    "Continue.continue",
    "GitHub.copilot",
    "ms-python.python",
    "ms-vscode.powershell",
    "ms-azuretools.vscode-docker"
)

foreach ($Ext in $Extensions) {
    Write-Host "  Installing: $Ext" -ForegroundColor DarkCyan
    code --install-extension $Ext --force
    # Non-fatal: some extensions may already be at a newer built-in version
}
Write-OK "VS Code extensions processed"
Write-Warn "github.copilot-chat is built-in since VS Code 1.90+ and is managed by VS Code itself."

# ---------------------------------------------------------------------------
# 7. Continue config (local Ollama models)
# ---------------------------------------------------------------------------
Write-Step "Writing ~/.continue/config.yaml"
$ContinueDir = Join-Path $HOME ".continue"
New-Item -ItemType Directory -Force $ContinueDir | Out-Null

$ConfigYaml = @"
models:
  - title: Qwen2.5 Coder 7B
    provider: ollama
    model: qwen2.5-coder:7b

  - title: CodeLlama 7B
    provider: ollama
    model: codellama:7b

  - title: Llama 3.1 8B
    provider: ollama
    model: llama3.1:8b

tabAutocompleteModel:
  title: Qwen2.5 Coder 7B
  provider: ollama
  model: qwen2.5-coder:7b

embeddingsProvider:
  provider: ollama
  model: llama3.1:8b
"@

$ConfigYaml | Set-Content (Join-Path $ContinueDir "config.yaml") -Encoding UTF8
Write-OK "Config written to $ContinueDir\config.yaml"

# ---------------------------------------------------------------------------
# 8. Pull Ollama models
# ---------------------------------------------------------------------------
Write-Step "Pulling Ollama models (this may take a while on first run)"
$OllamaModels = @("qwen2.5-coder:7b", "codellama:7b", "llama3.1:8b")
foreach ($Model in $OllamaModels) {
    Write-Host "  Pulling: $Model" -ForegroundColor DarkCyan
    ollama pull $Model
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Failed to pull $Model — is Ollama running? Start it with: ollama serve"
    }
}
Write-OK "Ollama models pulled"

# ---------------------------------------------------------------------------
# 9. Agent workspace
# ---------------------------------------------------------------------------
Write-Step "Creating agent workspace"
$Workspace = Join-Path $HOME "ai-agents\vscode-agent-lab"
New-Item -ItemType Directory -Force $Workspace | Out-Null

$AgentPrompt = @"
أنت وكيل برمجي محلي.
القواعد:
- افحص المستودع قبل التعديل.
- اقترح خطة قصيرة قبل التغييرات الكبيرة.
- اجعل التعديلات صغيرة وآمنة وقابلة للتراجع.
- شغّل الاختبارات إذا كانت متوفرة.
- لخّص الملفات المعدلة والأوامر المستخدمة.
"@
$AgentPrompt | Set-Content (Join-Path $Workspace "AGENT_PROMPT_AR.txt") -Encoding UTF8

Push-Location $Workspace
if (-not (Test-Path ".git")) {
    git init | Out-Null
    Write-OK "Initialized git repo in $Workspace"
}
Pop-Location
Write-OK "Workspace ready: $Workspace"

# ---------------------------------------------------------------------------
# 10. Version summary
# ---------------------------------------------------------------------------
Write-Step "Version summary"
$Versions = [ordered]@{
    "git"     = { git --version }
    "python"  = { & $PythonExe --version }
    "node"    = { node --version }
    "npm"     = { npm --version }
    "gh"      = { gh --version | Select-Object -First 1 }
    "ollama"  = { ollama --version }
    "aider"   = { & (Join-Path $VenvDir "Scripts\aider.exe") --version 2>$null }
}

foreach ($Tool in $Versions.Keys) {
    try {
        $ver = & $Versions[$Tool]
        Write-Host ("  {0,-10} {1}" -f $Tool, ($ver | Out-String).Trim()) -ForegroundColor White
    } catch {
        Write-Warn "$Tool - not found in PATH (check install)"
    }
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  SETUP COMPLETE" -ForegroundColor Green
Write-Host "  Virtual env : $VenvDir" -ForegroundColor Green
Write-Host "  Activate    : .\.venv\Scripts\Activate.ps1" -ForegroundColor Green
Write-Host "  Open workspace: code `"$Workspace`"" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
