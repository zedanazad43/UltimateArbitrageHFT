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
    OKX = "okx"
    BITGET = "bitget"
    BITMART = "bitmart"
    PRIMEXBT = "primexbt"
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
        if exchange in [
            ExchangeType.MEXC,
            ExchangeType.BINANCE,
            ExchangeType.OKX,
            ExchangeType.BITGET,
            ExchangeType.BITMART,
            ExchangeType.HYPERLIQUID,
            ExchangeType.POLYMARKET,
        ]:
            return bool(keys.api_key and keys.api_secret)
        elif exchange == ExchangeType.PRIMEXBT:
            return bool(keys.api_key)
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

    def normalize(value: str) -> str:
        if value is None:
            return ""
        cleaned = value.strip()
        placeholders = {
            "",
            "your_mexc_api_key_here",
            "your_mexc_api_secret_here",
            "your_binance_api_key_here",
            "your_binance_api_secret_here",
            "0xYOUR_WALLET_ADDRESS",
            "0xYOUR_PRIVATE_KEY",
            "your_bitmart_access_key_here",
            "your_bitmart_private_key_here",
            "your_client_id_here",
            "Your Name",
            "your_email@example.com",
        }
        return "" if cleaned in placeholders else cleaned

    config = configparser.ConfigParser()
    config.read(filepath, encoding='utf-8')

    def import_api_pair(section_name: str, exchange: ExchangeType, key_field: str = 'API_KEY', secret_field: str = 'API_SECRET', passphrase_field: str = None):
        if section_name not in config:
            return
        api_key = normalize(config[section_name].get(key_field, ''))
        api_secret = normalize(config[section_name].get(secret_field, ''))
        passphrase = normalize(config[section_name].get(passphrase_field, '')) if passphrase_field else None
        if api_key and api_secret:
            key_manager.add_keys(
                exchange,
                api_key=api_key,
                api_secret=api_secret,
                passphrase=passphrase or None
            )
            print(f"✅ {section_name} keys imported")
        else:
            print(f"⚠️ {section_name} keys missing or placeholders in {filepath}")

    import_api_pair('MEXC', ExchangeType.MEXC, passphrase_field='PASSPHRASE')
    import_api_pair('BINANCE', ExchangeType.BINANCE)
    import_api_pair('OKX', ExchangeType.OKX)
    import_api_pair('BITGET', ExchangeType.BITGET)
    import_api_pair('HYPERLIQUID', ExchangeType.HYPERLIQUID)
    import_api_pair('POLYMARKET', ExchangeType.POLYMARKET)
    import_api_pair('BITMART', ExchangeType.BITMART, key_field='ACCESS_KEY', secret_field='PRIVATE_KEY')
    
    if 'PRIMEXBT' in config:
        client_id = normalize(config['PRIMEXBT'].get('CLIENT_ID', ''))
        name = normalize(config['PRIMEXBT'].get('NAME', ''))
        email = normalize(config['PRIMEXBT'].get('EMAIL', ''))
        if client_id:
            key_manager.add_keys(
                ExchangeType.PRIMEXBT,
                api_key=client_id,
                api_secret=email,
                passphrase=name or None
            )
            print("✅ PRIMEXBT keys imported")
        else:
            print(f"⚠️ PRIMEXBT keys missing or placeholders in {filepath}")

    if 'METAMASK' in config:
        wallet_address = normalize(config['METAMASK'].get('ADDRESS', ''))
        private_key = normalize(config['METAMASK'].get('PRIVATE_KEY', ''))
        if wallet_address:
            key_manager.add_keys(
                ExchangeType.METAMASK,
                api_key="",
                api_secret="",
                wallet_address=wallet_address,
                private_key=private_key or None
            )
            print("✅ MetaMask wallet imported")
        else:
            print(f"⚠️ MetaMask address missing or placeholder in {filepath}")

    return key_manager
