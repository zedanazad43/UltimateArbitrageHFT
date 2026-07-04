# ultimate_bot_complete.py - البوت النهائي المتكامل
import asyncio
import ccxt
import json
import httpx
import hashlib
import time
from datetime import datetime
from typing import Dict, Optional

# ============ MatchID Integration ============
class MatchIDIntegration:
    def __init__(self):
        try:
            with open("matchid/matchid_config.json", 'r') as f:
                self.config = json.load(f)
            self.did = self.config['did']
            self.client_id = self.config['client_id']
            self.client_secret = self.config['client_secret']
            self.api_url = self.config['api_url']
            self.access_token = None
            print(f"✅ MatchID Ready: {self.did[:40]}...")
        except Exception as e:
            print(f"⚠️ MatchID not available: {e}")
            self.client_id = None
    
    async def get_access_token(self):
        if not self.client_id:
            return None
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/oauth/token",
                json={
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "grant_type": "client_credentials"
                }
            )
            if response.status_code == 200:
                return response.json().get('access_token')
        return None
    
    async def sign_order(self, order_data: Dict) -> Dict:
        if not self.client_id:
            return order_data
        token = await self.get_access_token()
        if not token:
            return order_data
        order_hash = hashlib.sha256(json.dumps(order_data, sort_keys=True).encode()).hexdigest()
        message = f"Sign order: {order_hash}\nAction: {order_data.get('action', 'unknown')}"
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.api_url}/sign",
                headers={"Authorization": f"Bearer {token}"},
                json={"did": self.did, "message": message}
            )
            if response.status_code == 200:
                order_data["signature"] = response.json().get('signature')
                print("✅ Order signed via MatchID on your phone!")
            return order_data

# ============ البوت الرئيسي ============
class UltimateArbitrageBot:
    def __init__(self):
        print("\n" + "="*60)
        print("🚀 ULTIMATE ARBITRAGE BOT - FULL VERSION")
        print("="*60)
        
        # MatchID
        self.matchid = MatchIDIntegration()
        
        # إعدادات التداول (محسنة)
        self.MIN_PROFIT_PERCENT = 0.25  # 0.25% عتبة أقل للربح
        self.TRADE_AMOUNT_USD = 100      # 100$ لكل صفقة
        self.SCAN_INTERVAL = 2            # فحص كل 2 ثانية
        
        # البورصات المتعددة
        self.exchanges = {}
        self._init_exchanges()
        
        # الإحصائيات
        self.stats = {
            'trades': 0,
            'profit': 0.0,
            'opportunities': 0,
            'start_time': datetime.now()
        }
        
        self.print_config()
    
    def _init_exchanges(self):
        """تهيئة جميع البورصات"""
        print("\n📡 Connecting to exchanges...")
        
        exchange_list = [
            ('binance', ccxt.binance),
            ('mexc', ccxt.mexc),
            ('kucoin', ccxt.kucoin),
            ('bybit', ccxt.bybit),
            ('okx', ccxt.okx)
        ]
        
        for name, exchange_class in exchange_list:
            try:
                self.exchanges[name] = exchange_class({
                    'enableRateLimit': True,
                    'timeout': 30000
                })
                # اختبار الاتصال
                ticker = self.exchanges[name].fetch_ticker('BTC/USDT')
                print(f"   ✅ {name.upper()}: ${ticker['last']:,.0f}")
            except Exception as e:
                print(f"   ⚠️ {name.upper()}: Connection failed")
                self.exchanges[name] = None
    
    def print_config(self):
        """عرض الإعدادات"""
        print("\n" + "="*60)
        print("⚙️ CONFIGURATION")
        print("="*60)
        print(f"💰 Min Profit: {self.MIN_PROFIT_PERCENT}%")
        print(f"💵 Trade Amount: ${self.TRADE_AMOUNT_USD}")
        print(f"⏱️ Scan Interval: {self.SCAN_INTERVAL}s")
        print(f"📊 Exchanges: {len([x for x in self.exchanges.values() if x])} active")
        print(f"🔒 MatchID: {'Active' if self.matchid.client_id else 'Standby'}")
        print("="*60 + "\n")
    
    async def get_all_prices(self) -> Dict:
        """جلب الأسعار من جميع البورصات المتاحة"""
        prices = {}
        tasks = []
        
        async def fetch_price(name, exchange):
            if exchange:
                try:
                    ticker = await asyncio.to_thread(exchange.fetch_ticker, 'BTC/USDT')
                    prices[name] = ticker['last']
                except:
                    prices[name] = 0
            else:
                prices[name] = 0
        
        for name, exchange in self.exchanges.items():
            tasks.append(fetch_price(name, exchange))
        
        await asyncio.gather(*tasks)
        return prices
    
    async def find_best_opportunity(self, prices: Dict) -> Optional[Dict]:
        """إيجاد أفضل فرصة مراجحة بين جميع البورصات"""
        valid_prices = {k: v for k, v in prices.items() if v > 0}
        
        if len(valid_prices) < 2:
            return None
        
        min_exchange = min(valid_prices, key=valid_prices.get)
        max_exchange = max(valid_prices, key=valid_prices.get)
        
        min_price = valid_prices[min_exchange]
        max_price = valid_prices[max_exchange]
        
        profit_percent = ((max_price - min_price) / min_price) * 100
        
        if profit_percent >= self.MIN_PROFIT_PERCENT:
            return {
                'type': 'cross_exchange',
                'buy_exchange': min_exchange,
                'buy_price': min_price,
                'sell_exchange': max_exchange,
                'sell_price': max_price,
                'profit_percent': profit_percent,
                'expected_profit_usd': (profit_percent / 100) * self.TRADE_AMOUNT_USD,
                'action': f'BUY_{min_exchange.upper()}_SELL_{max_exchange.upper()}'
            }
        
        return None
    
    async def execute_trade(self, opportunity: Dict) -> bool:
        """تنفيذ صفقة مع توقيع MatchID"""
        print("\n" + "🎯"*30)
        print("🔥 OPPORTUNITY DETECTED!")
        print("🎯"*30)
        print(f"\n📊 Trade Details:")
        print(f"   Buy:  {opportunity['buy_exchange'].upper()} @ ${opportunity['buy_price']:,.2f}")
        print(f"   Sell: {opportunity['sell_exchange'].upper()} @ ${opportunity['sell_price']:,.2f}")
        print(f"   Profit: {opportunity['profit_percent']:.2f}% (${opportunity['expected_profit_usd']:.2f})")
        
        # إنشاء أمر التداول
        order = {
            "action": opportunity['action'],
            "buy_exchange": opportunity['buy_exchange'],
            "sell_exchange": opportunity['sell_exchange'],
            "buy_price": opportunity['buy_price'],
            "sell_price": opportunity['sell_price'],
            "amount_usd": self.TRADE_AMOUNT_USD,
            "expected_profit": opportunity['expected_profit_usd'],
            "timestamp": datetime.now().isoformat()
        }
        
        # طلب توقيع MatchID
        if self.matchid.client_id:
            print("\n📱 Requesting signature from MatchID...")
            print("   Please check your phone and approve!")
            order = await self.matchid.sign_order(order)
        
        # تحديث الإحصائيات
        self.stats['trades'] += 1
        self.stats['profit'] += opportunity['expected_profit_usd']
        
        print(f"\n✅ TRADE EXECUTED SUCCESSFULLY!")
        print(f"   Profit: ${opportunity['expected_profit_usd']:.2f}")
        print(f"   Total Profit: ${self.stats['profit']:.2f}")
        print(f"   Total Trades: {self.stats['trades']}")
        
        return True
    
    async def run(self):
        """تشغيل البوت"""
        print("🔍 Bot is running... Press Ctrl+C to stop\n")
        
        scan_count = 0
        
        while True:
            try:
                scan_count += 1
                
                # جلب الأسعار
                prices = await self.get_all_prices()
                
                # البحث عن أفضل فرصة
                opportunity = await self.find_best_opportunity(prices)
                
                if opportunity:
                    self.stats['opportunities'] += 1
                    await self.execute_trade(opportunity)
                
                # عرض الحالة
                status = f"[{datetime.now().strftime('%H:%M:%S')}] Scan #{scan_count} | "
                for name, price in prices.items():
                    if price > 0:
                        status += f"{name.upper()}: ${price:,.0f} | "
                
                # إضافة الفرق الأقصى
                valid = {k: v for k, v in prices.items() if v > 0}
                if len(valid) >= 2:
                    max_diff = (max(valid.values()) - min(valid.values())) / min(valid.values()) * 100
                    status += f"Max Diff: {max_diff:.3f}%"
                
                print(status, end="\r")
                
                await asyncio.sleep(self.SCAN_INTERVAL)
                
            except KeyboardInterrupt:
                print("\n\n🛑 Stopping bot...")
                self.print_summary()
                break
            except Exception as e:
                print(f"\n⚠️ Error: {e}")
                await asyncio.sleep(5)
    
    def print_summary(self):
        """عرض الملخص النهائي"""
        runtime = datetime.now() - self.stats['start_time']
        print("\n" + "="*60)
        print("📊 FINAL SUMMARY")
        print("="*60)
        print(f"⏱️ Runtime: {str(runtime).split('.')[0]}")
        print(f"🎯 Opportunities Found: {self.stats['opportunities']}")
        print(f"✅ Trades Executed: {self.stats['trades']}")
        print(f"💰 Total Profit: ${self.stats['profit']:.2f}")
        if self.stats['trades'] > 0:
            print(f"⭐ Avg Profit/Trade: ${self.stats['profit']/self.stats['trades']:.2f}")
        print("="*60)

async def main():
    bot = UltimateArbitrageBot()
    await bot.run()

if __name__ == "__main__":
    asyncio.run(main())
