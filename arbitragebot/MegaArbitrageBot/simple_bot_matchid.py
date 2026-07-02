# simple_bot_matchid.py - نسخة مبسطة للاختبار
import asyncio
import ccxt
import json
import httpx
import hashlib
import time
from datetime import datetime

class SimpleMatchIDBot:
    def __init__(self):
        print("\n" + "="*60)
        print("🚀 SIMPLE ARBITRAGE BOT WITH MATCHID")
        print("="*60)
        
        # تحميل إعدادات MatchID
        try:
            with open("matchid/matchid_config.json", 'r') as f:
                config = json.load(f)
            self.client_id = config['client_id']
            self.client_secret = config['client_secret']
            self.did = config['did']
            print(f"✅ MatchID Loaded: {self.did[:30]}...")
        except Exception as e:
            print(f"❌ MatchID config error: {e}")
            self.client_id = None
        
        # إعدادات التداول
        self.MIN_PROFIT = 0.6
        self.TRADE_AMOUNT = 100
        
        # البورصات
        self.exchanges = {
            'binance': ccxt.binance(),
            'mexc': ccxt.mexc()
        }
        
        self.stats = {'trades': 0, 'profit': 0.0}
        print(f"✅ Exchanges: {', '.join(self.exchanges.keys())}")
        print("="*60 + "\n")
    
    async def get_prices(self):
        prices = {}
        for name, ex in self.exchanges.items():
            try:
                ticker = ex.fetch_ticker('BTC/USDT')
                prices[name] = ticker['last']
            except:
                prices[name] = 0
        return prices
    
    async def run(self):
        print("🔍 Scanning... Press Ctrl+C to stop\n")
        
        while True:
            try:
                prices = await self.get_prices()
                binance = prices.get('binance', 0)
                mexc = prices.get('mexc', 0)
                
                if binance and mexc:
                    diff = abs(binance - mexc)
                    diff_percent = (diff / min(binance, mexc)) * 100
                    
                    status = f"[{datetime.now().strftime('%H:%M:%S')}] "
                    status += f"Binance: ${binance:,.0f} | MEXC: ${mexc:,.0f} | Diff: {diff_percent:.3f}%"
                    
                    if diff_percent >= self.MIN_PROFIT:
                        status += " 🎯 OPPORTUNITY!"
                        print(f"\n{status}")
                        print(f"   Profit would be: ${(diff_percent/100) * self.TRADE_AMOUNT:.2f}")
                        print(f"   (Trade requires MatchID signature on phone)")
                    else:
                        print(status, end="\r")
                
                await asyncio.sleep(3)
                
            except KeyboardInterrupt:
                print("\n\n🛑 Bot stopped")
                break
            except Exception as e:
                print(f"Error: {e}")
                await asyncio.sleep(5)

async def main():
    bot = SimpleMatchIDBot()
    await bot.run()

if __name__ == "__main__":
    asyncio.run(main())
