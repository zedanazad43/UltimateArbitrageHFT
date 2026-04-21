# integrated_trading_engine.py - نسخة مبسطة بدون ccxt-pro
import asyncio
import ccxt
from web3 import Web3
from eth_account import Account
from typing import Dict, Optional
from datetime import datetime
import websockets
import json
import sys
import os

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from src.secure_key_manager import ExchangeType

class IntegratedTradingEngine:
    def __init__(self, key_manager):
        self.key_manager = key_manager
        self.exchanges = {}
        self.web3 = None
        self.wallet_address = None
        
        self.realtime_prices = {
            'mexc': {'bid': 0, 'ask': 0, 'last': 0, 'timestamp': 0},
            'binance': {'bid': 0, 'ask': 0, 'last': 0, 'timestamp': 0}
        }
        
        self._setup_connections()
    
    def _setup_connections(self):
        # MEXC
        mexc_keys = self.key_manager.get_keys(ExchangeType.MEXC)
        if mexc_keys and mexc_keys.api_key and mexc_keys.api_secret:
            try:
                self.exchanges['mexc'] = ccxt.mexc({
                    'apiKey': mexc_keys.api_key,
                    'secret': mexc_keys.api_secret,
                    'enableRateLimit': True,
                    'options': {'defaultType': 'spot'}
                })
                print("✅ MEXC connected")
            except Exception as e:
                print(f"⚠️ MEXC connection failed: {e}")
        
        # Binance
        binance_keys = self.key_manager.get_keys(ExchangeType.BINANCE)
        if binance_keys and binance_keys.api_key and binance_keys.api_secret:
            try:
                self.exchanges['binance'] = ccxt.binance({
                    'apiKey': binance_keys.api_key,
                    'secret': binance_keys.api_secret,
                    'enableRateLimit': True,
                })
                print("✅ Binance connected")
            except Exception as e:
                print(f"⚠️ Binance connection failed: {e}")
        
        # MetaMask
        metamask_keys = self.key_manager.get_keys(ExchangeType.METAMASK)
        if metamask_keys and metamask_keys.wallet_address:
            self.wallet_address = metamask_keys.wallet_address
            self.web3 = Web3(Web3.HTTPProvider('https://polygon-rpc.com'))
            if metamask_keys.private_key:
                self.account = Account.from_key(metamask_keys.private_key)
                print(f"✅ MetaMask connected: {self.wallet_address}")
            else:
                print(f"✅ MetaMask (view only): {self.wallet_address}")
        
        print("✅ Integrated Trading Engine Ready")
    
    async def start_websocket_streams(self):
        async def mexc_ws():
            uri = "wss://wbs.mexc.com/ws"
            try:
                async with websockets.connect(uri) as ws:
                    subscribe = {
                        "method": "SUBSCRIPTION",
                        "params": ["spot@public.book.ticker.v3.api@BTCUSDT"]
                    }
                    await ws.send(json.dumps(subscribe))
                    async for message in ws:
                        data = json.loads(message)
                        if 'd' in data and 'b' in data['d']:
                            self.realtime_prices['mexc'] = {
                                'bid': float(data['d']['b']),
                                'ask': float(data['d']['a']),
                                'last': float(data['d']['b']),
                                'timestamp': datetime.now().timestamp()
                            }
            except Exception as e:
                print(f"MEXC WS error: {e}")
        
        async def binance_ws():
            uri = "wss://stream.binance.com:9443/ws/btcusdt@bookTicker"
            try:
                async with websockets.connect(uri) as ws:
                    async for message in ws:
                        data = json.loads(message)
                        self.realtime_prices['binance'] = {
                            'bid': float(data['b']),
                            'ask': float(data['a']),
                            'last': float(data['b']),
                            'timestamp': datetime.now().timestamp()
                        }
            except Exception as e:
                print(f"Binance WS error: {e}")
        
        tasks = []
        if 'mexc' in self.exchanges:
            tasks.append(mexc_ws())
        if 'binance' in self.exchanges:
            tasks.append(binance_ws())
        
        if tasks:
            await asyncio.gather(*tasks)
    
    async def get_arbitrage_opportunity(self) -> Optional[Dict]:
        mexc_price = self.realtime_prices['mexc']['bid']
        binance_price = self.realtime_prices['binance']['ask']
        
        if mexc_price == 0 or binance_price == 0:
            return None
        
        diff_binance_mexc = ((mexc_price - binance_price) / binance_price) * 100
        diff_mexc_binance = ((binance_price - mexc_price) / mexc_price) * 100
        
        if diff_binance_mexc > 0.3:
            return {
                'type': 'cross_exchange',
                'buy_exchange': 'binance',
                'buy_price': binance_price,
                'sell_exchange': 'mexc',
                'sell_price': mexc_price,
                'profit_percent': diff_binance_mexc,
                'action': 'BUY_BINANCE_SELL_MEXC',
                'timestamp': datetime.now()
            }
        
        if diff_mexc_binance > 0.3:
            return {
                'type': 'cross_exchange',
                'buy_exchange': 'mexc',
                'buy_price': mexc_price,
                'sell_exchange': 'binance',
                'sell_price': binance_price,
                'profit_percent': diff_mexc_binance,
                'action': 'BUY_MEXC_SELL_BINANCE',
                'timestamp': datetime.now()
            }
        
        return None
    
    async def execute_trade(self, opportunity: Dict, amount_usd: float = 100) -> Dict:
        print(f"🚀 EXECUTING TRADE: {opportunity['action']}")
        print(f"   Profit: {opportunity['profit_percent']:.2f}%")
        
        results = {}
        
        if opportunity['action'] == 'BUY_BINANCE_SELL_MEXC':
            if 'binance' in self.exchanges:
                binance = self.exchanges['binance']
                amount_btc = amount_usd / opportunity['buy_price']
                try:
                    buy_order = binance.create_market_buy_order('BTC/USDT', amount_btc)
                    results['binance_buy'] = buy_order
                    print(f"✅ Bought on Binance: {amount_btc} BTC")
                    if 'mexc' in self.exchanges:
                        mexc = self.exchanges['mexc']
                        sell_order = mexc.create_market_sell_order('BTC/USDT', amount_btc)
                        results['mexc_sell'] = sell_order
                        print(f"✅ Sold on MEXC: {amount_btc} BTC")
                except Exception as e:
                    print(f"Trade execution failed: {e}")
                    return {'status': 'failed', 'error': str(e)}
        
        elif opportunity['action'] == 'BUY_MEXC_SELL_BINANCE':
            if 'mexc' in self.exchanges:
                mexc = self.exchanges['mexc']
                amount_btc = amount_usd / opportunity['buy_price']
                try:
                    buy_order = mexc.create_market_buy_order('BTC/USDT', amount_btc)
                    results['mexc_buy'] = buy_order
                    print(f"✅ Bought on MEXC: {amount_btc} BTC")
                    if 'binance' in self.exchanges:
                        binance = self.exchanges['binance']
                        sell_order = binance.create_market_sell_order('BTC/USDT', amount_btc)
                        results['binance_sell'] = sell_order
                        print(f"✅ Sold on Binance: {amount_btc} BTC")
                except Exception as e:
                    print(f"Trade execution failed: {e}")
                    return {'status': 'failed', 'error': str(e)}
        
        if 'binance_buy' in results and 'mexc_sell' in results:
            buy_value = results['binance_buy']['cost']
            sell_value = results['mexc_sell']['cost']
            actual_profit = sell_value - buy_value
            results['actual_profit_usd'] = actual_profit
            print(f"💰 Actual Profit: ${actual_profit:.2f}")
        
        return {'status': 'executed', 'results': results}
    
    async def get_balances(self) -> Dict:
        balances = {}
        if 'mexc' in self.exchanges:
            try:
                mexc_balance = self.exchanges['mexc'].fetch_balance()
                balances['mexc'] = {
                    'USDT': mexc_balance.get('USDT', {}).get('free', 0),
                    'BTC': mexc_balance.get('BTC', {}).get('free', 0)
                }
            except Exception as e:
                print(f"MEXC balance error: {e}")
        
        if 'binance' in self.exchanges:
            try:
                binance_balance = self.exchanges['binance'].fetch_balance()
                balances['binance'] = {
                    'USDT': binance_balance.get('USDT', {}).get('free', 0),
                    'BTC': binance_balance.get('BTC', {}).get('free', 0)
                }
            except Exception as e:
                print(f"Binance balance error: {e}")
        
        if self.web3 and self.wallet_address:
            try:
                matic_balance = self.web3.eth.get_balance(self.wallet_address)
                balances['metamask'] = {
                    'MATIC': self.web3.from_wei(matic_balance, 'ether'),
                    'address': self.wallet_address
                }
            except Exception as e:
                print(f"MetaMask balance error: {e}")
        
        return balances
    
    def get_status(self) -> Dict:
        return {
            'connected_exchanges': list(self.exchanges.keys()),
            'metamask_connected': self.wallet_address is not None,
            'current_prices': self.realtime_prices,
            'timestamp': datetime.now().isoformat()
        }
