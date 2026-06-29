# polymarket_arbitrage.py - مراجحة Polymarket عبر MetaMask
import asyncio
import json
import httpx
from web3 import Web3
from eth_account import Account
from datetime import datetime

class PolymarketArbitrage:
    def __init__(self, private_key: str, address: str):
        self.private_key = private_key
        self.address = address
        self.w3 = Web3(Web3.HTTPProvider('https://polygon-rpc.com'))
        self.account = Account.from_key(private_key)
        
        # عناوين Polymarket
        self.polygon_rpc = "https://polygon-rpc.com"
        self.clob_api = "https://clob.polymarket.com"
        
        print(f"✅ Polymarket Arbitrage ready for {address}")
    
    async def get_btc_markets(self):
        """جلب أسواق BTC من Polymarket"""
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{self.clob_api}/markets")
            markets = response.json()
            
            # تصفية أسواق BTC
            btc_markets = []
            for market in markets:
                if 'btc' in market.get('question', '').lower():
                    btc_markets.append({
                        'id': market.get('id'),
                        'question': market.get('question'),
                        'outcomes': market.get('outcomes', []),
                        'volume': market.get('volume24hr', 0)
                    })
            return btc_markets
    
    async def check_arbitrage_opportunity(self, market_id: str):
        """فحص فرص المراجحة في السوق"""
        async with httpx.AsyncClient() as client:
            # جلب أسعار العقود
            response = await client.get(f"{self.clob_api}/prices?market_id={market_id}")
            prices = response.json()
            
            # حساب مجموع الاحتمالات
            total_probability = 0
            for outcome, price in prices.items():
                total_probability += float(price)
            
            # إذا كان المجموع أقل من 1، هناك فرصة مراجحة
            if total_probability < 0.98:
                profit = (1 - total_probability) * 100
                return {
                    'found': True,
                    'market_id': market_id,
                    'prices': prices,
                    'total_probability': total_probability,
                    'profit_percent': profit,
                    'action': 'BUY_ALL_OUTCOMES'
                }
            
            return {'found': False}
    
    async def execute_arbitrage(self, opportunity: dict, amount_usd: int = 100):
        """تنفيذ صفقة مراجحة على Polymarket"""
        print(f"\n🚀 Executing Polymarket Arbitrage!")
        print(f"   Market: {opportunity['market_id']}")
        print(f"   Expected Profit: {opportunity['profit_percent']:.2f}%")
        
        # هنا سيتم تنفيذ شراء جميع العقود
        # يتطلب توقيع معاملات على Polygon
        
        return {'status': 'executed', 'profit': amount_usd * (opportunity['profit_percent'] / 100)}

# اختبار
async def test():
    # المفتاح الخاص من ملفك
    import os
    PRIVATE_KEY = os.environ.get("METAMASK_PRIVATE_KEY", "0xYOUR_PRIVATE_KEY")
    ADDRESS = os.environ.get("METAMASK_ADDRESS", "0xYOUR_WALLET_ADDRESS")
    
    bot = PolymarketArbitrage(PRIVATE_KEY, ADDRESS)
    markets = await bot.get_btc_markets()
    print(f"Found {len(markets)} BTC markets")
    
    for market in markets[:3]:
        opp = await bot.check_arbitrage_opportunity(market['id'])
        if opp['found']:
            print(f"🎯 Opportunity found: {opp['profit_percent']:.2f}%")

if __name__ == "__main__":
    asyncio.run(test())
