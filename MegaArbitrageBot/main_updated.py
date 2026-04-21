import asyncio
import sys
import os
from datetime import datetime

# إضافة المجلد الحالي إلى مسار Python
sys.path.insert(0, os.getcwd())

# استيراد الوحدات
try:
    from wallet_manager import MetaMaskManager
    print("✅ wallet_manager imported")
except ImportError as e:
    print(f"⚠️ wallet_manager import error: {e}")

try:
    from mexc_arbitrage_engine import MEXCArbitrageEngine
    print("✅ mexc_arbitrage_engine imported")
except ImportError as e:
    print(f"⚠️ mexc_arbitrage_engine import error: {e}")

try:
    from pmxt_fix import PolymarketClient
    print("✅ pmxt_fix imported")
except ImportError as e:
    print(f"⚠️ pmxt_fix import error: {e}")

try:
    from flash_loan_fix import FlashLoanArbitrageV2
    print("✅ flash_loan_fix imported")
except ImportError as e:
    print(f"⚠️ flash_loan_fix import error: {e}")

# إعداد تسجيل بسيط
def log_message(msg, level="INFO"):
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"[{timestamp}] [{level}] {msg}")

class MegaArbitrageBotUpdated:
    """
    البوت الخارق الموحد - النسخة المصححة
    """
    
    def __init__(self):
        log_message("🚀 INITIALIZING MEGA ARBITRAGE BOT (FIXED VERSION)...")
        
        # تهيئة المكونات
        self.wallet = None
        self.mexc_engine = None
        self.polymarket = None
        self.flash_loan = None
        
        try:
            self.wallet = MetaMaskManager()
            log_message("✅ Wallet initialized")
        except Exception as e:
            log_message(f"⚠️ Wallet init failed: {e}", "WARNING")
        
        try:
            self.mexc_engine = MEXCArbitrageEngine()
            log_message("✅ MEXC Engine initialized")
        except Exception as e:
            log_message(f"⚠️ MEXC Engine init failed: {e}", "WARNING")
        
        try:
            self.polymarket = PolymarketClient()
            log_message("✅ Polymarket initialized")
        except Exception as e:
            log_message(f"⚠️ Polymarket init failed: {e}", "WARNING")
        
        try:
            self.flash_loan = FlashLoanArbitrageV2(self.wallet)
            log_message("✅ Flash Loan initialized")
        except Exception as e:
            log_message(f"⚠️ Flash Loan init failed: {e}", "WARNING")
        
        # إحصائيات البوت
        self.stats = {
            'start_time': datetime.now(),
            'total_opportunities': 0,
            'total_trades': 0,
            'total_profit': 0.0
        }
        
        log_message("✅ BOT INITIALIZATION COMPLETE")
    
    async def scan_all_markets(self):
        """
        المسح الشامل لجميع أنواع المراجحة
        """
        log_message("🔍 SCANNING ALL MARKETS...")
        
        all_opportunities = []
        
        # 1. MEXC Arbitrage Opportunities
        if self.mexc_engine:
            try:
                mexc_opps = await self.mexc_engine.scan_all_opportunities()
                if mexc_opps:
                    all_opportunities.extend(mexc_opps)
                    log_message(f"📊 Found {len(mexc_opps)} MEXC opportunities")
            except Exception as e:
                log_message(f"MEXC scan error: {e}", "ERROR")
        
        # 2. Polymarket Opportunities
        if self.polymarket:
            try:
                btc_markets = self.polymarket.get_btc_15min_markets()
                if btc_markets:
                    log_message(f"📊 Found {len(btc_markets)} Polymarket markets")
            except Exception as e:
                log_message(f"Polymarket scan error: {e}", "ERROR")
        
        # 3. Flash Loan Opportunities
        if self.flash_loan:
            try:
                flash_opp = await self.flash_loan.scan_dex_arbitrage()
                if flash_opp.get('found'):
                    all_opportunities.append(flash_opp)
                    log_message(f"📊 Flash Loan opportunity: {flash_opp.get('profit_percent', 0):.2f}%")
            except Exception as e:
                log_message(f"Flash Loan scan error: {e}", "ERROR")
        
        self.stats['total_opportunities'] = len(all_opportunities)
        
        return all_opportunities
    
    async def run(self):
        """
        تشغيل البوت بشكل مستمر
        """
        log_message("🏃 BOT IS RUNNING...")
        log_message("Press Ctrl+C to stop")
        
        scan_count = 0
        
        while True:
            try:
                scan_count += 1
                log_message(f"--- Scan #{scan_count} ---")
                
                opportunities = await self.scan_all_markets()
                
                if opportunities:
                    log_message(f"🎯 Found {len(opportunities)} opportunities!")
                    
                    for opp in opportunities:
                        profit = opp.get('diff_percent', opp.get('profit_percent', 0))
                        log_message(f"  - {opp.get('type', 'unknown')}: {profit:.2f}% profit")
                else:
                    log_message("No opportunities found in this scan")
                
                await asyncio.sleep(10)  # فحص كل 10 ثواني
                
            except KeyboardInterrupt:
                log_message("🛑 Bot stopped by user")
                break
            except Exception as e:
                log_message(f"Error in main loop: {e}", "ERROR")
                await asyncio.sleep(5)

if __name__ == "__main__":
    # إنشاء مجلد logs إذا لم يكن موجوداً
    os.makedirs("logs", exist_ok=True)
    
    # تشغيل البوت
    bot = MegaArbitrageBotUpdated()
    
    try:
        asyncio.run(bot.run())
    except KeyboardInterrupt:
        print("\n🛑 Bot terminated")
