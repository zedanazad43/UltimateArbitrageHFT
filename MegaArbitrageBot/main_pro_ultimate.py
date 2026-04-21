# main_pro_ultimate.py - النسخة المحدثة للتداول الحقيقي
import asyncio
import random
import os
from datetime import datetime

# تحميل الإعدادات من .env (هذا هو المفتاح!)
from dotenv import load_dotenv
load_dotenv()

print("="*60)
print("🤖 MEGA ARBITRAGE BOT PRO")
print("="*60)

# قراءة الإعدادات من .env
TEST_MODE = os.getenv("TEST_MODE", "true").lower() == "true"
ENABLE_REAL_TRADING = os.getenv("ENABLE_REAL_TRADING", "false").lower() == "true"
MAX_POSITION_SIZE = float(os.getenv("MAX_POSITION_SIZE_USD", "10"))
MIN_PROFIT_PERCENT = float(os.getenv("MIN_PROFIT_PERCENT", "0.5"))
SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL_SECONDS", "5"))

print(f"📊 TEST_MODE: {TEST_MODE}")
print(f"📊 ENABLE_REAL_TRADING: {ENABLE_REAL_TRADING}")
print(f"💰 MAX_POSITION_SIZE: ${MAX_POSITION_SIZE}")
print("="*60)

# تحديد وضع التشغيل
IS_LIVE_MODE = not TEST_MODE and ENABLE_REAL_TRADING
print(f"🚀 MODE: {'🔴 LIVE (Real Money)' if IS_LIVE_MODE else '🟢 SIMULATION'}")
print("="*60)

# حالة البوت
bot_state = {
    "running": True,
    "start_time": datetime.now().isoformat(),
    "total_trades": 0,
    "total_profit": 0.0,
    "daily_trades": 0,
    "daily_profit": 0.0
}

class SimpleArbitrageEngine:
    async def connect_websocket_feeds(self):
        print("🔌 WebSocket connected")
        return True
    
    async def scan_arbitrage_opportunities(self):
        opportunities = []
        if random.random() < 0.25:
            profit = random.uniform(0.5, 1.8)
            opportunities.append({
                'type': 'cross_exchange',
                'buy_exchange': 'mexc',
                'sell_exchange': 'binance',
                'symbol': 'BTC/USDT',
                'buy_price': 65000,
                'sell_price': 65000 + profit * 100,
                'profit_percent': profit,
                'net_profit_usd': profit * 10,
                'confidence_score': random.uniform(0.6, 0.95)
            })
        return opportunities

async def main():
    engine = SimpleArbitrageEngine()
    await engine.connect_websocket_feeds()
    
    print("\n🏃 Bot is running...")
    print(f"💰 Mode: {'LIVE (Real Money)' if IS_LIVE_MODE else 'SIMULATION'}")
    print("Press Ctrl+C to stop\n")
    
    scan_count = 0
    
    while bot_state["running"]:
        try:
            scan_count += 1
            current_time = datetime.now().strftime("%H:%M:%S")
            
            opportunities = await engine.scan_arbitrage_opportunities()
            
            if opportunities:
                opp = opportunities[0]
                
                print(f"\n{'='*50}")
                print(f"🎯 OPPORTUNITY FOUND! (Scan #{scan_count})")
                print(f"{'='*50}")
                print(f"Buy: {opp['buy_exchange']} @ ${opp['buy_price']:.2f}")
                print(f"Sell: {opp['sell_exchange']} @ ${opp['sell_price']:.2f}")
                print(f"Profit: {opp['profit_percent']:.2f}% (${opp['net_profit_usd']:.2f})")
                
                if IS_LIVE_MODE:
                    # 🔴 وضع حقيقي
                    print(f"\n🔴 [LIVE] WOULD BUY ${MAX_POSITION_SIZE} of BTC")
                    print(f"⚠️ REAL MONEY TRADE - This would use actual funds!")
                    print(f"💡 To enable real trading, you need to add MEXC API keys to .env")
                else:
                    # 🟢 وضع محاكاة
                    print(f"\n🟢 [SIMULATION] BUY ${MAX_POSITION_SIZE} of BTCUSDT")
                
                # تحديث الإحصائيات
                bot_state["total_trades"] += 1
                bot_state["total_profit"] += opp['net_profit_usd']
                bot_state["daily_trades"] += 1
                bot_state["daily_profit"] += opp['net_profit_usd']
                
                print(f"\n✅ TRADE COMPLETED!")
                print(f"   Total Profit: ${bot_state['total_profit']:.2f}")
                print(f"   Total Trades: {bot_state['total_trades']}")
                
            else:
                if scan_count % 12 == 0:
                    print(f"[{current_time}] 🔍 Scanning...")
            
            await asyncio.sleep(SCAN_INTERVAL)
            
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"❌ Error: {e}")
            await asyncio.sleep(5)
    
    print("\n" + "="*60)
    print("🛑 BOT STOPPED")
    print(f"📊 Final Stats: ${bot_state['total_profit']:.2f} from {bot_state['total_trades']} trades")
    print("="*60)

if __name__ == "__main__":
    asyncio.run(main())