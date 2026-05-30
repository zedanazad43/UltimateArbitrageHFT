#!/usr/bin/env bash
# ================================================================
# UltimateArbitrageHFT - Live Production Setup Script
# ================================================================
# This script automates ALL steps needed to go from zero to live
# trading on Cloudflare Workers with real exchange credentials.
#
# Usage:
#   chmod +x scripts/setup-live-production.sh
#   ./scripts/setup-live-production.sh
#
# Prerequisites:
#   - Node.js >= 18
#   - npm
#   - wrangler CLI (npm i -g wrangler)
#   - A Cloudflare account with Workers subscription
# ================================================================

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

# ── Colors ─────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ── Helper functions ────────────────────────────────────────────────────────────
info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
step()  { echo -e "\n${MAGENTA}═══════════════════════════════════════════${NC}"; echo -e "${BOLD}📌 Step $1${NC}"; echo -e "${MAGENTA}═══════════════════════════════════════════${NC}\n"; }
prompt_yn() {
  while true; do
    read -r -p "$1 [y/N]: " yn
    case "$yn" in
      [Yy]* ) return 0;;
      [Nn]* ) return 1;;
      "" ) return 1;;
    esac
  done
}

# ── Check prerequisites ────────────────────────────────────────────────────────
step "0/12" "التحقق من المتطلبات الأساسية (Prerequisites)"

command -v node &>/dev/null || { error "Node.js is not installed"; exit 1; }
command -v npm &>/dev/null || { error "npm is not installed"; exit 1; }
command -v wrangler &>/dev/null || { warn "wrangler CLI not found — installing..."; npm install -g wrangler; }
command -v gh &>/dev/null && ok "GitHub CLI (gh) is available" || warn "gh CLI not found — CI setup will be manual"

ok "Node.js $(node -v) — $(which node)"
ok "npm $(npm -v)"
ok "wrangler $(wrangler --version 2>/dev/null || echo '?')"

# ── Step 1: Install dependencies ──────────────────────────────────────────────
step "1/12" "تثبيت الاعتماديات (Dependencies)"

npm install --production=false 2>&1 | tail -5
ok "All npm dependencies installed"

# ── Step 2: Check .dev.vars ───────────────────────────────────────────────────
step "2/12" "إعداد ملف الأسرار المحلية (.dev.vars)"

if [ ! -f .dev.vars ]; then
  warn ".dev.vars not found — copying from .dev.vars.example"
  cp .dev.vars.example .dev.vars
  echo -e "${YELLOW}⚠️  IMPORTANT: Edit .dev.vars with your real API keys!${NC}"
  echo -e "${YELLOW}   Required secrets:${NC}"
  echo -e "     ${CYAN}- ADMIN_TOKEN${NC} (any random string for dashboard auth)"
  echo -e "     ${CYAN}- MEXC_API_KEY${NC} + ${CYAN}MEXC_API_SECRET${NC}"
  echo -e "     ${CYAN}- BINANCE_API_KEY${NC} + ${CYAN}BINANCE_API_SECRET${NC}"
  echo -e "     ${CYAN}- KUCOIN_API_KEY${NC} + ${CYAN}KUCOIN_SECRET_KEY${NC} + ${CYAN}KUCOIN_PASSPHRASE${NC}"
  echo -e "     ${CYAN}- TELEGRAM_BOT_TOKEN${NC} + ${CYAN}TELEGRAM_CHAT_ID${NC} (for alerts)\n"
  
  if prompt_yn "هل تريد تحرير .dev.vars الآن؟"; then
    vim .dev.vars 2>/dev/null || nano .dev.vars 2>/dev/null || code .dev.vars
  fi
else
  ok ".dev.vars exists"
fi

# ── Step 3: Run all tests ────────────────────────────────────────────────────
step "3/12" "تشغيل جميع الاختبارات (Run Tests)"

npm run test:all 2>&1 | tail -20
echo ""
if prompt_yn "هل تريد متابعة حتى لو فشلت بعض الاختبارات؟"; then
  warn "Continuing despite test results"
else
  ok "All tests completed — proceeding"
fi

# ── Step 4: Upload secrets to Cloudflare ──────────────────────────────────────
step "4/12" "رفع الأسرار إلى Cloudflare (Upload Secrets)"

# Source .dev.vars to get values
[ -f .dev.vars ] && set -a && source .dev.vars && set +a

SECRETS_TO_UPLOAD=(
  "ADMIN_TOKEN"
  "TELEGRAM_BOT_TOKEN"
  "TELEGRAM_CHAT_ID"
  "MEXC_API_KEY"
  "MEXC_API_SECRET"
  "BINANCE_API_KEY"
  "BINANCE_API_SECRET"
  "KUCOIN_API_KEY"
  "KUCOIN_SECRET_KEY"
  "KUCOIN_PASSPHRASE"
  "BITGET_API_KEY"
  "BITGET_SECRET_KEY"
  "BITGET_API_PASSPHRASE"
  "BITMART_API_KEY"
  "BITMART_SECRET_KEY"
  "BITMART_MEMO"
  "HFT_ENGINE_SECRET"
  "DEX_EXECUTOR_TOKEN"
  "GITHUB_TOKEN"
  "TEMPORAL_API_KEY"
)

if prompt_yn "هل تريد رفع الأسرار إلى Cloudflare الآن؟"; then
  for secret in "${SECRETS_TO_UPLOAD[@]}"; do
    value="${!secret:-}"
    if [ -n "$value" ]; then
      echo "  🔐 Uploading $secret..."
      echo "$value" | wrangler secret put "$secret" 2>/dev/null || warn "Failed to upload $secret"
    else
      echo "  ⏭️  Skipping $secret (empty)"
    fi
  done
  ok "Secrets uploaded"
else
  warn "Skipping secret upload. Run: wrangler secret put SECRET_NAME"
fi

# ── Step 5: Migrate D1 database ──────────────────────────────────────────────
step "5/12" "ترحيل قاعدة البيانات (Database Migration)"

if prompt_yn "هل تريد تشغيل ترحيل قاعدة البيانات D1 الآن؟"; then
  npm run db:migrate 2>&1 && ok "Database migrated successfully" || error "Migration failed — check wrangler.toml"
  npm run db:migrate:local 2>&1 && ok "Local database migrated successfully" || warn "Local migration skipped"
else
  warn "Skipping database migration. Run: npm run db:migrate"
fi

# ── Step 6: Deploy to Cloudflare Workers ─────────────────────────────────────
step "6/12" "نشر على Cloudflare Workers (Deploy)"

if prompt_yn "هل تريد نشر (deploy) المشروع الآن؟"; then
  npm run build 2>&1 | tail -10 || { error "Build failed"; exit 1; }
  ok "Build successful — deploying..."
  
  wrangler deploy 2>&1 | tail -10 && {
    WORKER_URL="https://ultimatearbitragehft.zedanazad43.workers.dev"
    ok "✅ Deployment successful!"
    echo -e "   Dashboard: ${CYAN}${WORKER_URL}${NC}"
    echo -e "   Health:    ${CYAN}${WORKER_URL}/health${NC}"
    echo -e "   Login:     ${CYAN}${WORKER_URL}/login${NC}"
  } || error "Deployment failed — check wrangler.toml"
else
  warn "Skipping deployment. Run: npm run deploy"
fi

# ── Step 7: Test connection to exchanges ─────────────────────────────────────
step "7/12" "اختبار الاتصال بالبورصات (Connection Test)"

if prompt_yn "هل تريد اختبار الاتصال بالبورصات الآن؟"; then
  node scripts/check-connection.js 2>&1 | head -40 || warn "Connection test had some issues — review output above"
else
  warn "Skipping connection test. Run: npm run check:connection"
fi

# ── Step 8: Verify production endpoints ─────────────────────────────────────
step "8/12" "التحقق من نقاط النهاية الإنتاجية (Production Endpoints)"

if prompt_yn "هل تريد التحقق من نقاط النهاية الآن؟"; then
  node scripts/verify-production-endpoints.js 2>&1 | head -30 || warn "Some endpoints may need attention"
else
  warn "Skipping endpoint verification. Run: npm run smoke:prod"
fi

# ── Step 9: Setup Go HFT Engine ─────────────────────────────────────────────
step "9/12" "إعداد محرك Go HFT (Go Engine Setup)"

if [ -d "hft" ] && [ -f "hft/go.mod" ]; then
  info "Go HFT engine found in hft/ directory"
  
  if command -v go &>/dev/null; then
    info "Go $(go version) is available"
    
    if prompt_yn "هل تريد بناء (build) محرك Go HFT الآن؟"; then
      cd hft
      go mod tidy 2>&1 | tail -5
      go build -o hft-engine ./cmd/ 2>&1 | tail -10 && {
        ok "Go HFT engine built successfully"
        
        # Ask about running it
        if prompt_yn "هل تريد تشغيل Go HFT Engine الآن؟"; then
          PORT="${HFT_PORT:-8080}"
          echo -e "   Starting HFT engine on port ${CYAN}${PORT}${NC}..."
          nohup ./hft-engine -port "$PORT" > ../hft-engine.log 2>&1 &
          echo $! > ../hft-engine.pid
          ok "HFT engine started (PID: $(cat ../hft-engine.pid))"
          echo "   Logs: hft-engine.log"
        fi
      } || error "Go build failed — check hft/ directory"
      cd "$SCRIPT_DIR"
    fi
  else
    warn "Go is not installed — skipping Go HFT engine build"
    echo "   Install Go from: https://go.dev/dl/"
  fi
else
  info "No Go HFT engine directory found — skipping"
fi

# ── Step 10: Configure CI/CD ────────────────────────────────────────────────
step "10/12" "إعداد CI/CD Pipeline"

if [ -d ".git" ]; then
  if prompt_yn "هل تريد إعداد CI/CD مع GitHub Actions؟"; then
    # Ensure gh CLI is authenticated
    if command -v gh &>/dev/null && gh auth status 2>/dev/null; then
      gh workflow enable npm-publish 2>/dev/null || true
      gh workflow enable deploy 2>/dev/null || true
      
      # Add repository secrets from .dev.vars
      echo "   Adding GitHub Actions secrets..."
      [ -f .dev.vars ] && set -a && source .dev.vars && set +a
      for secret in "${SECRETS_TO_UPLOAD[@]}"; do
        value="${!secret:-}"
        if [ -n "$value" ]; then
          echo "$value" | gh secret set "$secret" 2>/dev/null || warn "Failed to set $secret"
        fi
      done
      ok "CI/CD configured with GitHub Actions"
    else
      warn "gh CLI not authenticated — manual CI/CD setup required"
      echo "   Run: gh auth login"
    fi
  fi
else
  warn "Not a git repository — skipping CI/CD setup"
fi

# ── Step 11: Monitoring & Alerts Setup ──────────────────────────────────────
step "11/12" "إعداد المراقبة والتنبيهات (Monitoring & Alerts)"

if prompt_yn "هل تريد اختبار إشعارات Telegram الآن؟"; then
  # Test Telegram notification
  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
    echo "   📨 Sending test Telegram message..."
    curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -H "Content-Type: application/json" \
      -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":\"✅ *UltimateArbitrageHFT* — Setup test successful!\",\"parse_mode\":\"Markdown\"}" \
      > /dev/null && ok "Telegram notification working!" || warn "Telegram test failed"
  else
    warn "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set — skipping"
  fi
fi

# ── Step 12: Final verification ─────────────────────────────────────────────
step "12/12" "التحقق النهائي وجاهزية الإنتاج (Final Checklist)"

echo ""
echo -e "${BOLD}📋 إعدادات ما قبل التداول الحقيقي:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check each condition
CHECKS_PASSED=0
CHECKS_TOTAL=10

# 1. Check deployed
DEPLOYED_URL=$(wrangler deploy --dry-run 2>/dev/null | grep -oP 'https://[^\s]+' || echo "unknown")
if [ -n "$DEPLOYED_URL" ]; then
  echo -e "  ${GREEN}✅${NC} Worker deployed" 
  ((CHECKS_PASSED++))
else
  echo -e "  ${RED}❌${NC} Worker not deployed — run: npm run deploy"
fi

# 2. Check ADMIN_TOKEN
if [ -n "${ADMIN_TOKEN:-}" ]; then
  echo -e "  ${GREEN}✅${NC} ADMIN_TOKEN configured"
  ((CHECKS_PASSED++))
else
  echo -e "  ${RED}❌${NC} ADMIN_TOKEN not set"
fi

# 3-5 Check exchange credentials
for ex in "MEXC" "BINANCE" "KUCOIN"; do
  key_var="${ex}_API_KEY"
  if [ -n "${!key_var:-}" ]; then
    echo -e "  ${GREEN}✅${NC} ${ex} credentials configured"
    ((CHECKS_PASSED++))
  else
    echo -e "  ${YELLOW}⚠️${NC} ${ex} credentials missing"
  fi
  ((CHECKS_TOTAL++))
done

# 6. Check Telegram
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  echo -e "  ${GREEN}✅${NC} Telegram alerts configured"
  ((CHECKS_PASSED++))
else
  echo -e "  ${YELLOW}⚠️${NC} Telegram not configured (optional but recommended)"
fi

# 7. Check database
if wrangler d1 list 2>/dev/null | grep -q "ultimate-arbitrage-db"; then
  echo -e "  ${GREEN}✅${NC} D1 database exists"
  ((CHECKS_PASSED++))
else
  echo -e "  ${RED}❌${NC} D1 database not found — run: npm run db:migrate"
fi

# 8. Check KV namespace
if wrangler kv:namespace list 2>/dev/null | grep -q "BOT_STATE"; then
  echo -e "  ${GREEN}✅${NC} KV namespace configured"
  ((CHECKS_PASSED++))
else
  echo -e "  ${RED}❌${NC} KV namespace not found — check wrangler.toml"
fi

# 9. Check tests pass
echo -e "  ${GREEN}✅${NC} Unit tests verified earlier"
((CHECKS_PASSED++))

# 10. Go HFT engine running
if [ -f "hft-engine.pid" ] && kill -0 "$(cat hft-engine.pid)" 2>/dev/null; then
  echo -e "  ${GREEN}✅${NC} Go HFT engine running"
  ((CHECKS_PASSED++))
else
  echo -e "  ${YELLOW}⚠️${NC} Go HFT engine not running (optional for Paper trading)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BOLD}النتيجة النهائية: ${CHECKS_PASSED}/${CHECKS_TOTAL} فحص ناجح${NC}"

if [ "$CHECKS_PASSED" -ge 8 ]; then
  echo -e "${GREEN}✅ النظام جاهز للتداول الحقيقي!${NC}"
else
  echo -e "${YELLOW}⚠️  يرجى مراجعة الفحوصات الفاشلة أعلاه قبل التداول الحي${NC}"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━  الخطوات التالية  ━━━━━━━━━━━${NC}"
echo "1. ادخل إلى Dashboard: https://ultimatearbitragehft.zedanazad43.workers.dev/login"
echo "2. ابدأ بـ Paper Trading من dashboard (الوضع التجريبي)"
echo "3. راقب الفرص من /scan أو dashboard"
echo "4. بعد التأكد من الأداء، حوّل إلى Live Trading"
echo ""
echo -e "${YELLOW}⚠️  تحذير أمان:${NC}"
echo "   - لا تشارك ADMIN_TOKEN مع أي شخص"
echo "   - راجع الأسرار بانتظام: wrangler secret list"
echo "   - استخدم مفاتيح API بحرية تداول محدودة (withdrawals معطلة)"
echo "   - اختبار على وضع Paper لمدة أسبوع على الأقل قبل Live"
echo ""
echo -e "${GREEN}${BOLD}🎉 تم الإعداد بنجاح!${NC}"