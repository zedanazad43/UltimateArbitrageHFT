"""Symmetric encryption helper using Fernet (AES-128-CBC + HMAC)."""
import os
from cryptography.fernet import Fernet, InvalidToken

_KEY = os.environ.get("ENCRYPTION_KEY")
if not _KEY:
    raise RuntimeError("ENCRYPTION_KEY missing in environment")

_f = Fernet(_KEY.encode() if isinstance(_KEY, str) else _KEY)


def encrypt(plain: str) -> str:
    if plain is None:
        return ""
    return _f.encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt(cipher: str) -> str:
    if not cipher:
        return ""
    try:
        return _f.decrypt(cipher.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        return ""


def mask(value: str, head: int = 4, tail: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= head + tail:
        return "•" * len(value)
    return f"{value[:head]}{'•' * 6}{value[-tail:]}"
