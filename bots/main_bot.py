# main_bot.py - البوت الرئيسي النهائي
import asyncio
import json
import os
import sys
from datetime import datetime
from typing import Dict, Optional

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from src.secure_key_manager import SecureKeyManager, import_keys_from_txt, ExchangeType
from src.integrated_trading_engine import IntegratedTradingEngine

class MegaArbitrageBot:
    def __init__(self, master_password: str, enable_live_trading: bool = True):
        self.master_password = master_password
        self.enable_live_trading = enable_live_trading
        self.key_manager = None
        self.trading_engine = None
        self.keys_file = os.path.join(os.path.dirname(__file__), "keys", "api_keys.txt")
        self.is_running = False
        self.stats = {
            'start_time': None,
            'total_trades': 0,
            'total_profit_usd': 0.0,
            'opportunities_found': 0,
            'opportunities_taken': 0
        }
        self._initialize()
    
    def _initialize(self):
        self.key_manager = SecureKeyManager(self.master_password)
        
        if os.path.exists(self.keys_file):
            print(f"📂 Found keys file: {self.keys_file}")
            import_keys_from_txt(self.keys_file, self.key_manager)
        else:
            print(f"⚠️ Keys file not found: {self.keys_file}")
        
        self.trading_engine = IntegratedTradingEngine(self.key_manager)
        
        configured = self.key_manager.list_configured_exchanges()
        print(f"✅ Configured exchanges: {configured}")

    def _validate_live_trading_keys(self):
        if not self.enable_live_trading:
            return
        if not self.key_manager:
            raise RuntimeError("SecureKeyManager is not initialized.")

        required_exchanges = [ExchangeType.MEXC, ExchangeType.BINANCE]
        missing_exchanges = [
            exchange.value.upper()
            for exchange in required_exchanges
            if not self.key_manager.verify_keys(exchange)
        ]

        if missing_exchanges:
            raise RuntimeError(
                "Live trading requires valid API keys in keys/api_keys.txt for: "
                + ", ".join(missing_exchanges)
            )
    
    async def start(self):
        self._validate_live_trading_keys()

        print("\n" + "="*60)
        print("🚀 MEGA ARBITRAGE BOT - ULTIMATE EDITION")
        print("="*60)
        print(f"📅 Starting at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"🔴 Live Trading: {'ENABLED' if self.enable_live_trading else 'DISABLED'}")
        print(f"💱 Exchanges: {', '.join(self.key_manager.list_configured_exchanges())}")
        print("="*60 + "\n")
        
        self.is_running = True
        self.stats['start_time'] = datetime.now()
        
        # عرض الأرصدة
        balances = await self.trading_engine.get_balances()
        for exchange, balance in balances.items():
            print(f"💰 {exchange.upper()}: {balance}")
        
        # بدء WebSocket streams
        ws_task = asyncio.create_task(self.trading_engine.start_websocket_streams())
        
        scan_count = 0
        
        while self.is_running:
            try:
                scan_count += 1
                opportunity = await self.trading_engine.get_arbitrage_opportunity()
                
                if opportunity:
                    self.stats['opportunities_found'] += 1
                    
                    print(f"\n🎯 OPPORTUNITY #{self.stats['opportunities_found']}")
                    print(f"   Type: {opportunity['type']}")
                    print(f"   Buy: {opportunity['buy_exchange'].upper()} @ ${opportunity['buy_price']:.2f}")
                    print(f"   Sell: {opportunity['sell_exchange'].upper()} @ ${opportunity['sell_price']:.2f}")
                    print(f"   Profit: {opportunity['profit_percent']:.3f}%")
                    
                    if self.enable_live_trading and opportunity['profit_percent'] > 0.5:
                        self.stats['opportunities_taken'] += 1
                        trade_amount = 50  # 50 USDT for testing
                        result = await self.trading_engine.execute_trade(opportunity, trade_amount)
                        
                        if result.get('status') == 'executed':
                            profit = result.get('results', {}).get('actual_profit_usd', 0)
                            self.stats['total_trades'] += 1
                            self.stats['total_profit_usd'] += profit
                            
                            print(f"\n✅ TRADE EXECUTED!")
                            print(f"   Profit: ${profit:.2f}")
                            print(f"   Total Profit: ${self.stats['total_profit_usd']:.2f}")
                            print(f"   Total Trades: {self.stats['total_trades']}")
                
                if scan_count % 30 == 0:
                    self._print_stats()
                
                await asyncio.sleep(2)
                
            except KeyboardInterrupt:
                print("\n🛑 Stopping bot...")
                break
            except Exception as e:
                print(f"Error: {e}")
                await asyncio.sleep(5)
        
        self.is_running = False
        ws_task.cancel()
        self._print_stats()
        print("\n👋 Bot stopped. Goodbye!")
    
    def _print_stats(self):
        runtime = datetime.now() - self.stats['start_time'] if self.stats['start_time'] else datetime.now() - datetime.now()
        print("\n" + "="*50)
        print("📊 BOT STATISTICS")
        print("="*50)
        print(f"Runtime: {str(runtime).split('.')[0]}")
        print(f"Opportunities found: {self.stats['opportunities_found']}")
        print(f"Opportunities taken: {self.stats['opportunities_taken']}")
        print(f"Total trades: {self.stats['total_trades']}")
        print(f"Total profit: ${self.stats['total_profit_usd']:.2f}")
        print("="*50 + "\n")

async def main():
    MASTER_PASSWORD = os.getenv("MASTER_PASSWORD", "")
    ENABLE_REAL_TRADING = os.getenv("ENABLE_REAL_TRADING", "false").lower() == "true"
    if not MASTER_PASSWORD:
        print("❌ MASTER_PASSWORD environment variable is required.")
        sys.exit(1)
    bot = MegaArbitrageBot(MASTER_PASSWORD, enable_live_trading=ENABLE_REAL_TRADING)
    await bot.start()

if __name__ == "__main__":
    asyncio.run(main())
