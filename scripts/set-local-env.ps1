param(
  [Parameter(Mandatory=$true)][string]$CloudflareApiToken,
  [Parameter(Mandatory=$true)][string]$CloudflareAccountId
)
[Environment]::SetEnvironmentVariable("CLOUDFLARE_API_TOKEN", $CloudflareApiToken, "User")
[Environment]::SetEnvironmentVariable("CLOUDFLARE_ACCOUNT_ID", $CloudflareAccountId, "User")
Write-Host "Saved user env vars. Open a NEW terminal."
