$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptsRoot = Join-Path $projectRoot 'scripts'

. (Join-Path $scriptsRoot 'common.ps1')

Describe 'PowerShell script helpers' {
  It 'normalizes delimited values and removes duplicates' {
    $values = ConvertTo-NormalizedDelimitedValues -Value '1771005847, 123456789, ,1771005847'

    $values.Count | Should Be 2
    $values[0] | Should Be '1771005847'
    $values[1] | Should Be '123456789'
  }

  It 'builds wrangler args only when config path is supplied' {
    $withConfig = @(Get-WranglerArgs -ConfigPath 'tail-worker/wrangler.toml')
    $withoutConfig = @(Get-WranglerArgs)

    $withConfig.Count | Should Be 2
    $withConfig[0] | Should Be '--config'
    $withConfig[1] | Should Be 'tail-worker/wrangler.toml'
    $withoutConfig.Count | Should Be 0
  }

  It 'returns the explicit setting value without prompting' {
    $value = Resolve-Setting -ScriptRoot $scriptsRoot -Name 'ADMIN_TOKEN' -ExplicitValue 'explicit-token' -DisablePrompt

    $value | Should Be 'explicit-token'
  }

  It 'detects non-interactive sessions from CI markers' {
    $originalCi = [Environment]::GetEnvironmentVariable('CI')
    try {
      [Environment]::SetEnvironmentVariable('CI', 'true')

      Test-NonInteractiveSession | Should Be $true
    }
    finally {
      [Environment]::SetEnvironmentVariable('CI', $originalCi)
    }
  }

  It 'reads wrangler vars from the vars block' {
    $chatIds = Get-WranglerVarValue -ScriptRoot $scriptsRoot -Name 'ALLOWED_CHAT_IDS'

    $chatIds | Should Be '1771005847'
  }

  It 'resolves relative config paths against the project root' {
    $resolvedPath = Resolve-ScriptRelativePath -ScriptRoot $scriptsRoot -Path 'wrangler.toml'

    $resolvedPath | Should Match 'UltimateArbitrageBot\\wrangler.toml$'
  }

  It 'validates absolute https URLs' {
    $url = Get-ValidatedAbsoluteHttpUrl -Name 'WebhookUrl' -Value 'https://example.com/path/'

    $url | Should Be 'https://example.com/path'
  }
}

Describe 'promptless script validation' {
  It 'fails fast for protected admin actions without a token when prompting is disabled' {
    $originalAdminToken = [Environment]::GetEnvironmentVariable('ADMIN_TOKEN')
    try {
      [Environment]::SetEnvironmentVariable('ADMIN_TOKEN', $null)

      {
        & (Join-Path $scriptsRoot 'invoke-admin-action.ps1') -Action start -NoPrompt | Out-Null
      } | Should Throw 'ADMIN_TOKEN is required for protected actions. Pass -AdminToken, set ADMIN_TOKEN in the environment, or add it to .dev.vars.'
    }
    finally {
      [Environment]::SetEnvironmentVariable('ADMIN_TOKEN', $originalAdminToken)
    }
  }

  It 'fails fast for webhook setup without a bot token when prompting is disabled' {
    $originalBotToken = [Environment]::GetEnvironmentVariable('TELEGRAM_BOT_TOKEN')
    try {
      [Environment]::SetEnvironmentVariable('TELEGRAM_BOT_TOKEN', $null)

      {
        & (Join-Path $scriptsRoot 'set-telegram-webhook.ps1') -NoPrompt | Out-Null
      } | Should Throw 'TELEGRAM_BOT_TOKEN is required. Pass -BotToken, set TELEGRAM_BOT_TOKEN in the environment, or add it to .dev.vars.'
    }
    finally {
      [Environment]::SetEnvironmentVariable('TELEGRAM_BOT_TOKEN', $originalBotToken)
    }
  }

  It 'falls back to ALLOWED_CHAT_IDS from wrangler.toml for webhook tests' {
    $originalChatId = [Environment]::GetEnvironmentVariable('TELEGRAM_CHAT_ID')
    try {
      [Environment]::SetEnvironmentVariable('TELEGRAM_CHAT_ID', $null)

      $resolvedChatId = Resolve-Setting -ScriptRoot $scriptsRoot -Name 'TELEGRAM_CHAT_ID' -DisablePrompt
      if ([string]::IsNullOrWhiteSpace($resolvedChatId)) {
        $resolvedChatId = (ConvertTo-NormalizedDelimitedValues -Value (Get-WranglerVarValue -ScriptRoot $scriptsRoot -Name 'ALLOWED_CHAT_IDS') | Select-Object -First 1)
      }

      $resolvedChatId | Should Be '1771005847'
    }
    finally {
      [Environment]::SetEnvironmentVariable('TELEGRAM_CHAT_ID', $originalChatId)
    }
  }
}

Describe 'set-allowed-chats script' {
  It 'updates ALLOWED_CHAT_IDS in a temp config file with normalized values' {
    $tempConfig = Join-Path $env:TEMP ('wrangler-test-' + [guid]::NewGuid().ToString() + '.toml')
    try {
      Set-Content -Path $tempConfig -Value @"
name = "test"
ALLOWED_CHAT_IDS = "old"
"@ -NoNewline

      & (Join-Path $scriptsRoot 'set-allowed-chats.ps1') -ChatIds '1771005847, 123456789, 1771005847' -ConfigPath $tempConfig | Out-Null
      $content = Get-Content $tempConfig -Raw

      $content | Should Match 'ALLOWED_CHAT_IDS = "1771005847,123456789"'
    }
    finally {
      if (Test-Path $tempConfig) {
        Remove-Item $tempConfig -Force
      }
    }
  }

  It 'fails fast for invalid webhook test URLs' {
    {
      & (Join-Path $scriptsRoot 'test-telegram-webhook.ps1') -WebhookUrl 'not-a-url' -NoPrompt | Out-Null
    } | Should Throw 'WebhookUrl must be a valid absolute http(s) URL.'
  }

  It 'fails fast for invalid admin base URLs' {
    {
      & (Join-Path $scriptsRoot 'invoke-admin-action.ps1') -Action health -BaseUrl 'not-a-url' -NoPrompt | Out-Null
    } | Should Throw 'BaseUrl must be a valid absolute http(s) URL.'
  }
}

Describe 'strategy settings scripts' {
  It 'updates MIN_CONFIDENCE_SCORE in a temp config file' {
    $tempConfig = Join-Path $env:TEMP ('wrangler-strategy-' + [guid]::NewGuid().ToString() + '.toml')
    try {
      Set-Content -Path $tempConfig -Value @"
name = "test"

[vars]
MIN_CONFIDENCE_SCORE = "72"
MIN_HISTORY_POINTS = "3"
"@ -NoNewline

      & (Join-Path $scriptsRoot 'set-strategy-vars.ps1') -MinConfidenceScore 40 -ConfigPath $tempConfig | Out-Null
      $content = Get-Content $tempConfig -Raw

      $content | Should Match 'MIN_CONFIDENCE_SCORE = "40"'
      $content | Should Match 'MIN_HISTORY_POINTS = "3"'
    }
    finally {
      if (Test-Path $tempConfig) {
        Remove-Item $tempConfig -Force
      }
    }
  }

  It 'updates MIN_HISTORY_POINTS in a temp config file' {
    $tempConfig = Join-Path $env:TEMP ('wrangler-strategy-' + [guid]::NewGuid().ToString() + '.toml')
    try {
      Set-Content -Path $tempConfig -Value @"
name = "test"

[vars]
MIN_CONFIDENCE_SCORE = "72"
MIN_HISTORY_POINTS = "3"
"@ -NoNewline

      & (Join-Path $scriptsRoot 'set-strategy-vars.ps1') -MinHistoryPoints 20 -ConfigPath $tempConfig | Out-Null
      $content = Get-Content $tempConfig -Raw

      $content | Should Match 'MIN_CONFIDENCE_SCORE = "72"'
      $content | Should Match 'MIN_HISTORY_POINTS = "20"'
    }
    finally {
      if (Test-Path $tempConfig) {
        Remove-Item $tempConfig -Force
      }
    }
  }

  It 'maps the aggressive preset to confidence 30' {
    $tempConfig = Join-Path $env:TEMP ('wrangler-strategy-' + [guid]::NewGuid().ToString() + '.toml')
    try {
      Set-Content -Path $tempConfig -Value @"
name = "test"

[vars]
MIN_CONFIDENCE_SCORE = "72"
MIN_HISTORY_POINTS = "3"
"@ -NoNewline

      & (Join-Path $scriptsRoot 'set-ai-mode.ps1') -Preset aggressive -ConfigPath $tempConfig | Out-Null
      $content = Get-Content $tempConfig -Raw

      $content | Should Match 'MIN_CONFIDENCE_SCORE = "30"'
    }
    finally {
      if (Test-Path $tempConfig) {
        Remove-Item $tempConfig -Force
      }
    }
  }
}