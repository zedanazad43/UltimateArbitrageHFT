# main.py - Unified Arbitrage Bot
import asyncio
import os
import sys
import json
import ccxt
import random
import time
from datetime import datetime
from dotenv import load_dotenv
from typing import Dict, List, Optional
from dataclasses import dataclass
from loguru import logger

# تحميل الإعدادات
load_dotenv()

# إعداد التسجيل
logger.remove()
logger.add(sys.stdout, format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan> - <level>{message}</level>")
logger.add("logs/bot.log", rotation="1 day", retention="7 days")

# ============ الإعدادات ============
TEST_MODE = os.getenv("TEST_MODE", "true").lower() == "true"
ENABLE_REAL_TRADING = os.getenv("ENABLE_REAL_TRADING", "false").lower() == "true"
ENABLE_BINANCE_ARBITRAGE = os.getenv("ENABLE_BINANCE_ARBITRAGE", "false").lower() == "true"
ENABLE_POLYMARKET = os.getenv("ENABLE_POLYMARKET", "false").lower() == "true"
MAX_POSITION = float(os.getenv("MAX_POSITION_SIZE_USD", "10"))
MIN_PROFIT = float(os.getenv("MIN_PROFIT_PERCENT", "0.5"))
SCAN_INTERVAL = int(os.getenv("SCAN_INTERVAL_SECONDS", "5"))

# ============ حالة البوت ============
bot_state = {
    "running": True,
    "start_time": datetime.now().isoformat(),
    "total_trades": 0,
    "total_profit": 0.0,
    "daily_trades": 0,
    "daily_profit": 0.0
}

# ============ تهيئة البورصات ============
class ExchangeManager:
    def __init__(self):
        self.mexc = None
        self.binance = None
        self.init_exchanges()
    
    def init_exchanges(self):
        try:
            self.mexc = ccxt.mexc({
                'apiKey': os.getenv("MEXC_API_KEY"),
                'secret': os.getenv("MEXC_SECRET_KEY"),
                'enableRateLimit': True,
                'options': {'createMarketBuyOrderRequiresPrice': False}
            })
            self.mexc.load_markets()
            logger.info("✅ MEXC Connected")
        except Exception as e:
            logger.error(f"MEXC connection failed: {e}")
        
        if ENABLE_BINANCE_ARBITRAGE:
            try:
                self.binance = ccxt.binance({
                    'apiKey': os.getenv("BINANCE_API_KEY"),
                    'secret': os.getenv("BINANCE_SECRET_KEY"),
                    'enableRateLimit': True,
                })
                self.binance.load_markets()
                logger.info("✅ Binance Connected")
            except Exception as e:
                logger.error(f"Binance connection failed: {e}")
    
    async def get_mexc_price(self, symbol="BTC/USDT") -> float:
        try:
            ticker = self.mexc.fetch_ticker(symbol)
            return ticker['last']
        except:
            return 0
    
    async def get_binance_price(self, symbol="BTC/USDT") -> float:
        if not self.binance:
            return 0
        try:
            ticker = self.binance.fetch_ticker(symbol)
            return ticker['last']
        except:
            return 0

# ============ محرك المراجحة ============
@dataclass
class ArbitrageOpportunity:
    type: str
    buy_exchange: str
    sell_exchange: str
    symbol: str
    buy_price: float
    sell_price: float
    profit_percent: float
    profit_usd: float

class ArbitrageEngine:
    def __init__(self, exchange_manager):
        self.exchange_manager = exchange_manager
        self.opportunities_found = 0
    
    async def scan_cross_exchange_arbitrage(self) -> List[ArbitrageOpportunity]:
        """مراجحة بين MEXC و Binance"""
        opportunities = []
        
        symbol = "BTC/USDT"
        mexc_price = await self.exchange_manager.get_mexc_price(symbol)
        binance_price = await self.exchange_manager.get_binance_price(symbol)
        
        if mexc_price == 0 or binance_price == 0:
            return opportunities
        
        # شراء من MEXC وبيع في Binance
        if binance_price > mexc_price:
            profit_percent = ((binance_price - mexc_price) / mexc_price) * 100
            if profit_percent >= MIN_PROFIT:
                profit_usd = (profit_percent / 100) * MAX_POSITION
                opportunities.append(ArbitrageOpportunity(
                    type="cross_exchange",
                    buy_exchange="MEXC",
                    sell_exchange="Binance",
                    symbol=symbol,
                    buy_price=mexc_price,
                    sell_price=binance_price,
                    profit_percent=profit_percent,
                    profit_usd=profit_usd
                ))
        
        # شراء من Binance وبيع في MEXC
        if mexc_price > binance_price and self.exchange_manager.binance:
            profit_percent = ((mexc_price - binance_price) / binance_price) * 100
            if profit_percent >= MIN_PROFIT:
                profit_usd = (profit_percent / 100) * MAX_POSITION
                opportunities.append(ArbitrageOpportunity(
                    type="cross_exchange",
                    buy_exchange="Binance",
                    sell_exchange="MEXC",
                    symbol=symbol,
                    buy_price=binance_price,
                    sell_price=mexc_price,
                    profit_percent=profit_percent,
                    profit_usd=profit_usd
                ))
        
        return opportunities
    
    async def execute_trade(self, opportunity: ArbitrageOpportunity) -> Dict:
        """تنفيذ صفقة المراجحة"""
        logger.info(f"\n{'='*50}")
        logger.info(f"🎯 EXECUTING ARBITRAGE")
        logger.info(f"{'='*50}")
        logger.info(f"Type: {opportunity.type}")
        logger.info(f"Buy: {opportunity.buy_exchange} @ ${opportunity.buy_price:.2f}")
        logger.info(f"Sell: {opportunity.sell_exchange} @ ${opportunity.sell_price:.2f}")
        logger.info(f"Profit: {opportunity.profit_percent:.2f}% (${opportunity.profit_usd:.2f})")
        
        if TEST_MODE or not ENABLE_REAL_TRADING:
            logger.info(f"🟢 [SIMULATION] Would execute trade")
            bot_state["total_trades"] += 1
            bot_state["total_profit"] += opportunity.profit_usd
            bot_state["daily_trades"] += 1
            bot_state["daily_profit"] += opportunity.profit_usd
            return {"status": "simulated", "profit": opportunity.profit_usd}
        
        # التداول الحقيقي
        try:
            if opportunity.buy_exchange == "MEXC":
                order = self.exchange_manager.mexc.create_market_buy_order(
                    opportunity.symbol, 
                    MAX_POSITION / opportunity.buy_price
                )
                logger.info(f"✅ BUY order executed: {order['id']}")
            else:
                order = self.exchange_manager.binance.create_market_buy_order(
                    opportunity.symbol,
                    MAX_POSITION / opportunity.buy_price
                )
                logger.info(f"✅ BUY order executed: {order['id']}")
            
            bot_state["total_trades"] += 1
            bot_state["total_profit"] += opportunity.profit_usd
            
            return {"status": "executed", "order_id": order['id']}
            
        except Exception as e:
            logger.error(f"❌ Trade failed: {e}")
            return {"status": "failed", "error": str(e)}

# ============ البوت الرئيسي ============
class UnifiedArbitrageBot:
    def __init__(self):
        logger.info("="*60)
        logger.info("🚀 UNIFIED ARBITRAGE BOT - ULTIMATE EDITION")
        logger.info("="*60)
        
        self.exchange_manager = ExchangeManager()
        self.arbitrage_engine = ArbitrageEngine(self.exchange_manager)
        
        logger.info(f"📊 Mode: {'🔴 REAL MONEY' if not TEST_MODE and ENABLE_REAL_TRADING else '🟢 SIMULATION'}")
        logger.info(f"💰 Max Position: ${MAX_POSITION}")
        logger.info(f"📈 Min Profit: {MIN_PROFIT}%")
        logger.info(f"🕐 Scan Interval: {SCAN_INTERVAL}s")
        logger.info("="*60)
    
    async def run(self):
        logger.info("🏃 Bot is running... Press Ctrl+C to stop\n")
        
        scan_count = 0
        daily_reset_time = datetime.now().date()
        
        while bot_state["running"]:
            try:
                scan_count += 1
                current_time = datetime.now().strftime("%H:%M:%S")
                
                # إعادة تعيين يومي
                if datetime.now().date() != daily_reset_time:
                    daily_reset_time = datetime.now().date()
                    bot_state["daily_trades"] = 0
                    bot_state["daily_profit"] = 0.0
                    logger.info("📅 Daily stats reset")
                
                # فحص فرص المراجحة
                opportunities = await self.arbitrage_engine.scan_cross_exchange_arbitrage()
                
                if opportunities:
                    best = opportunities[0]
                    logger.info(f"\n[{current_time}] 🎯 Opportunity! (Scan #{scan_count})")
                    await self.arbitrage_engine.execute_trade(best)
                else:
                    if scan_count % 12 == 0:
                        logger.info(f"[{current_time}] 🔍 Scanning... (no opportunities)")
                
                await asyncio.sleep(SCAN_INTERVAL)
                
            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error(f"Error: {e}")
                await asyncio.sleep(5)
        
        self.print_summary()
    
    def print_summary(self):
        logger.info("\n" + "="*60)
        logger.info("🛑 BOT STOPPED")
        logger.info(f"📊 Total Profit: ${bot_state['total_profit']:.2f}")
        logger.info(f"📈 Total Trades: {bot_state['total_trades']}")
        logger.info(f"📉 Daily Profit: ${bot_state['daily_profit']:.2f}")
        logger.info("="*60)

async def main():
    bot = UnifiedArbitrageBot()
    await bot.run()

if __name__ == "__main__":
    asyncio.run(main())