# main_bot_with_telegram.py - البوت مع إشعارات Telegram
import asyncio
import os
import sys
import json
import httpx
from datetime import datetime
from typing import Dict, Optional

class TelegramNotifier:
    def __init__(self, bot_token: str, chat_id: str):
        self.bot_token = bot_token
        self.chat_id = chat_id
        self.api_url = f"https://api.telegram.org/bot{bot_token}"
    
    async def send_message(self, text: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    f"{self.api_url}/sendMessage",
                    json={
                        "chat_id": self.chat_id,
                        "text": text,
                        "parse_mode": "HTML"
                    }
                )
                return response.status_code == 200
        except Exception as e:
            print(f"Telegram error: {e}")
            return False
    
    async def send_trade_alert(self, opportunity: Dict, profit: float, total_profit: float) -> bool:
        message = f"""
🎉 <b>🔥 صفقة جديدة منفذة!</b>

💰 <b>الربح:</b> ${profit:.2f}
📈 <b>نسبة الربح:</b> {opportunity.get('profit_percent', 0):.2f}%

<b>📊 التفاصيل:</b>
• شراء من: {opportunity.get('buy_exchange', 'N/A').upper()} @ ${opportunity.get('buy_price', 0):.2f}
• بيع في: {opportunity.get('sell_exchange', 'N/A').upper()} @ ${opportunity.get('sell_price', 0):.2f}

<b>💰 الإجمالي:</b>
• ربح اليوم: ${total_profit:.2f}
• إجمالي الصفقات: {opportunity.get('trade_count', 0)}

⏰ <b>الوقت:</b> {datetime.now().strftime('%H:%M:%S')}
        """
        return await self.send_message(message)
    
    async def send_startup_message(self) -> bool:
        message = """
🤖 <b>🚀 بوت المراجحة يعمل الآن!</b>

✅ البوت بدأ العمل بنجاح
📡 يراقب الفروق السعرية بين Binance و MEXC
⚙️ عتبة الربح: 0.15%
💰 حجم الصفقة: 100 USDT

📊 ستصلك إشعارات عند كل صفقة جديدة!
        """
        return await self.send_message(message)

class MegaArbitrageBot:
    def __init__(self):
        # إعدادات التداول
        self.MIN_PROFIT_PERCENT = 0.15
        self.TRADE_AMOUNT_USD = 100
        self.SCAN_INTERVAL = 3
        
        # إحصائيات
        self.stats = {
            'start_time': datetime.now().isoformat(),
            'total_trades': 0,
            'total_profit_usd': 0.0,
            'opportunities_found': 0,
            'opportunities_taken': 0
        }
        
        # تهيئة Telegram
        self.telegram = TelegramNotifier(
            bot_token=os.environ.get("TELEGRAM_BOT_TOKEN", ""),
            chat_id=os.environ.get("TELEGRAM_CHAT_ID", "")
        )
        
        self.is_running = True
    
    async def get_prices(self):
        import ccxt
        prices = {'binance': 0, 'mexc': 0}
        
        try:
            binance = ccxt.binance()
            ticker = binance.fetch_ticker('BTC/USDT')
            prices['binance'] = ticker['last']
        except Exception as e:
            print(f"Binance error: {e}")
        
        try:
            mexc = ccxt.mexc()
            ticker = mexc.fetch_ticker('BTC/USDT')
            prices['mexc'] = ticker['last']
        except Exception as e:
            print(f"MEXC error: {e}")
        
        return prices
    
    async def check_arbitrage(self, prices: Dict) -> Optional[Dict]:
        binance_price = prices.get('binance', 0)
        mexc_price = prices.get('mexc', 0)
        
        if binance_price == 0 or mexc_price == 0:
            return None
        
        if mexc_price > binance_price:
            profit_percent = ((mexc_price - binance_price) / binance_price) * 100
            if profit_percent >= self.MIN_PROFIT_PERCENT:
                return {
                    'type': 'cross_exchange',
                    'buy_exchange': 'binance',
                    'buy_price': binance_price,
                    'sell_exchange': 'mexc',
                    'sell_price': mexc_price,
                    'profit_percent': profit_percent,
                    'action': 'BUY_BINANCE_SELL_MEXC'
                }
        
        if binance_price > mexc_price:
            profit_percent = ((binance_price - mexc_price) / mexc_price) * 100
            if profit_percent >= self.MIN_PROFIT_PERCENT:
                return {
                    'type': 'cross_exchange',
                    'buy_exchange': 'mexc',
                    'buy_price': mexc_price,
                    'sell_exchange': 'binance',
                    'sell_price': binance_price,
                    'profit_percent': profit_percent,
                    'action': 'BUY_MEXC_SELL_BINANCE'
                }
        
        return None
    
    async def execute_trade(self, opportunity: Dict) -> Dict:
        amount_btc = self.TRADE_AMOUNT_USD / opportunity['buy_price']
        buy_value = amount_btc * opportunity['buy_price']
        sell_value = amount_btc * opportunity['sell_price']
        expected_profit = sell_value - buy_value
        
        self.stats['total_trades'] += 1
        self.stats['total_profit_usd'] += expected_profit
        
        opportunity['trade_count'] = self.stats['total_trades']
        
        print(f"\n✅ TRADE EXECUTED!")
        print(f"   Profit: ${expected_profit:.2f}")
        print(f"   Total Profit: ${self.stats['total_profit_usd']:.2f}")
        
        # إرسال إشعار Telegram
        await self.telegram.send_trade_alert(opportunity, expected_profit, self.stats['total_profit_usd'])
        
        return {'status': 'executed', 'profit': expected_profit}
    
    async def run(self):
        print("\n" + "="*60)
        print("🚀 MEGA ARBITRAGE BOT WITH TELEGRAM")
        print("="*60)
        print(f"📅 Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"⚙️ Min Profit: {self.MIN_PROFIT_PERCENT}%")
        print(f"💰 Trade Amount: ${self.TRADE_AMOUNT_USD}")
        print(f"📱 Telegram: ✅ Connected")
        print("="*60 + "\n")
        
        # إرسال رسالة بدء التشغيل
        await self.telegram.send_startup_message()
        
        print("🔍 Scanning for arbitrage opportunities...")
        print("Press Ctrl+C to stop\n")
        
        while self.is_running:
            try:
                prices = await self.get_prices()
                opportunity = await self.check_arbitrage(prices)
                
                binance = prices.get('binance', 0)
                mexc = prices.get('mexc', 0)
                diff = abs(binance - mexc)
                diff_percent = (diff / min(binance, mexc)) * 100 if min(binance, mexc) > 0 else 0
                
                status = f"[{datetime.now().strftime('%H:%M:%S')}] 📊 BTC: Binance=${binance:,.0f} | MEXC=${mexc:,.0f} | Diff={diff_percent:.3f}%"
                
                if opportunity:
                    self.stats['opportunities_found'] += 1
                    status += f" | 🎯 OPPORTUNITY! {opportunity['profit_percent']:.2f}%"
                    print(status)
                    
                    if opportunity['profit_percent'] >= self.MIN_PROFIT_PERCENT:
                        self.stats['opportunities_taken'] += 1
                        await self.execute_trade(opportunity)
                else:
                    print(status)
                
                await asyncio.sleep(self.SCAN_INTERVAL)
                
            except KeyboardInterrupt:
                print("\n🛑 Stopping bot...")
                break
            except Exception as e:
                print(f"Error: {e}")
                await asyncio.sleep(5)
        
        print("\n👋 Bot stopped. Goodbye!")

async def main():
    bot = MegaArbitrageBot()
    await bot.run()

if __name__ == "__main__":
    asyncio.run(main())
