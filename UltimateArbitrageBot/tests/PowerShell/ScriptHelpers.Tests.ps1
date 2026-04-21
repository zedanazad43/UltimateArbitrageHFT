$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$scriptsRoot = Join-Path $projectRoot 'scripts'

. (Join-Path $scriptsRoot 'common.ps1')

Describe 'PowerShell script helpers' {
  BeforeEach {
    $script:scriptsRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts'
  }

  It 'normalizes delimited values and removes duplicates' {
    $values = ConvertTo-NormalizedDelimitedValues -Value '1000000001, 123456789, ,1000000001'

    $values.Count | Should -Be 2
    $values[0] | Should -Be '1000000001'
    $values[1] | Should -Be '123456789'
  }

  It 'builds wrangler args only when config path is supplied' {
    $withConfig = @(Get-WranglerArgs -ConfigPath 'tail-worker/wrangler.toml')
    $withoutConfig = @(Get-WranglerArgs)

    $withConfig.Count | Should -Be 2
    $withConfig[0] | Should -Be '--config'
    $withConfig[1] | Should -Be 'tail-worker/wrangler.toml'
    $withoutConfig.Count | Should -Be 0
  }

  It 'returns the explicit setting value without prompting' {
    $value = Resolve-Setting -ScriptRoot $script:scriptsRoot -Name 'ADMIN_TOKEN' -ExplicitValue 'explicit-token' -DisablePrompt

    $value | Should -Be 'explicit-token'
  }

  It 'detects non-interactive sessions from CI markers' {
    $originalCi = [Environment]::GetEnvironmentVariable('CI')
    try {
      [Environment]::SetEnvironmentVariable('CI', 'true')

      Test-NonInteractiveSession | Should -Be $true
    }
    finally {
      [Environment]::SetEnvironmentVariable('CI', $originalCi)
    }
  }

  It 'reads wrangler vars from the vars block' {
    $tempConfig = Join-Path ([System.IO.Path]::GetTempPath()) ('wrangler-vars-' + [guid]::NewGuid().ToString() + '.toml')
    try {
      Set-Content -Path $tempConfig -Encoding utf8 -Value @"
name = "test"

[vars]
ALLOWED_CHAT_IDS = "1000000001"
"@ -NoNewline

      $chatIds = Get-WranglerVarValue -ScriptRoot $script:scriptsRoot -Name 'ALLOWED_CHAT_IDS' -ConfigPath $tempConfig
      $chatIds | Should -Be '1000000001'
    }
    finally {
      if (Test-Path $tempConfig) {
        Remove-Item $tempConfig -Force
      }
    }
  }

  It 'resolves relative config paths against the project root' {
    $resolvedPath = Resolve-ScriptRelativePath -ScriptRoot $script:scriptsRoot -Path 'wrangler.toml'

    $resolvedPath | Should -Match 'UltimateArbitrageBot[\\/]+wrangler\.toml$'
  }

  It 'validates absolute https URLs' {
    $url = Get-ValidatedAbsoluteHttpUrl -Name 'WebhookUrl' -Value 'https://example.com/path/'

    $url | Should -Be 'https://example.com/path'
  }
}

Describe 'promptless script validation' {
  BeforeEach {
    $script:scriptsRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts'
  }

  It 'fails fast for protected admin actions without a token when prompting is disabled' {
    $originalAdminToken = [Environment]::GetEnvironmentVariable('ADMIN_TOKEN')
    try {
      [Environment]::SetEnvironmentVariable('ADMIN_TOKEN', $null)

      {
        & (Join-Path $script:scriptsRoot 'invoke-admin-action.ps1') -Action start -NoPrompt | Out-Null
      } | Should -Throw 'ADMIN_TOKEN is required for protected actions. Pass -AdminToken, set ADMIN_TOKEN in the environment, or add it to .dev.vars.'
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
        & (Join-Path $script:scriptsRoot 'set-telegram-webhook.ps1') -NoPrompt | Out-Null
      } | Should -Throw 'TELEGRAM_BOT_TOKEN is required. Pass -BotToken, set TELEGRAM_BOT_TOKEN in the environment, or add it to .dev.vars.'
    }
    finally {
      [Environment]::SetEnvironmentVariable('TELEGRAM_BOT_TOKEN', $originalBotToken)
    }
  }

  It 'falls back to ALLOWED_CHAT_IDS from wrangler.toml for webhook tests' {
    $originalChatId = [Environment]::GetEnvironmentVariable('TELEGRAM_CHAT_ID')
    $tempConfig = Join-Path ([System.IO.Path]::GetTempPath()) ('wrangler-vars-' + [guid]::NewGuid().ToString() + '.toml')
    try {
      [Environment]::SetEnvironmentVariable('TELEGRAM_CHAT_ID', $null)
      Set-Content -Path $tempConfig -Encoding utf8 -Value @"
name = "test"

[vars]
ALLOWED_CHAT_IDS = "1000000001"
"@ -NoNewline

      $resolvedChatId = Resolve-Setting -ScriptRoot $script:scriptsRoot -Name 'TELEGRAM_CHAT_ID' -DisablePrompt
      if ([string]::IsNullOrWhiteSpace($resolvedChatId)) {
        $resolvedChatId = (ConvertTo-NormalizedDelimitedValues -Value (Get-WranglerVarValue -ScriptRoot $script:scriptsRoot -Name 'ALLOWED_CHAT_IDS' -ConfigPath $tempConfig) | Select-Object -First 1)
      }

      $resolvedChatId | Should -Be '1000000001'
    }
    finally {
      [Environment]::SetEnvironmentVariable('TELEGRAM_CHAT_ID', $originalChatId)
      if (Test-Path $tempConfig) {
        Remove-Item $tempConfig -Force
      }
    }
  }
}

Describe 'set-allowed-chats script' {
  BeforeEach {
    $script:scriptsRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts'
  }

  It 'updates ALLOWED_CHAT_IDS in a temp config file with normalized values' {
    $tempConfig = Join-Path ([System.IO.Path]::GetTempPath()) ('wrangler-test-' + [guid]::NewGuid().ToString() + '.toml')
    try {
      Set-Content -Path $tempConfig -Encoding utf8 -Value @"
name = "test"
ALLOWED_CHAT_IDS = "old"
"@ -NoNewline

      & (Join-Path $script:scriptsRoot 'set-allowed-chats.ps1') -ChatIds '1000000001, 123456789, 1000000001' -ConfigPath $tempConfig | Out-Null
      $content = Get-Content $tempConfig -Raw

      $content | Should -Match 'ALLOWED_CHAT_IDS = "1000000001,123456789"'
    }
    finally {
      if (Test-Path $tempConfig) {
        Remove-Item $tempConfig -Force
      }
    }
  }

  It 'fails fast for invalid webhook test URLs' {
    {
      & (Join-Path $script:scriptsRoot 'test-telegram-webhook.ps1') -WebhookUrl 'not-a-url' -ChatId '1000000001' -NoPrompt | Out-Null
    } | Should -Throw 'WebhookUrl must be a valid absolute http(s) URL.'
  }

  It 'fails fast for invalid admin base URLs' {
    {
      & (Join-Path $script:scriptsRoot 'invoke-admin-action.ps1') -Action health -BaseUrl 'not-a-url' -NoPrompt | Out-Null
    } | Should -Throw 'BaseUrl must be a valid absolute http(s) URL.'
  }
}

Describe 'strategy settings scripts' {
  BeforeEach {
    $script:scriptsRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts'
  }

  It 'updates MIN_CONFIDENCE_SCORE in a temp config file' {
    $tempConfig = Join-Path ([System.IO.Path]::GetTempPath()) ('wrangler-strategy-' + [guid]::NewGuid().ToString() + '.toml')
    try {
      Set-Content -Path $tempConfig -Encoding utf8 -Value @"
name = "test"

[vars]
MIN_CONFIDENCE_SCORE = "72"
MIN_HISTORY_POINTS = "3"
"@ -NoNewline

      & (Join-Path $script:scriptsRoot 'set-strategy-vars.ps1') -MinConfidenceScore 40 -ConfigPath $tempConfig | Out-Null
      $content = Get-Content $tempConfig -Raw

      $content | Should -Match 'MIN_CONFIDENCE_SCORE = "40"'
      $content | Should -Match 'MIN_HISTORY_POINTS = "3"'
    }
    finally {
      if (Test-Path $tempConfig) {
        Remove-Item $tempConfig -Force
      }
    }
  }

  It 'updates MIN_HISTORY_POINTS in a temp config file' {
    $tempConfig = Join-Path ([System.IO.Path]::GetTempPath()) ('wrangler-strategy-' + [guid]::NewGuid().ToString() + '.toml')
    try {
      Set-Content -Path $tempConfig -Encoding utf8 -Value @"
name = "test"

[vars]
MIN_CONFIDENCE_SCORE = "72"
MIN_HISTORY_POINTS = "3"
"@ -NoNewline

      & (Join-Path $script:scriptsRoot 'set-strategy-vars.ps1') -MinHistoryPoints 20 -ConfigPath $tempConfig | Out-Null
      $content = Get-Content $tempConfig -Raw

      $content | Should -Match 'MIN_CONFIDENCE_SCORE = "72"'
      $content | Should -Match 'MIN_HISTORY_POINTS = "20"'
    }
    finally {
      if (Test-Path $tempConfig) {
        Remove-Item $tempConfig -Force
      }
    }
  }

  It 'maps the aggressive preset to confidence 30' {
    $tempConfig = Join-Path ([System.IO.Path]::GetTempPath()) ('wrangler-strategy-' + [guid]::NewGuid().ToString() + '.toml')
    try {
      Set-Content -Path $tempConfig -Encoding utf8 -Value @"
name = "test"

[vars]
MIN_CONFIDENCE_SCORE = "72"
MIN_HISTORY_POINTS = "3"
"@ -NoNewline

      & (Join-Path $script:scriptsRoot 'set-ai-mode.ps1') -Preset aggressive -ConfigPath $tempConfig | Out-Null
      $content = Get-Content $tempConfig -Raw

      $content | Should -Match 'MIN_CONFIDENCE_SCORE = "30"'
    }
    finally {
      if (Test-Path $tempConfig) {
        Remove-Item $tempConfig -Force
      }
    }
  }
}

Describe 'set-mexc-secrets script' {
  BeforeEach {
    $script:scriptsRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts'
  }

  It 'fails fast when MEXC_API_KEY is missing with prompting disabled' {
    $originalKey = [Environment]::GetEnvironmentVariable('MEXC_API_KEY')
    try {
      [Environment]::SetEnvironmentVariable('MEXC_API_KEY', $null)

      {
        & (Join-Path $script:scriptsRoot 'set-mexc-secrets.ps1') -ApiSecret 'test-secret' -NoPrompt -SkipUpload | Out-Null
      } | Should -Throw 'MEXC_API_KEY is required. Pass -ApiKey, set MEXC_API_KEY in the environment, or add it to .dev.vars.'
    }
    finally {
      [Environment]::SetEnvironmentVariable('MEXC_API_KEY', $originalKey)
    }
  }

  It 'fails fast when MEXC_API_SECRET is missing with prompting disabled' {
    $originalSecret = [Environment]::GetEnvironmentVariable('MEXC_API_SECRET')
    try {
      [Environment]::SetEnvironmentVariable('MEXC_API_SECRET', $null)

      {
        & (Join-Path $script:scriptsRoot 'set-mexc-secrets.ps1') -ApiKey 'test-key' -NoPrompt -SkipUpload | Out-Null
      } | Should -Throw 'MEXC_API_SECRET is required. Pass -ApiSecret, set MEXC_API_SECRET in the environment, or add it to .dev.vars.'
    }
    finally {
      [Environment]::SetEnvironmentVariable('MEXC_API_SECRET', $originalSecret)
    }
  }

  It 'validates MEXC secrets and skips upload when requested' {
    & (Join-Path $script:scriptsRoot 'set-mexc-secrets.ps1') -ApiKey 'test-key' -ApiSecret 'test-secret' -SkipUpload | Out-Null
  }
}

Describe 'set-trading-mode script' {
  BeforeEach {
    $script:scriptsRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts'
  }

  It 'fails fast for set-trading-mode without ADMIN_TOKEN when prompting is disabled' {
    $originalToken = [Environment]::GetEnvironmentVariable('ADMIN_TOKEN')
    try {
      [Environment]::SetEnvironmentVariable('ADMIN_TOKEN', $null)

      {
        & (Join-Path $script:scriptsRoot 'set-trading-mode.ps1') -Mode paper -NoPrompt | Out-Null
      } | Should -Throw 'ADMIN_TOKEN is required. Pass -AdminToken, set ADMIN_TOKEN in the environment, or add it to .dev.vars.'
    }
    finally {
      [Environment]::SetEnvironmentVariable('ADMIN_TOKEN', $originalToken)
    }
  }

  It 'fails fast for set-trading-mode with invalid base URL' {
    {
      & (Join-Path $script:scriptsRoot 'set-trading-mode.ps1') -Mode live -BaseUrl 'not-a-url' -AdminToken 'test-token' | Out-Null
    } | Should -Throw 'BaseUrl must be a valid absolute http(s) URL.'
  }
}
