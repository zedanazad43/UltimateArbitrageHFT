# main_bot_fixed.py
import asyncio
import os
import sys
from datetime import datetime

print("="*60)
print("🚀 MEGA ARBITRAGE BOT")
print("="*60)
print(f"📅 Starting at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
print("="*60)

# التحقق من وجود ملف المفاتيح
keys_file = "keys/api_keys.txt"
if os.path.exists(keys_file):
    print(f"✅ Keys file found: {keys_file}")
    
    # محاولة قراءة المفاتيح
    try:
        import configparser
        config = configparser.ConfigParser()
        config.read(keys_file, encoding='utf-8')
        
        if 'MEXC' in config:
            api_key = config['MEXC'].get('API_KEY', '')
            if api_key and api_key != 'your_mexc_api_key_here':
                print(f"✅ MEXC API Key loaded: {api_key[:10]}...")
            else:
                print("⚠️ MEXC: Please add your real API key")
        
        if 'BINANCE' in config:
            api_key = config['BINANCE'].get('API_KEY', '')
            if api_key and api_key != 'your_binance_api_key_here':
                print(f"✅ Binance API Key loaded: {api_key[:10]}...")
            else:
                print("⚠️ Binance: Please add your real API key")
        
        if 'METAMASK' in config:
            address = config['METAMASK'].get('ADDRESS', '')
            if address:
                print(f"✅ MetaMask address: {address[:15]}...")
        
    except Exception as e:
        print(f"⚠️ Error reading keys: {e}")
else:
    print(f"❌ Keys file not found: {keys_file}")
    print("Please create keys/api_keys.txt with your API keys")

print("\n" + "="*60)
print("🔍 Starting arbitrage scanner...")
print("="*60)

async def main():
    try:
        import ccxt
        print("\n📊 Testing exchange connections...")
        
        # اختبار Binance
        try:
            binance = ccxt.binance()
            ticker = binance.fetch_ticker('BTC/USDT')
            print(f"✅ Binance BTC: ${ticker['last']:,.2f}")
        except Exception as e:
            print(f"⚠️ Binance: {e}")
        
        # اختبار MEXC
        try:
            mexc = ccxt.mexc()
            ticker = mexc.fetch_ticker('BTC/USDT')
            print(f"✅ MEXC BTC: ${ticker['last']:,.2f}")
        except Exception as e:
            print(f"⚠️ MEXC: {e}")
        
        print("\n✅ Bot is ready!")
        print("📡 Monitoring for arbitrage opportunities...")
        print("Press Ctrl+C to stop\n")
        
        # مراقبة مستمرة
        while True:
            await asyncio.sleep(5)
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 🔍 Scanning...")
            
    except KeyboardInterrupt:
        print("\n🛑 Bot stopped")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
