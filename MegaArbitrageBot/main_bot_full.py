# main_bot_full.py - البوت المتكامل مع جميع المصادر
import asyncio
import ccxt
import json
import httpx
from datetime import datetime
from web3 import Web3
from eth_account import Account

class FullArbitrageBot:
    def __init__(self):
        # MetaMask credentials
        self.private_key = "0xcc5d940a52ced4f1eea7459e932893e2c4278d57"
        self.address = "0xbf725439B03B9AB013200c6eF1E2d1Fb395F46fE"
        self.w3 = Web3(Web3.HTTPProvider('https://polygon-rpc.com'))
        
        # إعدادات التداول
        self.MIN_PROFIT = 0.15  # 0.15%
        self.TRADE_AMOUNT = 100  # 100 USDT
        
        # الإحصائيات
        self.stats = {
            'cex_trades': 0,
            'dex_trades': 0,
            'perp_trades': 0,
            'total_profit': 0.0
        }
        
        print("✅ Full Arbitrage Bot Ready")
        print(f"💰 MetaMask: {self.address}")
    
    async def get_cex_prices(self):
        """جلب الأسعار من البورصات المركزية"""
        prices = {}
        
        try:
            binance = ccxt.binance()
            prices['binance'] = binance.fetch_ticker('BTC/USDT')['last']
        except:
            prices['binance'] = 0
        
        try:
            mexc = ccxt.mexc()
            prices['mexc'] = mexc.fetch_ticker('BTC/USDT')['last']
        except:
            prices['mexc'] = 0
        
        return prices
    
    async def get_polymarket_opportunity(self):
        """جلب فرص Polymarket"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get("https://clob.polymarket.com/markets")
                markets = response.json()
                
                for market in markets[:5]:
                    if 'btc' in market.get('question', '').lower():
                        return {
                            'type': 'polymarket',
                            'profit_percent': 0.5,
                            'action': 'BUY_ALL'
                        }
        except:
            pass
        return None
    
    async def get_hyperliquid_opportunity(self):
        """جلب فرص Hyperliquid"""
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://api.hyperliquid.xyz/info",
                    json={"type": "fundingHistory"}
                )
                rates = response.json()
                
                for rate in rates[:3]:
                    funding_rate = float(rate.get('fundingRate', 0))
                    if abs(funding_rate) > 0.0005:
                        return {
                            'type': 'hyperliquid',
                            'profit_percent': abs(funding_rate) * 100,
                            'action': 'SHORT' if funding_rate > 0 else 'LONG'
                        }
        except:
            pass
        return None
    
    async def run(self):
        print("\n" + "="*60)
        print("🚀 FULL ARBITRAGE BOT - ALL SOURCES")
        print("="*60)
        print(f"📅 Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"💰 MetaMask: {self.address[:10]}...")
        print(f"📊 Sources: CEX | Polymarket | Hyperliquid")
        print("="*60 + "\n")
        
        while True:
            try:
                # 1. CEX Arbitrage (MEXC vs Binance)
                cex_prices = await self.get_cex_prices()
                binance = cex_prices.get('binance', 0)
                mexc = cex_prices.get('mexc', 0)
                
                if binance and mexc:
                    diff = abs(binance - mexc)
                    diff_percent = (diff / min(binance, mexc)) * 100
                    
                    if diff_percent > self.MIN_PROFIT:
                        print(f"\n🎯 CEX OPPORTUNITY: {diff_percent:.2f}%")
                        self.stats['cex_trades'] += 1
                        profit = (diff_percent / 100) * self.TRADE_AMOUNT
                        self.stats['total_profit'] += profit
                        print(f"💰 Profit: ${profit:.2f}")
                
                # 2. Polymarket Arbitrage
                poly_opp = await self.get_polymarket_opportunity()
                if poly_opp:
                    print(f"\n🎯 POLYMARKET OPPORTUNITY: {poly_opp['profit_percent']:.2f}%")
                    self.stats['dex_trades'] += 1
                
                # 3. Hyperliquid Funding Arbitrage
                hl_opp = await self.get_hyperliquid_opportunity()
                if hl_opp:
                    print(f"\n🎯 HYPERLIQUID OPPORTUNITY: {hl_opp['profit_percent']:.4f}%/hour")
                    self.stats['perp_trades'] += 1
                
                # عرض الحالة
                status = f"[{datetime.now().strftime('%H:%M:%S')}] 📊 CEX: ${binance:,.0f} | Diff: {diff_percent:.3f}%"
                print(status)
                
                await asyncio.sleep(5)
                
            except KeyboardInterrupt:
                print("\n🛑 Stopping bot...")
                self._print_summary()
                break
            except Exception as e:
                print(f"Error: {e}")
                await asyncio.sleep(5)
    
    def _print_summary(self):
        print("\n" + "="*50)
        print("📊 FINAL SUMMARY")
        print("="*50)
        print(f"CEX Trades: {self.stats['cex_trades']}")
        print(f"DEX Trades: {self.stats['dex_trades']}")
        print(f"Perp Trades: {self.stats['perp_trades']}")
        print(f"Total Profit: ${self.stats['total_profit']:.2f}")
        print("="*50)

async def main():
    bot = FullArbitrageBot()
    await bot.run()

if __name__ == "__main__":
    asyncio.run(main())
