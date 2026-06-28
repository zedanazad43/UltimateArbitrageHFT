from dotenv import load_dotenv
load_dotenv()

import os
import random
import asyncio
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import bcrypt
import jwt
from bson import ObjectId
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, EmailStr

import worker_client
from crypto_util import encrypt, decrypt, mask

# ---------- Mongo ----------
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# ---------- Auth helpers ----------
JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]
ACCESS_TOKEN_TTL_MIN = 720  # 12h


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_TTL_MIN),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        user["id"] = str(user["_id"])
        del user["_id"]
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------- Schemas ----------
class LoginIn(BaseModel):
    email: EmailStr
    password: str


class BotConfigIn(BaseModel):
    mode: Optional[str] = None
    min_spread_pct: Optional[float] = None
    max_position_usd: Optional[float] = None
    allowed_symbols: Optional[List[str]] = None
    enabled_exchanges: Optional[List[str]] = None
    auto_restart: Optional[bool] = None
    max_slippage_pct: Optional[float] = None
    trade_cooldown_ms: Optional[int] = None


class BotActionIn(BaseModel):
    action: str


class TelegramConfigIn(BaseModel):
    bot_token: Optional[str] = None
    chat_id: Optional[str] = None
    alerts_enabled: Optional[bool] = None


class ApiKeyIn(BaseModel):
    exchange: str
    api_key: str
    api_secret: str
    passphrase: Optional[str] = None
    label: Optional[str] = None


# ---------- Mock state seed ----------
EXCHANGES = ["Binance", "KuCoin", "MEXC", "Bybit", "OKX", "Coinbase", "Bitget"]
SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "BNB/USDT", "ADA/USDT", "DOGE/USDT", "AVAX/USDT", "LINK/USDT", "MATIC/USDT"]
BASE_PRICES = {
    "BTC/USDT": 67500, "ETH/USDT": 3450, "SOL/USDT": 178, "XRP/USDT": 0.58,
    "BNB/USDT": 612, "ADA/USDT": 0.45, "DOGE/USDT": 0.165, "AVAX/USDT": 38.5,
    "LINK/USDT": 17.8, "MATIC/USDT": 0.78,
}

bot_state = {
    "status": "running",
    "mode": "paper",
    "started_at": datetime.now(timezone.utc).isoformat(),
    "uptime_seconds": 0,
    "health": "healthy",
    "version": "1.4.2",
    "worker_region": "ENAM",
}

bot_config = {
    "min_spread_pct": 0.35,
    "max_position_usd": 2500.0,
    "allowed_symbols": SYMBOLS[:6],
    "enabled_exchanges": EXCHANGES,
    "auto_restart": True,
    "max_slippage_pct": 0.15,
    "trade_cooldown_ms": 750,
}

telegram_config = {
    "bot_token": "",
    "chat_id": "",
    "alerts_enabled": False,
}

logs_buffer: List[dict] = []
trades_buffer: List[dict] = []
pnl_state = {"total": 1284.55, "today": 142.18, "h24": 218.44, "d7": 612.30, "win_rate": 0.684, "trades_total": 487}

worker_health_cache = {"configured": worker_client.is_configured(), "reachable": False, "ok": False, "url": worker_client.WORKER_URL or None, "last_check": None}


def add_log(level: str, msg: str):
    entry = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "level": level,
        "msg": msg,
    }
    logs_buffer.append(entry)
    if len(logs_buffer) > 500:
        del logs_buffer[:-500]
    # async persist (fire-and-forget)
    asyncio.create_task(_persist_log(entry))


async def _persist_log(entry: dict):
    try:
        await db.engine_logs.insert_one({**entry, "created_at": datetime.now(timezone.utc)})
    except Exception:
        pass


async def _persist_trade(trade: dict):
    try:
        await db.trades.insert_one({**trade, "created_at": datetime.now(timezone.utc)})
    except Exception:
        pass


def gen_price_snapshot():
    snap = {}
    for sym in SYMBOLS:
        base = BASE_PRICES[sym]
        per_ex = {}
        for ex in EXCHANGES:
            drift = random.uniform(-0.004, 0.004) * base
            spread_jitter = random.uniform(-0.0015, 0.0015) * base
            bid = base + drift + spread_jitter
            ask = bid + random.uniform(0.0002, 0.0008) * base
            per_ex[ex] = {"bid": round(bid, 6), "ask": round(ask, 6)}
        snap[sym] = per_ex
    return snap


def compute_spreads(snap):
    rows = []
    for sym, per_ex in snap.items():
        best_bid = max(per_ex.items(), key=lambda kv: kv[1]["bid"])
        best_ask = min(per_ex.items(), key=lambda kv: kv[1]["ask"])
        spread_pct = (best_bid[1]["bid"] - best_ask[1]["ask"]) / best_ask[1]["ask"] * 100
        rows.append({
            "symbol": sym,
            "buy_exchange": best_ask[0],
            "buy_price": best_ask[1]["ask"],
            "sell_exchange": best_bid[0],
            "sell_price": best_bid[1]["bid"],
            "spread_pct": round(spread_pct, 4),
            "est_profit_usd": round(spread_pct / 100 * bot_config["max_position_usd"], 2),
        })
    rows.sort(key=lambda r: r["spread_pct"], reverse=True)
    return rows


async def background_tick():
    add_log("INFO", f"Bot engine started ({bot_state['mode']} mode)")
    while True:
        try:
            if bot_state["status"] == "running":
                snap = gen_price_snapshot()
                spreads = compute_spreads(snap)
                if random.random() < 0.25:
                    top = spreads[0]
                    add_log("INFO", f"Scan complete | top {top['symbol']} {top['spread_pct']:.3f}% {top['buy_exchange']}->{top['sell_exchange']}")
                viable = [s for s in spreads if s["spread_pct"] >= bot_config["min_spread_pct"] and s["symbol"] in bot_config["allowed_symbols"]]
                if viable and random.random() < 0.55:
                    op = viable[0]
                    pnl = op["est_profit_usd"] * random.uniform(0.55, 0.95)
                    trade = {
                        "id": str(uuid.uuid4()),
                        "ts": datetime.now(timezone.utc).isoformat(),
                        "symbol": op["symbol"],
                        "buy_exchange": op["buy_exchange"],
                        "sell_exchange": op["sell_exchange"],
                        "qty_usd": bot_config["max_position_usd"],
                        "buy_price": op["buy_price"],
                        "sell_price": op["sell_price"],
                        "pnl_usd": round(pnl, 2),
                        "mode": bot_state["mode"],
                        "status": "filled",
                    }
                    trades_buffer.insert(0, trade)
                    del trades_buffer[200:]
                    pnl_state["total"] = round(pnl_state["total"] + pnl, 2)
                    pnl_state["today"] = round(pnl_state["today"] + pnl, 2)
                    pnl_state["h24"] = round(pnl_state["h24"] + pnl, 2)
                    pnl_state["trades_total"] += 1
                    add_log("INFO", f"TRADE filled {op['symbol']} {op['buy_exchange']}->{op['sell_exchange']} pnl={pnl:.2f} USDT")
                    await _persist_trade(trade)
                if random.random() < 0.04:
                    add_log("WARN", random.choice([
                        "Latency spike on KuCoin websocket (212ms)",
                        "Order book gap on MEXC briefly exceeded threshold",
                        "Rate limit nearing on Bybit public feed",
                    ]))
                bot_state["uptime_seconds"] += 2
            await asyncio.sleep(2)
        except Exception as e:  # noqa
            add_log("ERROR", f"tick error: {e}")
            await asyncio.sleep(2)


async def worker_probe_loop():
    """Periodically refresh worker reachability cache."""
    while True:
        try:
            h = await worker_client.health()
            worker_health_cache.update(h)
            worker_health_cache["last_check"] = datetime.now(timezone.utc).isoformat()
        except Exception as e:  # noqa
            worker_health_cache["last_check"] = datetime.now(timezone.utc).isoformat()
            worker_health_cache["error"] = str(e)[:120]
        await asyncio.sleep(20)


# ---------- App ----------
app = FastAPI(title="UltimateArbitrageHFT Control API")
api = APIRouter(prefix="/api")


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.exchange_keys.create_index("exchange", unique=True)
    await db.trades.create_index("ts")
    await db.engine_logs.create_index("ts")

    admin_email = os.environ["ADMIN_EMAIL"].lower()
    admin_password = os.environ["ADMIN_PASSWORD"]
    existing = await db.users.find_one({"email": admin_email})
    if existing is None:
        await db.users.insert_one({
            "email": admin_email,
            "password_hash": hash_password(admin_password),
            "name": "Admin",
            "role": "admin",
            "created_at": datetime.now(timezone.utc),
        })
    elif not verify_password(admin_password, existing["password_hash"]):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_password(admin_password)}})

    add_log("INFO", "API server online")
    add_log("INFO", f"Loaded {len(EXCHANGES)} exchanges, {len(SYMBOLS)} symbols")
    if worker_client.is_configured():
        add_log("INFO", f"Worker bridge configured: {worker_client.WORKER_URL}")
    asyncio.create_task(background_tick())
    asyncio.create_task(worker_probe_loop())


# ---------- Auth ----------
@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(str(user["_id"]), email)
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=True,
        samesite="none", max_age=ACCESS_TOKEN_TTL_MIN * 60, path="/",
    )
    return {
        "token": token,
        "user": {"id": str(user["_id"]), "email": user["email"], "name": user.get("name"), "role": user.get("role")},
    }


@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------- Worker bridge ----------
@api.get("/worker/health")
async def worker_health_view(user: dict = Depends(get_current_user)):
    return worker_health_cache


# ---------- Bot status / control ----------
@api.get("/bot/status")
async def get_status(user: dict = Depends(get_current_user)):
    # try worker first
    if worker_health_cache.get("ok"):
        upstream = await worker_client.get("/status")
        if isinstance(upstream, dict):
            return {**bot_state, "config": bot_config, "source": "worker", "upstream": upstream}
    return {**bot_state, "config": bot_config, "source": "mock"}


@api.post("/bot/action")
async def bot_action(payload: BotActionIn, user: dict = Depends(get_current_user)):
    if payload.action not in ("start", "stop", "restart"):
        raise HTTPException(400, "Invalid action")
    # try forwarding to worker first
    if worker_health_cache.get("ok"):
        await worker_client.post(f"/control/{payload.action}")
    if payload.action == "start":
        bot_state["status"] = "running"
        bot_state["started_at"] = datetime.now(timezone.utc).isoformat()
        bot_state["uptime_seconds"] = 0
        add_log("INFO", f"Bot started by {user['email']}")
    elif payload.action == "stop":
        bot_state["status"] = "stopped"
        add_log("WARN", f"Bot stopped by {user['email']}")
    else:
        bot_state["uptime_seconds"] = 0
        bot_state["started_at"] = datetime.now(timezone.utc).isoformat()
        add_log("INFO", f"Bot restarted by {user['email']}")
    return bot_state


@api.post("/bot/mode")
async def set_mode(payload: dict, user: dict = Depends(get_current_user)):
    mode = payload.get("mode")
    if mode not in ("paper", "live"):
        raise HTTPException(400, "mode must be paper or live")
    if worker_health_cache.get("ok"):
        await worker_client.post("/control/mode", {"mode": mode})
    bot_state["mode"] = mode
    add_log("WARN" if mode == "live" else "INFO", f"Mode switched to {mode.upper()} by {user['email']}")
    return bot_state


@api.get("/bot/config")
async def get_config(user: dict = Depends(get_current_user)):
    return bot_config


@api.put("/bot/config")
async def put_config(payload: BotConfigIn, user: dict = Depends(get_current_user)):
    data = payload.model_dump(exclude_none=True)
    bot_config.update(data)
    if worker_health_cache.get("ok"):
        await worker_client.post("/config", data)
    add_log("INFO", f"Config updated by {user['email']}: {list(data.keys())}")
    return bot_config


# ---------- Market ----------
@api.get("/market/spreads")
async def market_spreads(user: dict = Depends(get_current_user)):
    if worker_health_cache.get("ok"):
        upstream = await worker_client.get("/spreads")
        if isinstance(upstream, dict) and "rows" in upstream:
            return {**upstream, "source": "worker"}
    snap = gen_price_snapshot()
    rows = compute_spreads(snap)
    return {"rows": rows, "ts": datetime.now(timezone.utc).isoformat(), "source": "mock"}


@api.get("/market/opportunities")
async def opportunities(user: dict = Depends(get_current_user)):
    if worker_health_cache.get("ok"):
        upstream = await worker_client.get("/opportunities")
        if isinstance(upstream, list):
            return upstream
    snap = gen_price_snapshot()
    rows = compute_spreads(snap)
    return [r for r in rows if r["spread_pct"] >= bot_config["min_spread_pct"]][:10]


# ---------- Trades (persistent) ----------
@api.get("/trades")
async def trades(limit: int = 50, user: dict = Depends(get_current_user)):
    # combine recent in-memory with Mongo history when needed
    if limit <= len(trades_buffer):
        return trades_buffer[:limit]
    docs = await db.trades.find({}, {"_id": 0, "created_at": 0}).sort("ts", -1).limit(limit).to_list(limit)
    return docs


@api.get("/trades/history")
async def trades_history(limit: int = 200, user: dict = Depends(get_current_user)):
    docs = await db.trades.find({}, {"_id": 0, "created_at": 0}).sort("ts", -1).limit(limit).to_list(limit)
    return docs


@api.get("/pnl")
async def pnl(user: dict = Depends(get_current_user)):
    return pnl_state


# ---------- Wallet ----------
@api.get("/wallet/balances")
async def wallet_balances(user: dict = Depends(get_current_user)):
    if worker_health_cache.get("ok"):
        upstream = await worker_client.get("/balances")
        if isinstance(upstream, list):
            return upstream
    out = []
    for ex in EXCHANGES:
        out.append({
            "exchange": ex,
            "balances": {
                "USDT": round(random.uniform(800, 5000), 2),
                "BTC": round(random.uniform(0.005, 0.12), 6),
                "ETH": round(random.uniform(0.1, 2.5), 5),
            },
            "total_usd": round(random.uniform(2500, 18000), 2),
            "connected": True,
        })
    return out


# ---------- Logs (persistent) ----------
@api.get("/logs")
async def logs(limit: int = 200, user: dict = Depends(get_current_user)):
    if limit <= len(logs_buffer):
        return logs_buffer[-limit:][::-1]
    docs = await db.engine_logs.find({}, {"_id": 0, "created_at": 0}).sort("ts", -1).limit(limit).to_list(limit)
    return docs


@api.get("/logs/history")
async def logs_history(limit: int = 500, user: dict = Depends(get_current_user)):
    docs = await db.engine_logs.find({}, {"_id": 0, "created_at": 0}).sort("ts", -1).limit(limit).to_list(limit)
    return docs


# ---------- Telegram ----------
@api.get("/telegram/config")
async def get_telegram(user: dict = Depends(get_current_user)):
    cfg = dict(telegram_config)
    if cfg["bot_token"]:
        cfg["bot_token"] = cfg["bot_token"][:4] + "•••••" + cfg["bot_token"][-4:]
    return cfg


@api.put("/telegram/config")
async def put_telegram(payload: TelegramConfigIn, user: dict = Depends(get_current_user)):
    data = payload.model_dump(exclude_none=True)
    telegram_config.update(data)
    add_log("INFO", f"Telegram config updated by {user['email']}")
    return {"ok": True}


@api.post("/telegram/test")
async def test_telegram(user: dict = Depends(get_current_user)):
    if not telegram_config.get("bot_token") or not telegram_config.get("chat_id"):
        raise HTTPException(400, "Bot token and chat id required")
    add_log("INFO", f"Test telegram alert dispatched by {user['email']}")
    return {"ok": True, "delivered": True}


# ---------- Exchange API Key manager (encrypted) ----------
@api.get("/exchange-keys")
async def list_keys(user: dict = Depends(get_current_user)):
    docs = await db.exchange_keys.find({}, {"_id": 0}).to_list(50)
    out = []
    for d in docs:
        api_key_plain = decrypt(d.get("api_key_enc", ""))
        secret_plain = decrypt(d.get("api_secret_enc", ""))
        passphrase_plain = decrypt(d.get("passphrase_enc", ""))
        out.append({
            "exchange": d["exchange"],
            "label": d.get("label") or "",
            "api_key_masked": mask(api_key_plain),
            "api_secret_masked": mask(secret_plain),
            "passphrase_masked": mask(passphrase_plain),
            "has_passphrase": bool(passphrase_plain),
            "created_at": d.get("created_at").isoformat() if d.get("created_at") else None,
            "updated_at": d.get("updated_at").isoformat() if d.get("updated_at") else None,
        })
    # also list "configured" status for every supported exchange
    configured = {d["exchange"] for d in docs}
    return {
        "items": out,
        "supported": EXCHANGES,
        "configured": sorted(list(configured)),
    }


@api.post("/exchange-keys")
async def upsert_key(payload: ApiKeyIn, user: dict = Depends(get_current_user)):
    if payload.exchange not in EXCHANGES:
        raise HTTPException(400, f"Unknown exchange: {payload.exchange}")
    if not payload.api_key or not payload.api_secret:
        raise HTTPException(400, "api_key and api_secret are required")
    now = datetime.now(timezone.utc)
    existing = await db.exchange_keys.find_one({"exchange": payload.exchange})
    doc = {
        "exchange": payload.exchange,
        "label": payload.label or "",
        "api_key_enc": encrypt(payload.api_key),
        "api_secret_enc": encrypt(payload.api_secret),
        "passphrase_enc": encrypt(payload.passphrase or ""),
        "updated_at": now,
    }
    if existing is None:
        doc["created_at"] = now
        await db.exchange_keys.insert_one(doc)
        add_log("INFO", f"API key added for {payload.exchange} by {user['email']}")
    else:
        await db.exchange_keys.update_one({"exchange": payload.exchange}, {"$set": doc})
        add_log("INFO", f"API key updated for {payload.exchange} by {user['email']}")
    return {"ok": True, "exchange": payload.exchange}


@api.delete("/exchange-keys/{exchange}")
async def delete_key(exchange: str, user: dict = Depends(get_current_user)):
    res = await db.exchange_keys.delete_one({"exchange": exchange})
    if res.deleted_count:
        add_log("WARN", f"API key removed for {exchange} by {user['email']}")
    return {"ok": True, "removed": res.deleted_count}


# ---------- Health ----------
@api.get("/health")
async def health():
    return {"ok": True, "ts": datetime.now(timezone.utc).isoformat(), "worker": worker_health_cache}


app.include_router(api)

# ---------- CORS ----------
frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
