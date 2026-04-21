# secure_key_manager.py - نسخة متوافقة مع cryptography الجديدة
import json
import base64
import hashlib
import os
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from typing import Dict, Optional
from dataclasses import dataclass
from enum import Enum

class ExchangeType(Enum):
    MEXC = "mexc"
    BINANCE = "binance"
    METAMASK = "metamask"
    HYPERLIQUID = "hyperliquid"
    POLYMARKET = "polymarket"

@dataclass
class ExchangeKeys:
    exchange: ExchangeType
    api_key: str
    api_secret: str
    passphrase: Optional[str] = None
    wallet_address: Optional[str] = None
    private_key: Optional[str] = None

class SecureKeyManager:
    def __init__(self, master_password: str = None):
        self.keys_file = os.path.join(os.path.dirname(__file__), "..", "keys", "encrypted_keys.json")
        self.master_password = master_password or os.getenv("MASTER_PASSWORD", "default_change_me")
        self.cipher = self._create_cipher()
        self.keys: Dict[str, ExchangeKeys] = {}
        self.load_keys()
    
    def _create_cipher(self):
        # استخدام PBKDF2HMAC بدلاً من PBKDF2 القديم
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'mega_arbitrage_salt_2026',
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(self.master_password.encode()))
        return Fernet(key)
    
    def _encrypt(self, data: str) -> str:
        if not data:
            return ""
        return self.cipher.encrypt(data.encode()).decode()
    
    def _decrypt(self, encrypted: str) -> str:
        if not encrypted:
            return ""
        return self.cipher.decrypt(encrypted.encode()).decode()
    
    def add_keys(self, exchange: ExchangeType, api_key: str, api_secret: str, 
                 passphrase: str = None, wallet_address: str = None, private_key: str = None):
        key_id = f"{exchange.value}_keys"
        self.keys[key_id] = ExchangeKeys(
            exchange=exchange,
            api_key=api_key,
            api_secret=api_secret,
            passphrase=passphrase,
            wallet_address=wallet_address,
            private_key=private_key
        )
        self.save_keys()
        print(f"✅ Keys added for {exchange.value}")
    
    def get_keys(self, exchange: ExchangeType) -> Optional[ExchangeKeys]:
        key_id = f"{exchange.value}_keys"
        if key_id in self.keys:
            return self.keys[key_id]
        return None
    
    def save_keys(self):
        os.makedirs(os.path.dirname(self.keys_file), exist_ok=True)
        encrypted_data = {}
        for key_id, keys in self.keys.items():
            encrypted_data[key_id] = {
                'exchange': keys.exchange.value,
                'api_key': self._encrypt(keys.api_key),
                'api_secret': self._encrypt(keys.api_secret),
                'passphrase': self._encrypt(keys.passphrase) if keys.passphrase else None,
                'wallet_address': keys.wallet_address,
                'private_key': self._encrypt(keys.private_key) if keys.private_key else None
            }
        with open(self.keys_file, 'w') as f:
            json.dump(encrypted_data, f, indent=2)
    
    def load_keys(self):
        if os.path.exists(self.keys_file):
            with open(self.keys_file, 'r') as f:
                encrypted_data = json.load(f)
            for key_id, data in encrypted_data.items():
                self.keys[key_id] = ExchangeKeys(
                    exchange=ExchangeType(data['exchange']),
                    api_key=self._decrypt(data['api_key']),
                    api_secret=self._decrypt(data['api_secret']),
                    passphrase=self._decrypt(data['passphrase']) if data.get('passphrase') else None,
                    wallet_address=data.get('wallet_address'),
                    private_key=self._decrypt(data['private_key']) if data.get('private_key') else None
                )
    
    def verify_keys(self, exchange: ExchangeType) -> bool:
        keys = self.get_keys(exchange)
        if not keys:
            return False
        if exchange in [ExchangeType.MEXC, ExchangeType.BINANCE]:
            return bool(keys.api_key and keys.api_secret)
        elif exchange == ExchangeType.METAMASK:
            return bool(keys.wallet_address)
        return False
    
    def list_configured_exchanges(self) -> list:
        configured = []
        for exchange in ExchangeType:
            if self.verify_keys(exchange):
                configured.append(exchange.value)
        return configured

def import_keys_from_txt(filepath: str, key_manager: SecureKeyManager):
    import configparser
    config = configparser.ConfigParser()
    config.read(filepath)
    
    if 'MEXC' in config:
        key_manager.add_keys(
            ExchangeType.MEXC,
            api_key=config['MEXC'].get('API_KEY', ''),
            api_secret=config['MEXC'].get('API_SECRET', ''),
            passphrase=config['MEXC'].get('PASSPHRASE', None)
        )
        print("✅ MEXC keys imported")
    
    if 'BINANCE' in config:
        key_manager.add_keys(
            ExchangeType.BINANCE,
            api_key=config['BINANCE'].get('API_KEY', ''),
            api_secret=config['BINANCE'].get('API_SECRET', '')
        )
        print("✅ Binance keys imported")
    
    if 'METAMASK' in config:
        key_manager.add_keys(
            ExchangeType.METAMASK,
            api_key="",
            api_secret="",
            wallet_address=config['METAMASK'].get('ADDRESS', ''),
            private_key=config['METAMASK'].get('PRIVATE_KEY', None)
        )
        print("✅ MetaMask wallet imported")
    
    if 'HYPERLIQUID' in config:
        key_manager.add_keys(
            ExchangeType.HYPERLIQUID,
            api_key=config['HYPERLIQUID'].get('API_KEY', ''),
            api_secret=config['HYPERLIQUID'].get('API_SECRET', '')
        )
        print("✅ Hyperliquid imported")
    
    return key_manager
