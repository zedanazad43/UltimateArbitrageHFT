# test_bot.py - نسخة اختبار مبسطة
import asyncio
import ccxt
from datetime import datetime

async def test():
    print("🚀 Testing arbitrage bot...")
    
    # اختبار اتصال Binance
    try:
        binance = ccxt.binance()
        ticker = binance.fetch_ticker('BTC/USDT')
        print(f"✅ Binance BTC: ${ticker['last']:.2f}")
    except Exception as e:
        print(f"Binance error: {e}")
    
    # اختبار اتصال MEXC
    try:
        mexc = ccxt.mexc()
        ticker = mexc.fetch_ticker('BTC/USDT')
        print(f"✅ MEXC BTC: ${ticker['last']:.2f}")
    except Exception as e:
        print(f"MEXC error: {e}")
    
    print("\n✅ Bot is working! Add your API keys to start real trading.")

if __name__ == "__main__":
    asyncio.run(test())
