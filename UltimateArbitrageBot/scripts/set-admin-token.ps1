param(
	[string]$Token = '',
	[string]$ConfigPath = '',
	[switch]$SkipUpload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'common.ps1')

if ([string]::IsNullOrWhiteSpace($Token)) {
	$tokenBytes = New-Object byte[] 24
	[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes)
	$Token = [Convert]::ToHexString($tokenBytes).ToLowerInvariant()
}

Write-Host "ADMIN_TOKEN=$Token"

if ($SkipUpload) {
	Write-Host 'Skipped wrangler secret upload.'
	return
}

$wranglerArgs = Get-WranglerArgs -ConfigPath $ConfigPath

try {
	$Token | npx wrangler versions secret put ADMIN_TOKEN @wranglerArgs
} catch {
	$details = $_.Exception.Message
	if ($_.ErrorDetails -and -not [string]::IsNullOrWhiteSpace($_.ErrorDetails.Message)) {
		$details = $_.ErrorDetails.Message
	}
	throw "Setting ADMIN_TOKEN failed: $details"
}