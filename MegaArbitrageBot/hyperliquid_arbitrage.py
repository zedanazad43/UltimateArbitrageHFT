# hyperliquid_arbitrage.py - مراجحة Hyperliquid عبر MetaMask
import asyncio
import json
import hashlib
import hmac
import time
import httpx
from web3 import Web3
from eth_account import Account

class HyperliquidArbitrage:
    def __init__(self, private_key: str, address: str):
        self.private_key = private_key
        self.address = address
        self.api_url = "https://api.hyperliquid.xyz"
        
        print(f"✅ Hyperliquid Arbitrage ready for {address}")
    
    async def get_funding_rates(self):
        """جلب نسب التمويل الحالية"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/info",
                json={"type": "fundingHistory"}
            )
            return response.json()
    
    async def get_perp_prices(self, coin: str = "BTC"):
        """جلب أسعار العقود الدائمة"""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.api_url}/info",
                json={"type": "l2Book", "coin": coin}
            )
            data = response.json()
            return {
                'bid': float(data['levels'][0][0]['px']),
                'ask': float(data['levels'][0][1]['px'])
            }
    
    async def check_funding_arbitrage(self):
        """فحص فرص مراجحة نسب التمويل"""
        funding_rates = await self.get_funding_rates()
        
        for rate in funding_rates:
            coin = rate.get('coin', '')
            funding_rate = float(rate.get('fundingRate', 0))
            
            # إذا كانت نسبة التمويل > 0.05% في الساعة
            if abs(funding_rate) > 0.0005:
                action = "SHORT" if funding_rate > 0 else "LONG"
                return {
                    'found': True,
                    'coin': coin,
                    'funding_rate': funding_rate,
                    'action': action,
                    'profit_percent': abs(funding_rate) * 100,
                    'strategy': 'funding_arbitrage'
                }
        
        return {'found': False}

async def test():
    PRIVATE_KEY = "0xcc5d940a52ced4f1eea7459e932893e2c4278d57"
    ADDRESS = "0xbf725439B03B9AB013200c6eF1E2d1Fb395F46fE"
    
    bot = HyperliquidArbitrage(PRIVATE_KEY, ADDRESS)
    opp = await bot.check_funding_arbitrage()
    
    if opp['found']:
        print(f"🎯 Funding Arbitrage on {opp['coin']}: {opp['action']} at {opp['profit_percent']:.4f}%/hour")

if __name__ == "__main__":
    asyncio.run(test())
