# Verify Cloudflare API Token Permissions (for use in CI/CD)
# Usage: Run this script in your workflow with env vars set:
#   $env:CLOUDFLARE_API_TOKEN   - Your API token
#   $env:CLOUDFLARE_ACCOUNT_ID  - Your Cloudflare Account ID

param()

# Helper for colored error output
function Write-ErrorColor {
    param([string]$Message)
    Write-Host "::error::$Message" -ForegroundColor Red
}

# 1. Verify the token is valid
$headers = @{ "Authorization" = "Bearer $env:CLOUDFLARE_API_TOKEN" }
$response = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/user/tokens/verify" -Headers $headers -ErrorAction SilentlyContinue
if (!$response.success) {
    Write-ErrorColor "Cloudflare token verification failed."
    Write-ErrorColor "الرجاء التأكد من صلاحية التوكن وإزالة أي تقييد IP ('Client IP Address Filtering')."
    exit 1
} else {
    Write-Host "✅ Cloudflare token is valid"
}

# 2. Verify Workers Scripts permissions
$workersUri = "https://api.cloudflare.com/client/v4/accounts/$($env:CLOUDFLARE_ACCOUNT_ID)/workers/scripts"
try {
    $workersResp = Invoke-WebRequest -Uri $workersUri -Headers $headers -Method Get -ErrorAction Stop
    if ($workersResp.StatusCode -eq 200) {
        Write-Host "✅ Cloudflare token has 'Account > Workers Scripts > Edit' permission"
    } else {
        Write-ErrorColor "Token status code: $($workersResp.StatusCode)"
        throw
    }
} catch {
    Write-ErrorColor "CLOUDFLARE_API_TOKEN لا يحتوي على صلاحية 'Account > Workers Scripts > Edit' أو يحتوي على تقييد IP."
    Write-ErrorColor "الحل: اذهب إلى Cloudflare → My Profile → API Tokens → عدّل التوكن → أضف الصلاحية المطلوبة، وأزل تقييد IP."
    exit 1
}