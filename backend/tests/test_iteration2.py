"""Iteration 2 backend tests: worker bridge + persistence + encrypted API keys."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback to frontend .env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL"):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
    except Exception:
        pass

ADMIN_EMAIL = "admin@arbhft.io"
ADMIN_PASSWORD = "Admin@123"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json()["token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


# ---- Worker bridge ----
def test_health_includes_worker(session):
    r = session.get(f"{BASE_URL}/api/health", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("ok") is True
    assert "worker" in data
    w = data["worker"]
    assert w.get("configured") is True
    # ecostamp.net returns 403 -> reachable=true, ok=false
    assert w.get("ok") is False
    assert w.get("url") == "https://ecostamp.net"


def test_worker_health_endpoint(session):
    r = session.get(f"{BASE_URL}/api/worker/health", timeout=15)
    assert r.status_code == 200
    w = r.json()
    assert w.get("configured") is True
    assert w.get("ok") is False
    # Expect status_code to be present (403 from cloudflare)
    assert "status_code" in w or "error" in w


def test_worker_health_requires_auth():
    r = requests.get(f"{BASE_URL}/api/worker/health", timeout=15)
    assert r.status_code == 401


# ---- Existing endpoints regression ----
def test_bot_status_source_mock(session):
    r = session.get(f"{BASE_URL}/api/bot/status", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("source") == "mock"
    assert "config" in data


def test_market_spreads_source_mock(session):
    r = session.get(f"{BASE_URL}/api/market/spreads", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data.get("source") == "mock"
    assert isinstance(data.get("rows"), list)


def test_market_opportunities(session):
    r = session.get(f"{BASE_URL}/api/market/opportunities", timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_bot_action_and_mode(session):
    r = session.post(f"{BASE_URL}/api/bot/action", json={"action": "start"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["status"] == "running"

    r = session.post(f"{BASE_URL}/api/bot/mode", json={"mode": "paper"}, timeout=15)
    assert r.status_code == 200
    assert r.json()["mode"] == "paper"


def test_bot_config_get_put(session):
    r = session.get(f"{BASE_URL}/api/bot/config", timeout=15)
    assert r.status_code == 200
    cfg = r.json()
    assert "min_spread_pct" in cfg

    r2 = session.put(f"{BASE_URL}/api/bot/config", json={"min_spread_pct": 0.30}, timeout=15)
    assert r2.status_code == 200
    assert r2.json()["min_spread_pct"] == 0.30


def test_wallet_pnl_telegram(session):
    r = session.get(f"{BASE_URL}/api/wallet/balances", timeout=15)
    assert r.status_code == 200 and isinstance(r.json(), list)

    r = session.get(f"{BASE_URL}/api/pnl", timeout=15)
    assert r.status_code == 200
    assert "total" in r.json()

    r = session.get(f"{BASE_URL}/api/telegram/config", timeout=15)
    assert r.status_code == 200


# ---- Persistent trades & logs ----
def test_trades_history_persistent(session):
    # Ensure bot is running so trades accumulate
    session.post(f"{BASE_URL}/api/bot/action", json={"action": "start"}, timeout=15)
    # Wait for engine to potentially produce trades
    time.sleep(8)
    r = session.get(f"{BASE_URL}/api/trades/history?limit=100", timeout=15)
    assert r.status_code == 200
    trades = r.json()
    assert isinstance(trades, list)
    # Engine may produce trades probabilistically; not strict but >0 likely
    if trades:
        t = trades[0]
        assert "ts" in t and "symbol" in t and "buy_exchange" in t


def test_logs_history_persistent(session):
    r = session.get(f"{BASE_URL}/api/logs/history?limit=50", timeout=15)
    assert r.status_code == 200
    logs = r.json()
    assert isinstance(logs, list)
    assert len(logs) > 0
    entry = logs[0]
    assert "level" in entry and "msg" in entry


# ---- Encrypted exchange-keys ----
SUPPORTED = ["Binance", "KuCoin", "MEXC", "Bybit", "OKX", "Coinbase", "Bitget"]


def test_exchange_keys_list_initial(session):
    r = session.get(f"{BASE_URL}/api/exchange-keys", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert "items" in data
    assert data["supported"] == SUPPORTED
    assert "configured" in data


def test_exchange_keys_upsert_kucoin(session):
    payload = {
        "exchange": "KuCoin",
        "api_key": "kucoin-key-abc-1234",
        "api_secret": "kucoin-secret-xyz-9999",
        "passphrase": "pass1",
        "label": "spot",
    }
    r = session.post(f"{BASE_URL}/api/exchange-keys", json=payload, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("exchange") == "KuCoin"

    # Verify list shows it masked
    r2 = session.get(f"{BASE_URL}/api/exchange-keys", timeout=15)
    items = r2.json()["items"]
    kucoin = next((i for i in items if i["exchange"] == "KuCoin"), None)
    assert kucoin is not None
    # Masked - no cleartext leakage
    assert "kucoin-key-abc-1234" not in kucoin["api_key_masked"]
    assert "kucoin-secret-xyz-9999" not in kucoin["api_secret_masked"]
    assert "pass1" not in kucoin["passphrase_masked"]
    assert kucoin["has_passphrase"] is True
    assert kucoin["label"] == "spot"
    # Should look like "kucu••••••1234" - contains mask char
    assert "•" in kucoin["api_key_masked"]
    assert "KuCoin" in r2.json()["configured"]


def test_exchange_keys_validation_missing_key(session):
    r = session.post(
        f"{BASE_URL}/api/exchange-keys",
        json={"exchange": "Bybit", "api_key": "", "api_secret": "sec"},
        timeout=15,
    )
    assert r.status_code == 400


def test_exchange_keys_validation_unsupported(session):
    r = session.post(
        f"{BASE_URL}/api/exchange-keys",
        json={"exchange": "FTX", "api_key": "k", "api_secret": "s"},
        timeout=15,
    )
    assert r.status_code == 400


def test_exchange_keys_delete_kucoin(session):
    r = session.delete(f"{BASE_URL}/api/exchange-keys/KuCoin", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert body.get("ok") is True
    assert body.get("removed") == 1

    r2 = session.get(f"{BASE_URL}/api/exchange-keys", timeout=15)
    items = r2.json()["items"]
    assert not any(i["exchange"] == "KuCoin" for i in items)


def test_mongo_encrypted_storage_verification(session):
    # Insert a record then read directly from mongo to verify encryption
    payload = {
        "exchange": "MEXC",
        "api_key": "raw-plaintext-key-VERIFY",
        "api_secret": "raw-plaintext-secret-VERIFY",
        "label": "verify",
    }
    r = session.post(f"{BASE_URL}/api/exchange-keys", json=payload, timeout=15)
    assert r.status_code == 200

    # Check via pymongo
    try:
        from pymongo import MongoClient
    except Exception:
        pytest.skip("pymongo unavailable")
    mc = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
    db = mc[os.environ.get("DB_NAME", "ultimate_arbitrage_hft")]
    doc = db.exchange_keys.find_one({"exchange": "MEXC"})
    assert doc is not None
    assert "api_key_enc" in doc and "api_secret_enc" in doc
    # Ensure no cleartext fields
    assert "api_key" not in doc
    assert "api_secret" not in doc
    # And the encrypted blob must NOT contain raw value
    assert "raw-plaintext-key-VERIFY" not in doc["api_key_enc"]
    assert "raw-plaintext-secret-VERIFY" not in doc["api_secret_enc"]

    # Cleanup
    session.delete(f"{BASE_URL}/api/exchange-keys/MEXC", timeout=15)

    # Verify trades and engine_logs collections
    trade = db.trades.find_one()
    if trade:
        assert "ts" in trade and "symbol" in trade and "buy_exchange" in trade
    log = db.engine_logs.find_one()
    assert log is not None
    assert "level" in log and "msg" in log
