# Set your repo
$repo = "zedanazad43/UltimateArbitrageHFT"
# List of secret files
$secretFiles = @("api_keys.txt", "api_keys.ini")

foreach ($file in $secretFiles) {
    if (Test-Path $file) {
        Get-Content $file | ForEach-Object {
            # Skip comments and empty lines
            if ($_ -match '^\s*#' -or $_ -match '^\s*;' -or $_ -match '^\s*$') { return }
            if ($_ -match '^\s*([^=]+?)\s*=\s*(.+)$') {
                $key = $matches[1].Trim()
                $value = $matches[2].Trim()
                Write-Host "Adding secret: $key"
                gh secret set $key -b"$value" -R $repo
            }
        }
    } else {
        Write-Host "File not found: $file" -ForegroundColor Yellow
    }
}