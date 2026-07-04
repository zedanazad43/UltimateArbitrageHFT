# realistic_arbitrage.py - استراتيجية ربح واقعية
import asyncio
import ccxt
from datetime import datetime

class RealisticArbitrageBot:
    def __init__(self):
        self.MIN_PROFIT = 0.6  # 0.6% كحد أدنى واقعي
        self.TRADE_AMOUNT = 100
        
        # بورصات متعددة لزيادة الفرص
        self.exchanges = {
            'binance': ccxt.binance(),
            'mexc': ccxt.mexc(),
            'kucoin': ccxt.kucoin(),
            'bybit': ccxt.bybit()
        }
        
        self.stats = {'trades': 0, 'profit': 0.0}
    
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
    
    async def find_best_opportunity(self, prices):
        """إيجاد أفضل فرصة"""
        valid_prices = {k: v for k, v in prices.items() if v > 0}
        
        if len(valid_prices) < 2:
            return None
        
        min_exchange = min(valid_prices, key=valid_prices.get)
        max_exchange = max(valid_prices, key=valid_prices.get)
        
        min_price = valid_prices[min_exchange]
        max_price = valid_prices[max_exchange]
        
        profit_percent = ((max_price - min_price) / min_price) * 100
        
        if profit_percent >= self.MIN_PROFIT:
            return {
                'buy_exchange': min_exchange,
                'buy_price': min_price,
                'sell_exchange': max_exchange,
                'sell_price': max_price,
                'profit_percent': profit_percent
            }
        return None
    
    async def run(self):
        print("🚀 REALISTIC ARBITRAGE BOT")
        print(f"✅ Min Profit: {self.MIN_PROFIT}%")
        print(f"📊 Exchanges: {', '.join(self.exchanges.keys())}\n")
        
        while True:
            prices = await self.get_all_prices()
            opportunity = await self.find_best_opportunity(prices)
            
            if opportunity:
                profit = (opportunity['profit_percent'] / 100) * self.TRADE_AMOUNT
                print(f"\n🎯 OPPORTUNITY FOUND!")
                print(f"   Buy: {opportunity['buy_exchange'].upper()} @ ${opportunity['buy_price']:,.0f}")
                print(f"   Sell: {opportunity['sell_exchange'].upper()} @ ${opportunity['sell_price']:,.0f}")
                print(f"   Profit: {opportunity['profit_percent']:.2f}% (${profit:.2f})")
                
                self.stats['trades'] += 1
                self.stats['profit'] += profit
            
            # عرض الحالة
            status = f"[{datetime.now().strftime('%H:%M:%S')}] "
            for ex, price in prices.items():
                status += f"{ex.upper()}: ${price:,.0f} | "
            print(status, end="\r")
            
            await asyncio.sleep(5)

async def main():
    bot = RealisticArbitrageBot()
    await bot.run()

if __name__ == "__main__":
    asyncio.run(main())
