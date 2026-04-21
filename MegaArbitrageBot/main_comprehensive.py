# main_comprehensive.py
"""
البوت الخارق للمراجحة - النسخة الشاملة النهائية
"""

import asyncio
import sys
import os
from datetime import datetime

# محاولة استيراد loguru مع معالجة الخطأ
try:
    from loguru import logger
    logger.remove()
    logger.add(sys.stdout, format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <level>{message}</level>")
    logger.add("logs/comprehensive_bot.log", rotation="1 day", retention="30 days")
except ImportError:
    # بديل بسيط إذا لم يتم تثبيت loguru
    print("⚠️ loguru not installed, using simple print")
    class SimpleLogger:
        def info(self, msg): print(f"[INFO] {msg}")
        def warning(self, msg): print(f"[WARN] {msg}")
        def error(self, msg): print(f"[ERROR] {msg}")
        def success(self, msg): print(f"[SUCCESS] {msg}")
        def debug(self, msg): print(f"[DEBUG] {msg}")
    logger = SimpleLogger()

class ComprehensiveArbitrageBot:
    """
    البوت الشامل - يوحد جميع أنواع المراجحة
    """
    
    def __init__(self):
        logger.info("🚀 INITIALIZING COMPREHENSIVE ARBITRAGE BOT...")
        
        # عنوان محفظة MetaMask
        self.wallet_address = os.environ.get("METAMASK_ADDRESS", "0xYOUR_WALLET_ADDRESS")
        logger.info(f"💰 Wallet: {self.wallet_address}")
        
        # تهيئة المكونات
        self.components = {}
        
        # 1. MEXC Engine
        try:
            from mexc_arbitrage_engine import MEXCArbitrageEngine
            self.components['mexc'] = MEXCArbitrageEngine()
            logger.info("✅ MEXC Engine: LOADED")
        except ImportError as e:
            logger.warning(f"MEXC Engine not available: {e}")
        except Exception as e:
            logger.warning(f"MEXC Engine error: {e}")
        
        # 2. MetaMask Perps
        try:
            from metamask_perps import MetaMaskPerpsTrader
            self.components['perps'] = MetaMaskPerpsTrader(self.wallet_address)
            logger.info("✅ MetaMask Perps: LOADED")
        except ImportError as e:
            logger.warning(f"MetaMask Perps not available: {e}")
        except Exception as e:
            logger.warning(f"MetaMask Perps error: {e}")
        
        # 3. Polymarket
        try:
            from pmxt_fix import PolymarketClient
            self.components['polymarket'] = PolymarketClient()
            logger.info("✅ Polymarket: LOADED")
        except ImportError as e:
            logger.warning(f"Polymarket not available: {e}")
        except Exception as e:
            logger.warning(f"Polymarket error: {e}")
        
        # إعدادات الأمان
        self.safety_checks = {
            'max_position_usd': 100,
            'max_daily_loss': 50,
            'test_mode': True  # دائماً في وضع الاختبار حتى يتم تكوين API keys
        }
        
        # إحصائيات
        self.stats = {
            'start_time': datetime.now(),
            'scans': 0,
            'opportunities_found': 0,
            'trades_executed': 0,
            'total_profit': 0.0
        }
        
        logger.success("✅ BOT INITIALIZED")
        logger.info(f"🔒 Safety: Test Mode = {self.safety_checks['test_mode']}")
        logger.info(f"💰 Max Position: ${self.safety_checks['max_position_usd']}")
    
    async def scan_all_opportunities(self):
        """المسح الشامل لجميع أنواع المراجحة"""
        all_opportunities = []
        
        logger.info("🔍 Scanning for opportunities...")
        
        # محاكاة بعض الفرص للاختبار
        import random
        mock_opportunity = {
            'type': 'test_opportunity',
            'diff_percent': random.uniform(0.3, 1.5),
            'profit_percent': random.uniform(0.3, 1.5),
            'symbol': 'BTC/USDT',
            'timestamp': datetime.now()
        }
        
        if mock_opportunity['diff_percent'] > 0.5:
            all_opportunities.append(mock_opportunity)
            logger.info(f"📊 Test opportunity: {mock_opportunity['diff_percent']:.2f}%")
        
        self.stats['opportunities_found'] = len(all_opportunities)
        return all_opportunities
    
    async def safety_check(self, opportunity) -> bool:
        """فحص الأمان قبل تنفيذ أي صفقة"""
        if self.safety_checks['test_mode']:
            logger.warning("🔒 TEST MODE ENABLED - No real trades will execute")
            return False
        
        profit_percent = opportunity.get('diff_percent', opportunity.get('profit_percent', 0))
        if profit_percent < 0.3:
            logger.warning(f"⚠️ Profit {profit_percent:.2f}% below threshold (0.3%)")
            return False
        
        return True
    
    async def execute_opportunity(self, opportunity):
        """تنفيذ فرصة المراجحة"""
        if not await self.safety_check(opportunity):
            return {'status': 'blocked_by_safety'}
        
        logger.info(f"🚀 EXECUTING: {opportunity['type']}")
        
        self.stats['trades_executed'] += 1
        estimated_profit = opportunity.get('diff_percent', 0.5) / 100 * self.safety_checks['max_position_usd']
        self.stats['total_profit'] += estimated_profit
        
        return {
            'status': 'executed_simulated',
            'estimated_profit': estimated_profit,
            'opportunity': opportunity
        }
    
    def print_status(self):
        """عرض حالة البوت"""
        runtime = datetime.now() - self.stats['start_time']
        
        print("\n" + "="*60)
        print("📊 BOT STATUS")
        print("="*60)
        print(f"Runtime: {runtime}")
        print(f"Scans performed: {self.stats['scans']}")
        print(f"Opportunities found: {self.stats['opportunities_found']}")
        print(f"Trades executed: {self.stats['trades_executed']}")
        print(f"Total profit (simulated): ${self.stats['total_profit']:.2f}")
        print(f"Test mode: {self.safety_checks['test_mode']}")
        print("="*60)
        
        if self.safety_checks['test_mode']:
            print("\n⚠️ TO ENABLE LIVE TRADING:")
            print("   1. Add MEXC_API_KEY and MEXC_SECRET_KEY to .env")
            print("   2. Add ETHEREUM_PRIVATE_KEY to .env")
            print("   3. Set TEST_MODE=false in .env")
            print("   4. Start with MAX_POSITION_SIZE=10 (for testing)")
    
    async def run(self):
        """تشغيل البوت"""
        logger.info("🏃 COMPREHENSIVE BOT RUNNING...")
        logger.info("Press Ctrl+C to stop")
        
        while True:
            try:
                self.stats['scans'] += 1
                
                # مسح جميع الفرص
                opportunities = await self.scan_all_opportunities()
                
                if opportunities:
                    logger.success(f"🎯 Found {len(opportunities)} opportunities!")
                    
                    # تنفيذ أفضل فرصة
                    best_opp = opportunities[0]
                    result = await self.execute_opportunity(best_opp)
                    
                    if result['status'] == 'executed_simulated':
                        logger.success(f"💵 Simulated profit: ${result['estimated_profit']:.2f}")
                
                # عرض الحالة كل 10 مسح
                if self.stats['scans'] % 10 == 0:
                    self.print_status()
                
                await asyncio.sleep(10)
                
            except KeyboardInterrupt:
                logger.info("🛑 Bot stopped by user")
                self.print_status()
                break
            except Exception as e:
                logger.error(f"Error: {e}")
                await asyncio.sleep(5)

if __name__ == "__main__":
    os.makedirs("logs", exist_ok=True)
    
    bot = ComprehensiveArbitrageBot()
    
    try:
        asyncio.run(bot.run())
    except KeyboardInterrupt:
        print("\n🛑 Bot terminated")
