$scriptsRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts'
$tmpDir      = [System.IO.Path]::GetTempPath()

. (Join-Path $scriptsRoot 'common.ps1')

Describe 'MegaArbitrageBot script helpers' {
  BeforeEach {
    $script:scriptsRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts'
    $script:tmpDir      = [System.IO.Path]::GetTempPath()
  }

  It 'Read-EnvFile returns empty hashtable when file does not exist' {
    $result = Read-EnvFile -EnvFilePath (Join-Path $script:tmpDir 'nonexistent-megabot-test.env')
    $result.Count | Should -Be 0
  }

  It 'Read-EnvFile parses key=value pairs and strips quotes' {
    $tempEnv = Join-Path $script:tmpDir ('megabot-test-' + [guid]::NewGuid().ToString() + '.env')
    try {
      Set-Content -Path $tempEnv -Encoding utf8 -NoNewline -Value @"
# comment
TELEGRAM_BOT_TOKEN=abc123
TELEGRAM_CHAT_ID="9876543"
CONTROL_CENTER_BASE_URL='https://example.com'
"@
      $result = Read-EnvFile -EnvFilePath $tempEnv

      $result['TELEGRAM_BOT_TOKEN']      | Should -Be 'abc123'
      $result['TELEGRAM_CHAT_ID']        | Should -Be '9876543'
      $result['CONTROL_CENTER_BASE_URL'] | Should -Be 'https://example.com'
    } finally {
      if (Test-Path $tempEnv) { Remove-Item $tempEnv -Force }
    }
  }

  It 'Read-EnvFile skips blank lines and comment lines' {
    $tempEnv = Join-Path $script:tmpDir ('megabot-test-' + [guid]::NewGuid().ToString() + '.env')
    try {
      Set-Content -Path $tempEnv -Encoding utf8 -NoNewline -Value @"

# this is a comment
  # indented comment

KEY=value
"@
      $result = Read-EnvFile -EnvFilePath $tempEnv

      $result.Count | Should -Be 1
      $result['KEY'] | Should -Be 'value'
    } finally {
      if (Test-Path $tempEnv) { Remove-Item $tempEnv -Force }
    }
  }

  It 'Resolve-BotSetting returns explicit value without reading env or file' {
    $value = Resolve-BotSetting `
      -ScriptRoot    $script:scriptsRoot `
      -Name          'TELEGRAM_BOT_TOKEN' `
      -ExplicitValue 'explicit-token' `
      -DisablePrompt

    $value | Should -Be 'explicit-token'
  }

  It 'Resolve-BotSetting falls back to environment variable' {
    $original = [Environment]::GetEnvironmentVariable('TEST_MEGABOT_SETTING')
    try {
      [Environment]::SetEnvironmentVariable('TEST_MEGABOT_SETTING', 'env-value')

      $value = Resolve-BotSetting `
        -ScriptRoot    $script:scriptsRoot `
        -Name          'TEST_MEGABOT_SETTING' `
        -DisablePrompt

      $value | Should -Be 'env-value'
    } finally {
      [Environment]::SetEnvironmentVariable('TEST_MEGABOT_SETTING', $original)
    }
  }

  It 'Get-ValidatedAbsoluteHttpUrl strips trailing slash' {
    $url = Get-ValidatedAbsoluteHttpUrl -Name 'TestUrl' -Value 'https://example.com/path/'
    $url | Should -Be 'https://example.com/path'
  }

  It 'Get-ValidatedAbsoluteHttpUrl throws for non-URL values' {
    { Get-ValidatedAbsoluteHttpUrl -Name 'TestUrl' -Value 'not-a-url' } |
      Should -Throw 'TestUrl must be a valid absolute http(s) URL.'
  }

  It 'Test-NonInteractiveBotSession returns true in CI environment' {
    $originalCi = [Environment]::GetEnvironmentVariable('CI')
    try {
      [Environment]::SetEnvironmentVariable('CI', 'true')
      Test-NonInteractiveBotSession | Should -Be $true
    } finally {
      [Environment]::SetEnvironmentVariable('CI', $originalCi)
    }
  }
}

Describe 'setup-telegram-control script' {
  BeforeEach {
    $script:scriptsRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts'
    $script:tmpDir      = [System.IO.Path]::GetTempPath()
  }

  It 'completes without error when SkipWrite is passed with all required params' {
    {
      & (Join-Path $script:scriptsRoot 'setup-telegram-control.ps1') `
        -BotToken         'test-bot-token' `
        -PrimaryChatId    '111111111' `
        -AdminChatIds     '111111111,222222222' `
        -NotifyChatIds    '333333333' `
        -ControlCenterUrl 'https://example.com' `
        -AdminToken       'test-admin-token' `
        -SkipWrite `
        -NoPrompt | Out-Null
    } | Should -Not -Throw
  }

  It 'throws when TELEGRAM_BOT_TOKEN is missing and prompts are disabled' {
    $originalToken = [Environment]::GetEnvironmentVariable('TELEGRAM_BOT_TOKEN')
    try {
      [Environment]::SetEnvironmentVariable('TELEGRAM_BOT_TOKEN', $null)

      {
        & (Join-Path $script:scriptsRoot 'setup-telegram-control.ps1') `
          -SkipWrite -NoPrompt | Out-Null
      } | Should -Throw
    } finally {
      [Environment]::SetEnvironmentVariable('TELEGRAM_BOT_TOKEN', $originalToken)
    }
  }

  It 'throws when CONTROL_CENTER_BASE_URL is not a valid URL' {
    {
      & (Join-Path $script:scriptsRoot 'setup-telegram-control.ps1') `
        -BotToken         'test-token' `
        -PrimaryChatId    '111' `
        -ControlCenterUrl 'not-a-url' `
        -SkipWrite -NoPrompt | Out-Null
    } | Should -Throw 'CONTROL_CENTER_BASE_URL must be a valid absolute http(s) URL.'
  }
}

Describe 'test-telegram-control script' {
  BeforeEach {
    $script:scriptsRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'scripts'
  }

  It 'throws when TELEGRAM_BOT_TOKEN is missing and prompts are disabled' {
    $originalToken = [Environment]::GetEnvironmentVariable('TELEGRAM_BOT_TOKEN')
    try {
      [Environment]::SetEnvironmentVariable('TELEGRAM_BOT_TOKEN', $null)

      {
        & (Join-Path $script:scriptsRoot 'test-telegram-control.ps1') -NoPrompt | Out-Null
      } | Should -Throw 'TELEGRAM_BOT_TOKEN is required. Pass -BotToken, set TELEGRAM_BOT_TOKEN in the environment, or run setup-telegram-control.ps1.'
    } finally {
      [Environment]::SetEnvironmentVariable('TELEGRAM_BOT_TOKEN', $originalToken)
    }
  }
}
