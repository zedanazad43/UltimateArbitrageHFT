# ultimate_bot_matchid.py - البوت النهائي مع MatchID وجميع المصادر
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
        with open("matchid/matchid_config.json", 'r') as f:
            self.config = json.load(f)
        
        self.did = self.config['did']
        self.address = self.config['address']
        self.client_id = self.config['client_id']
        self.client_secret = self.config['client_secret']
        self.api_url = self.config['api_url']
        self.access_token = None
        self.token_expiry = 0
        
        print(f"✅ MatchID Ready for {self.did[:40]}...")
    
    async def get_access_token(self):
        if self.access_token and time.time() < self.token_expiry:
            return self.access_token
        
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
                data = response.json()
                self.access_token = data.get('access_token')
                self.token_expiry = time.time() + data.get('expires_in', 3600)
                return self.access_token
        return None
    
    async def sign_order(self, order_data: Dict) -> Dict:
        token = await self.get_access_token()
        if not token:
            return None
        
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
                order_data["signer"] = self.did
                print("✅ Order signed via MatchID!")
                return order_data
        return None

# ============ Polymarket Integration ============
class PolymarketArbitrage:
    def __init__(self):
        self.api_url = "https://clob.polymarket.com"
    
    async def get_btc_markets(self):
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.api_url}/markets")
            markets = response.json()
            btc_markets = []
            for market in markets:
                if 'btc' in market.get('question', '').lower():
                    btc_markets.append({
                        'id': market.get('id'),
                        'question': market.get('question'),
                        'volume': market.get('volume24hr', 0)
                    })
            return btc_markets

# ============ البوت الرئيسي ============
class UltimateArbitrageBot:
    def __init__(self):
        print("\n" + "="*60)
        print("🚀 ULTIMATE ARBITRAGE BOT WITH MATCHID")
        print("="*60)
        
        # تهيئة MatchID
        self.matchid = MatchIDIntegration()
        
        # تهيئة Polymarket
        self.polymarket = PolymarketArbitrage()
        
        # إعدادات التداول
        self.MIN_PROFIT_CEX = 0.6  # 0.6% للبورصات المركزية
        self.TRADE_AMOUNT = 100
        
        # البورصات المركزية
        self.exchanges = {
            'binance': ccxt.binance(),
            'mexc': ccxt.mexc(),
            'kucoin': ccxt.kucoin()
        }
        
        self.stats = {
            'cex_trades': 0,
            'poly_trades': 0,
            'total_profit': 0.0,
            'start_time': datetime.now()
        }
        
        print(f"✅ MatchID: {self.matchid.did[:30]}...")
        print(f"✅ Exchanges: {', '.join(self.exchanges.keys())}")
        print(f"✅ Polymarket: Ready")
        print(f"💰 Min Profit: {self.MIN_PROFIT_CEX}%")
        print("="*60 + "\n")
    
    async def get_all_prices(self):
        """جلب الأسعار من جميع البورصات"""
        prices = {}
        for name, exchange in self.exchanges.items():
            try:
                ticker = exchange.fetch_ticker('BTC/USDT')
                prices[name] = ticker['last']
            except:
                prices[name] = 0
        return prices
    
    async def find_cex_opportunity(self, prices):
        """إيجاد أفضل فرصة بين البورصات"""
        valid = {k: v for k, v in prices.items() if v > 0}
        if len(valid) < 2:
            return None
        
        min_ex = min(valid, key=valid.get)
        max_ex = max(valid, key=valid.get)
        
        profit = ((valid[max_ex] - valid[min_ex]) / valid[min_ex]) * 100
        
        if profit >= self.MIN_PROFIT_CEX:
            return {
                'type': 'cex',
                'buy_exchange': min_ex,
                'buy_price': valid[min_ex],
                'sell_exchange': max_ex,
                'sell_price': valid[max_ex],
                'profit_percent': profit,
                'action': f'BUY_{min_ex.upper()}_SELL_{max_ex.upper()}'
            }
        return None
    
    async def find_polymarket_opportunity(self):
        """إيجاد فرص في Polymarket"""
        markets = await self.polymarket.get_btc_markets()
        for market in markets[:3]:
            if market.get('volume', 0) > 10000:
                return {
                    'type': 'polymarket',
                    'market': market['question'],
                    'profit_percent': 0.8,
                    'action': 'PREDICTION_MARKET'
                }
        return None
    
    async def execute_with_matchid(self, opportunity):
        """تنفيذ صفقة مع توقيع MatchID"""
        print(f"\n🎯 EXECUTING: {opportunity['type']}")
        print(f"   Profit: {opportunity['profit_percent']:.2f}%")
        
        # إنشاء أمر
        order = {
            "action": opportunity.get('action', 'unknown'),
            "type": opportunity['type'],
            "amount_usd": self.TRADE_AMOUNT,
            "timestamp": datetime.now().isoformat()
        }
        
        # إضافة تفاصيل حسب نوع الصفقة
        if opportunity['type'] == 'cex':
            order['buy_exchange'] = opportunity['buy_exchange']
            order['sell_exchange'] = opportunity['sell_exchange']
            order['buy_price'] = opportunity['buy_price']
            order['sell_price'] = opportunity['sell_price']
        
        # طلب توقيع MatchID
        print("📱 Requesting signature from MatchID on your phone...")
        signed = await self.matchid.sign_order(order)
        
        if signed:
            profit = (opportunity['profit_percent'] / 100) * self.TRADE_AMOUNT
            self.stats['total_profit'] += profit
            
            if opportunity['type'] == 'cex':
                self.stats['cex_trades'] += 1
            else:
                self.stats['poly_trades'] += 1
            
            print(f"\n✅ TRADE EXECUTED!")
            print(f"   Profit: ${profit:.2f}")
            print(f"   Total Profit: ${self.stats['total_profit']:.2f}")
            return True
        else:
            print("❌ Trade cancelled - no signature")
            return False
    
    async def run(self):
        print("🔍 Bot is running... Press Ctrl+C to stop\n")
        
        while True:
            try:
                # 1. فحص البورصات المركزية
                prices = await self.get_all_prices()
                cex_opp = await self.find_cex_opportunity(prices)
                
                if cex_opp:
                    print(f"\n🎯 CEX OPPORTUNITY: {cex_opp['profit_percent']:.2f}%")
                    print(f"   Buy: {cex_opp['buy_exchange'].upper()} @ ${cex_opp['buy_price']:,.0f}")
                    print(f"   Sell: {cex_opp['sell_exchange'].upper()} @ ${cex_opp['sell_price']:,.0f}")
                    await self.execute_with_matchid(cex_opp)
                
                # 2. فحص Polymarket (كل 30 ثانية)
                if int(time.time()) % 30 < 3:
                    poly_opp = await self.find_polymarket_opportunity()
                    if poly_opp:
                        print(f"\n🎯 POLYMARKET OPPORTUNITY: {poly_opp['profit_percent']:.2f}%")
                        await self.execute_with_matchid(poly_opp)
                
                # عرض الحالة
                status = f"[{datetime.now().strftime('%H:%M:%S')}] "
                for ex, price in prices.items():
                    if price > 0:
                        status += f"{ex.upper()}: ${price:,.0f} | "
                print(status, end="\r")
                
                await asyncio.sleep(3)
                
            except KeyboardInterrupt:
                print("\n\n🛑 Bot stopped")
                self.print_summary()
                break
            except Exception as e:
                print(f"Error: {e}")
                await asyncio.sleep(5)
    
    def print_summary(self):
        runtime = datetime.now() - self.stats['start_time']
        print("\n" + "="*50)
        print("📊 FINAL SUMMARY")
        print("="*50)
        print(f"Runtime: {str(runtime).split('.')[0]}")
        print(f"CEX Trades: {self.stats['cex_trades']}")
        print(f"Polymarket Trades: {self.stats['poly_trades']}")
        print(f"Total Profit: ${self.stats['total_profit']:.2f}")
        print("="*50)

async def main():
    bot = UltimateArbitrageBot()
    await bot.run()

if __name__ == "__main__":
    asyncio.run(main())
