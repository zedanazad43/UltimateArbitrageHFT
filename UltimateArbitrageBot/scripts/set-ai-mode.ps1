param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('confidence-40', 'history-20', 'aggressive')]
    [string]$Preset,

    [string]$ConfigPath = '',

    [switch]$Deploy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$strategyScript = Join-Path $PSScriptRoot 'set-strategy-vars.ps1'

switch ($Preset) {
    'confidence-40' {
        & $strategyScript -MinConfidenceScore 40 -ConfigPath $ConfigPath -Deploy:$Deploy
    }
    'history-20' {
        & $strategyScript -MinHistoryPoints 20 -ConfigPath $ConfigPath -Deploy:$Deploy
    }
    'aggressive' {
        & $strategyScript -MinConfidenceScore 30 -ConfigPath $ConfigPath -Deploy:$Deploy
    }
}