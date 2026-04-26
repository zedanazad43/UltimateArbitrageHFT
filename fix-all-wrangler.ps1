# Script: fix-all-wrangler.ps1

# Recursively find all wrangler.toml files under the current directory (and subfolders)
$wranglerFiles = Get-ChildItem -Path . -Recurse -Filter 'wrangler.toml' -ErrorAction SilentlyContinue

foreach ($file in $wranglerFiles) {
    Write-Host "Processing: $($file.FullName)"
    $backup = "$($file.FullName).bak"
    Copy-Item $file.FullName $backup -Force

    $lines = Get-Content $file.FullName
    $insideBinding = $false
    $names = @{}
    $newLines = @()
    $counter = @{}
    foreach ($line in $lines) {
        if ($line.Trim() -eq '[[durable_objects.bindings]]') {
            $insideBinding = $true
        }
        elseif ($insideBinding -and $line.Trim().ToLower().StartsWith('name')) {
            if ($line -match 'name\s*=\s*"(.*?)"') {
                $nameVal = $matches[1]
                if ($names.ContainsKey($nameVal)) {
                    if (-not $counter.ContainsKey($nameVal)) {
                        $counter[$nameVal] = 2
                    }
                    else {
                        $counter[$nameVal]++
                    }
                    $uniqueName = "${nameVal}_${($counter[$nameVal])}"
                    $line = $line -replace '(".*?")', '"' + $uniqueName + '"'
                    $names[$uniqueName] = $true
                } else {
                    $names[$nameVal] = $true
                }
            }
        }
        elseif ($insideBinding -and ($line.Trim() -eq "" -or $line.Trim().StartsWith("["))) {
            $insideBinding = $false
        }
        $newLines += $line
    }
    Set-Content $file.FullName -Value $newLines -Encoding UTF8
    Write-Host "  Fixed and backed up as: $backup`n"
}

Write-Host "✅ All wrangler.toml files have been processed. Backups created as '.bak'."