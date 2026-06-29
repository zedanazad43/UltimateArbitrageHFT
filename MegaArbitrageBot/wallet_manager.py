# wallet_manager.py
from web3 import Web3
from eth_account import Account
import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

class MetaMaskManager:
    """
    إدارة محفظة MetaMask
    """
    
    def __init__(self):
        print("🔐 Initializing MetaMask Manager...")
        
        # إعداد الاتصال بـ Polygon
        self.polygon_rpc = os.getenv("POLYGON_RPC_URL", "https://polygon-rpc.com")
        self.w3_polygon = Web3(Web3.HTTPProvider(self.polygon_rpc))
        
        # إعداد الاتصال بـ Ethereum
        self.eth_rpc = os.getenv("ETHEREUM_RPC_URL", "https://eth-mainnet.g.alchemy.com/v2/demo")
        self.w3_eth = Web3(Web3.HTTPProvider(self.eth_rpc))
        
        # تحميل المفتاح الخاص (اختياري للاختبار)
        self.private_key = os.getenv("ETHEREUM_PRIVATE_KEY", "")
        if self.private_key:
            self.account = Account.from_key(self.private_key)
            self.address = self.account.address
            print(f"✅ Wallet connected: {self.address}")
        else:
            self.address = None
            print("⚠️ No private key found - running in simulation mode")
    
    def get_balance_polygon(self):
        """الحصول على رصيد MATIC"""
        if self.address:
            balance_wei = self.w3_polygon.eth.get_balance(self.address)
            return self.w3_polygon.from_wei(balance_wei, 'ether')
        return 0
    
    def get_usdc_balance(self):
        """الحصول على رصيد USDC"""
        return 1000  # وضع المحاكاة

# اختبار
if __name__ == "__main__":
    wallet = MetaMaskManager()
    print(f"Balance: {wallet.get_balance_polygon()} MATIC")
