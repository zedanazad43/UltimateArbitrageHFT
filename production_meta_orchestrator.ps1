# ==============================
#  Pro Orchestrator for
#  Cloudflare-Worker Bots + 
#  CEX Bots: Bitget, Binance, Mexc
#  DEX (Metamask Integration)
# ==============================

# === 1. إعداد المفاتيح وكشف المنصات الفعلية
$api_keys = @{}
foreach ($line in Get-Content "./api_keys.txt") {
  if ($line -match "^\s*([A-Z0-9_]+)\s*=(.*)$") {
    $api_keys[$matches[1].Trim()] = $matches[2].Trim()
  }
}
$activePlatforms = @{}
"BITGET","BINANCE","MEXC" | ForEach-Object {
  if ($api_keys["${_}_API_KEY"] -and $api_keys["${_}_API_SECRET"]) {
    $activePlatforms[$_] = @{
      apiKey   = $api_keys["${_}_API_KEY"]
      apiSecret= $api_keys["${_}_API_SECRET"]
    }
  }
}
if ($api_keys["METAMASK_API_KEY"]) {
  $activePlatforms["METAMASK"] = @{ apiKey= $api_keys["METAMASK_API_KEY"] }
}

# === 2. قائمة البوتات الداخلية (Cloudflare Worker Bots) ===
# عدّل القائمة حسب أسماء العمال لديك في الكلاودفلير
$cloudflareBots = @(
  "arbitrage-bot",
  "scalper-bot"
  # أضف أي Worker Bot آخر
)

# === 3. الخدمات/البوتات الأصلية/الرسمية للمنصات ===
$botServices = @{
  "BINANCE" = @("SpotGrid", "FuturesGrid", "CopyTrade")
  "MEXC"    = @("SuperGridBot", "CopyTrade")
  "BITGET"  = @("FuturesBot", "StrategyBot")
  "METAMASK"= @("SwapScanner","ArbRouter")
}

# === 4. توزيع الفرص (مثال: استبدل بالـsignals or fetched data لاحقًا)
$opportunities = @(
  @{name="scalp";      profit=0.19;  size="small"},
  @{name="arbitrage";  profit=2.7;   size="medium"},
  @{name="bigMove";    profit=10.8;  size="large"}
)

# === 5. ميثود تنفيذية ذكية لإطلاق البوت أو الخدمة للمنصة
function Invoke-PlatformService {
  param(
    [string]$platform, [string]$service, [string]$taskJson, [hashtable]$creds
  )
  Write-Host "[DISPATCH][$platform/$service] Launching for: $taskJson"
  if ($platform -eq "METAMASK") {
    # ربط خدمة لامركزية عبر Metamask أو arbi-router
    Write-Host "→ Would trigger DEX $service via Metamask key: $($creds.apiKey)"
    # Actual DEX logic here (integrate with web3 or CLI tool)
    return
  }
  if ($platform -eq "BINANCE" -and $service -eq "CopyTrade") {
    Write-Host "↪️ [Demo] Would call Binance CopyTrading API using APIKey/Sec"
    # Here: use Invoke-RestMethod to actual Binance bot endpoint with creds
  }
  elseif ($platform -eq "BITGET" -and $service -eq "StrategyBot") {
    Write-Host "↪️ [Demo] Would call Bitget Strategy Bot API using APIKey/Sec"
  }
  elseif ($platform -eq "MEXC" -and $service -eq "SuperGridBot") {
    Write-Host "↪️ [Demo] Would call MEXC Grid Bot API using APIKey/Sec"
  }
  else {
    Write-Host "↪️ [DEMO/GENERIC] Would launch $service on $platform"
  }
}

# === 6. تنفيذ جميع Cloudflare Worker Bots
Write-Host "`n=== Launching Cloudflare Worker Bots ==="
foreach ($worker in $cloudflareBots) {
  $url = "https://$worker.zedanazad43.workers.dev/trigger"
  Write-Host "🔗 Calling Worker Bot: $worker"
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing
    Write-Host "→ [$worker] Response: $($resp.StatusCode)"
  } catch {
    Write-Warning "⚠️ [$worker] Did not respond (Make sure endpoint exists or simulate locally)."
  }
}

# === 7. توزيع الفرص على جميع الخدمات الأصلية للمنصات
Write-Host "`n=== Distributing opportunities over native & CEX/DEX bots ==="
foreach ($platform in $activePlatforms.Keys) {
  $creds = $activePlatforms[$platform]
  $services = $botServices[$platform]
  if (-not $services) { continue }
  foreach ($opp in $opportunities) {
    # اختر الخدمة حسب حجم الفرصة
    switch ($opp.size) {
      "small"   { $svc = $services | Where-Object {$_ -match "Scalp|Grid|Futures"} | Select-Object -First 1 }
      "medium"  { $svc = $services | Where-Object {$_ -match "Arb|Strategy|Copy"} | Select-Object -First 1 }
      default   { $svc = $services | Select-Object -Last 1 }
    }
    if (-not $svc) { $svc = $services[0] }
    $taskJson = "{opp:$($opp.name),profit:$($opp.profit)%}"
    Invoke-PlatformService $platform $svc $taskJson $creds

    # أربيتراج مزدوج إذا يوجد METAMASK ومنصة مركزية
    if ($platform -ne "METAMASK" -and $activePlatforms["METAMASK"]) {
      Invoke-PlatformService "METAMASK" "ArbRouter" $taskJson @{apiKey=$activePlatforms["METAMASK"].apiKey}
      Write-Host "↔️ Hybrid Arbitrage (CEX+DEX) launched $platform+Metamask"
    }
  }
}

Write-Host "`n=== All bots/services dispatched for Bitget, Binance, Mexc, Metamask & Cloudflare Workers. ==="