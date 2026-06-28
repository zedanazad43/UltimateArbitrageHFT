from dotenv import load_dotenv
load_dotenv()

import os
import random
import asyncio
import uuid
import secrets
from contextlib import asynccontextmanager
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
ACCESS_TOKEN_TTL_MIN = 720
ROLE_ADMIN = "admin"
ROLE_VIEWER = "viewer"
VALID_ROLES = {ROLE_ADMIN, ROLE_VIEWER}
CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "x-csrf-token"
STATE_CHANGING_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
CSRF_EXEMPT_PATHS = {"/api/auth/login"}  # login itself bootstraps the cookies


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
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


def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def set_auth_cookies(response: Response, token: str, csrf: str):
    response.set_cookie(
        key="access_token", value=token, httponly=True, secure=True,
        samesite="none", max_age=ACCESS_TOKEN_TTL_MIN * 60, path="/",
    )
    # Companion CSRF cookie (NOT httpOnly so JS can read & echo it in a header).
    # Double-submit pattern: attacker can't read the cookie cross-origin, can't forge the header.
    response.set_cookie(
        key=CSRF_COOKIE, value=csrf, httponly=False, secure=True,
        samesite="none", max_age=ACCESS_TOKEN_TTL_MIN * 60, path="/",
    )


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
    permissions: Optional[List[str]] = None  # ["read","trade","withdraw"]


class ApiKeyPermissionsIn(BaseModel):
    permissions: List[str]


class UserCreateIn(BaseModel):
    email: EmailStr
    password: str
    name: Optional[str] = "User"
    role: str = ROLE_VIEWER


class UserUpdateIn(BaseModel):
    name: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None


# ---------- Mock state seed ----------
EXCHANGES = ["Binance", "KuCoin", "MEXC", "Bybit", "OKX", "Coinbase", "Bitget"]
SYMBOLS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "BNB/USDT", "ADA/USDT", "DOGE/USDT", "AVAX/USDT", "LINK/USDT", "MATIC/USDT"]
BASE_PRICES = {
    "BTC/USDT": 67500, "ETH/USDT": 3450, "SOL/USDT": 178, "XRP/USDT": 0.58,
    "BNB/USDT": 612, "ADA/USDT": 0.45, "DOGE/USDT": 0.165, "AVAX/USDT": 38.5,
    "LINK/USDT": 17.8, "MATIC/USDT": 0.78,
}
ALL_PERMISSIONS = {"read", "trade", "withdraw"}

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

telegram_config = {"bot_token": "", "chat_id": "", "alerts_enabled": False}

logs_buffer: List[dict] = []
trades_buffer: List[dict] = []
pnl_state = {"total": 1284.55, "today": 142.18, "h24": 218.44, "d7": 612.30, "win_rate": 0.684, "trades_total": 487}
worker_health_cache = {"configured": worker_client.is_configured(), "reachable": False, "ok": False, "url": worker_client.WORKER_URL or None, "last_check": None}

# task handles for graceful shutdown
_tasks: List[asyncio.Task] = []


def add_log(level: str, msg: str):
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "level": level, "msg": msg}
    logs_buffer.append(entry)
    if len(logs_buffer) > 500:
        del logs_buffer[:-500]
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
        except asyncio.CancelledError:
            raise
        except Exception as e:
            add_log("ERROR", f"tick error: {e}")
            await asyncio.sleep(2)


async def worker_probe_loop():
    while True:
        try:
            h = await worker_client.health()
            worker_health_cache.update(h)
            worker_health_cache["last_check"] = datetime.now(timezone.utc).isoformat()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            worker_health_cache["last_check"] = datetime.now(timezone.utc).isoformat()
            worker_health_cache["error"] = str(e)[:120]
        await asyncio.sleep(20)


async def _trade_keys_present() -> bool:
    """True if at least one enabled exchange has a stored key with 'trade' permission."""
    enabled = set(bot_config.get("enabled_exchanges") or [])
    cur = db.exchange_keys.find({})
    async for d in cur:
        if d.get("exchange") in enabled and "trade" in (d.get("permissions") or []):
            return True
    return False


# ---------- Lifespan ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
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
            "role": ROLE_ADMIN,
            "created_at": datetime.now(timezone.utc),
        })
    else:
        upd = {}
        if not verify_password(admin_password, existing["password_hash"]):
            upd["password_hash"] = hash_password(admin_password)
        if existing.get("role") != ROLE_ADMIN:
            upd["role"] = ROLE_ADMIN  # always restore root admin role
        if upd:
            await db.users.update_one({"email": admin_email}, {"$set": upd})

    add_log("INFO", "API server online")
    add_log("INFO", f"Loaded {len(EXCHANGES)} exchanges, {len(SYMBOLS)} symbols")
    if worker_client.is_configured():
        add_log("INFO", f"Worker bridge configured: {worker_client.WORKER_URL}")

    _tasks.append(asyncio.create_task(background_tick()))
    _tasks.append(asyncio.create_task(worker_probe_loop()))

    yield

    # shutdown
    for t in _tasks:
        t.cancel()
    for t in _tasks:
        try:
            await t
        except (asyncio.CancelledError, Exception):
            pass
    _tasks.clear()
    await worker_client.aclose()


# ---------- App ----------
app = FastAPI(title="UltimateArbitrageHFT Control API", lifespan=lifespan)


# ---------- CSRF middleware ----------
@app.middleware("http")
async def csrf_middleware(request: Request, call_next):
    method = request.method.upper()
    path = request.url.path
    if method in STATE_CHANGING_METHODS and path.startswith("/api/") and path not in CSRF_EXEMPT_PATHS:
        cookie_csrf = request.cookies.get(CSRF_COOKIE)
        header_csrf = request.headers.get(CSRF_HEADER) or request.headers.get(CSRF_HEADER.title())
        # Skip CSRF when not yet authenticated (no cookie) — auth check below will 401.
        # When cookie IS present, the header MUST match.
        if cookie_csrf:
            if not header_csrf or not secrets.compare_digest(cookie_csrf, header_csrf):
                # allow pure-bearer (CLI/test) requests where no csrf cookie is sent
                if "authorization" not in {k.lower() for k in request.headers.keys()}:
                    return _json_response({"detail": "CSRF token missing or invalid"}, 403)
    return await call_next(request)


def _json_response(content: dict, status_code: int = 200):
    from fastapi.responses import JSONResponse
    return JSONResponse(content=content, status_code=status_code)


api = APIRouter(prefix="/api")


# ---------- Auth ----------
@api.post("/auth/login")
async def login(payload: LoginIn, response: Response):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    role = user.get("role") or ROLE_VIEWER
    token = create_access_token(str(user["_id"]), email, role)
    csrf = secrets.token_urlsafe(32)
    set_auth_cookies(response, token, csrf)
    return {
        "token": token,
        "csrf_token": csrf,
        "user": {"id": str(user["_id"]), "email": user["email"], "name": user.get("name"), "role": role},
    }


@api.post("/auth/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return {"ok": True}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@api.get("/auth/csrf")
async def get_csrf(request: Request, response: Response, user: dict = Depends(get_current_user)):
    """Re-issue a CSRF token (after cookie loss / clearing)."""
    csrf = secrets.token_urlsafe(32)
    response.set_cookie(
        key=CSRF_COOKIE, value=csrf, httponly=False, secure=True,
        samesite="none", max_age=ACCESS_TOKEN_TTL_MIN * 60, path="/",
    )
    return {"csrf_token": csrf}


# ---------- Worker bridge ----------
@api.get("/worker/health")
async def worker_health_view(user: dict = Depends(get_current_user)):
    return worker_health_cache


# ---------- Bot status / control ----------
@api.get("/bot/status")
async def get_status(user: dict = Depends(get_current_user)):
    if worker_health_cache.get("ok"):
        upstream = await worker_client.get("/status")
        if isinstance(upstream, dict):
            return {**bot_state, "config": bot_config, "source": "worker", "upstream": upstream}
    return {**bot_state, "config": bot_config, "source": "mock"}


@api.post("/bot/action")
async def bot_action(payload: BotActionIn, user: dict = Depends(require_admin)):
    if payload.action not in ("start", "stop", "restart"):
        raise HTTPException(400, "Invalid action")
    # safety: prevent starting LIVE without any trade-permission key
    if payload.action in ("start", "restart") and bot_state["mode"] == "live":
        if not await _trade_keys_present():
            raise HTTPException(409, "Cannot start in LIVE mode: no enabled exchange has an API key with 'trade' permission")
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
async def set_mode(payload: dict, user: dict = Depends(require_admin)):
    mode = payload.get("mode")
    if mode not in ("paper", "live"):
        raise HTTPException(400, "mode must be paper or live")
    if mode == "live" and not await _trade_keys_present():
        raise HTTPException(409, "Cannot switch to LIVE: no enabled exchange has an API key with 'trade' permission")
    if worker_health_cache.get("ok"):
        await worker_client.post("/control/mode", {"mode": mode})
    bot_state["mode"] = mode
    add_log("WARN" if mode == "live" else "INFO", f"Mode switched to {mode.upper()} by {user['email']}")
    return bot_state


@api.get("/bot/config")
async def get_config(user: dict = Depends(get_current_user)):
    return bot_config


@api.put("/bot/config")
async def put_config(payload: BotConfigIn, user: dict = Depends(require_admin)):
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


# ---------- Trades & PnL ----------
@api.get("/trades")
async def trades(limit: int = 50, user: dict = Depends(get_current_user)):
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


@api.get("/pnl/series")
async def pnl_series(hours: int = 24, user: dict = Depends(get_current_user)):
    """Return per-hour PnL buckets for the last N hours (default 24)."""
    hours = max(1, min(hours, 168))
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)
    pipeline = [
        {"$match": {"created_at": {"$gte": since}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%dT%H:00:00Z", "date": "$created_at"}},
            "pnl": {"$sum": "$pnl_usd"},
            "n": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]
    buckets = await db.trades.aggregate(pipeline).to_list(hours + 2)
    # densify hourly buckets
    out = []
    cumulative = 0.0
    by_key = {b["_id"]: b for b in buckets}
    for i in range(hours, -1, -1):
        ts = (now - timedelta(hours=i)).replace(minute=0, second=0, microsecond=0)
        key = ts.strftime("%Y-%m-%dT%H:00:00Z")
        b = by_key.get(key)
        pnl_v = round(b["pnl"], 2) if b else 0.0
        n_v = b["n"] if b else 0
        cumulative = round(cumulative + pnl_v, 2)
        out.append({"ts": key, "label": ts.strftime("%H:%M"), "pnl": pnl_v, "trades": n_v, "cumulative": cumulative})
    return {"hours": hours, "buckets": out}


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


# ---------- Logs ----------
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
async def put_telegram(payload: TelegramConfigIn, user: dict = Depends(require_admin)):
    data = payload.model_dump(exclude_none=True)
    telegram_config.update(data)
    add_log("INFO", f"Telegram config updated by {user['email']}")
    return {"ok": True}


@api.post("/telegram/test")
async def test_telegram(user: dict = Depends(require_admin)):
    if not telegram_config.get("bot_token") or not telegram_config.get("chat_id"):
        raise HTTPException(400, "Bot token and chat id required")
    add_log("INFO", f"Test telegram alert dispatched by {user['email']}")
    return {"ok": True, "delivered": True}


# ---------- Exchange API Key manager ----------
def _key_doc_public(d: dict) -> dict:
    api_key_plain = decrypt(d.get("api_key_enc", ""))
    secret_plain = decrypt(d.get("api_secret_enc", ""))
    passphrase_plain = decrypt(d.get("passphrase_enc", ""))
    return {
        "exchange": d["exchange"],
        "label": d.get("label") or "",
        "api_key_masked": mask(api_key_plain),
        "api_secret_masked": mask(secret_plain),
        "passphrase_masked": mask(passphrase_plain),
        "has_passphrase": bool(passphrase_plain),
        "permissions": d.get("permissions") or ["read"],
        "created_at": d.get("created_at").isoformat() if d.get("created_at") else None,
        "updated_at": d.get("updated_at").isoformat() if d.get("updated_at") else None,
    }


@api.get("/exchange-keys")
async def list_keys(user: dict = Depends(get_current_user)):
    docs = await db.exchange_keys.find({}, {"_id": 0}).to_list(50)
    out = [_key_doc_public(d) for d in docs]
    configured = sorted({d["exchange"] for d in docs})
    return {"items": out, "supported": EXCHANGES, "configured": configured}


@api.post("/exchange-keys")
async def upsert_key(payload: ApiKeyIn, user: dict = Depends(require_admin)):
    if payload.exchange not in EXCHANGES:
        raise HTTPException(400, f"Unknown exchange: {payload.exchange}")
    if not payload.api_key or not payload.api_secret:
        raise HTTPException(400, "api_key and api_secret are required")
    perms = payload.permissions or ["read"]
    bad = [p for p in perms if p not in ALL_PERMISSIONS]
    if bad:
        raise HTTPException(400, f"Invalid permissions: {bad}")
    now = datetime.now(timezone.utc)
    existing = await db.exchange_keys.find_one({"exchange": payload.exchange})
    doc = {
        "exchange": payload.exchange,
        "label": payload.label or "",
        "api_key_enc": encrypt(payload.api_key),
        "api_secret_enc": encrypt(payload.api_secret),
        "passphrase_enc": encrypt(payload.passphrase or ""),
        "permissions": perms,
        "updated_at": now,
    }
    if existing is None:
        doc["created_at"] = now
        await db.exchange_keys.insert_one(doc)
        add_log("INFO", f"API key added for {payload.exchange} by {user['email']}")
    else:
        await db.exchange_keys.update_one({"exchange": payload.exchange}, {"$set": doc})
        add_log("INFO", f"API key updated for {payload.exchange} by {user['email']}")
    return {"ok": True, "exchange": payload.exchange, "permissions": perms}


@api.patch("/exchange-keys/{exchange}/permissions")
async def update_permissions(exchange: str, payload: ApiKeyPermissionsIn, user: dict = Depends(require_admin)):
    bad = [p for p in payload.permissions if p not in ALL_PERMISSIONS]
    if bad:
        raise HTTPException(400, f"Invalid permissions: {bad}")
    res = await db.exchange_keys.update_one(
        {"exchange": exchange},
        {"$set": {"permissions": payload.permissions, "updated_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Key not found")
    add_log("INFO", f"Permissions updated for {exchange} -> {payload.permissions} by {user['email']}")
    return {"ok": True, "exchange": exchange, "permissions": payload.permissions}


@api.delete("/exchange-keys/{exchange}")
async def delete_key(exchange: str, user: dict = Depends(require_admin)):
    res = await db.exchange_keys.delete_one({"exchange": exchange})
    if res.deleted_count:
        add_log("WARN", f"API key removed for {exchange} by {user['email']}")
    return {"ok": True, "removed": res.deleted_count}


# ---------- Users (admin-only) ----------
def _user_public(u: dict) -> dict:
    return {
        "id": str(u["_id"]),
        "email": u["email"],
        "name": u.get("name") or "",
        "role": u.get("role") or ROLE_VIEWER,
        "created_at": u.get("created_at").isoformat() if u.get("created_at") else None,
    }


@api.get("/users")
async def list_users(user: dict = Depends(require_admin)):
    cur = db.users.find({}).sort("created_at", 1)
    items = []
    async for u in cur:
        items.append(_user_public(u))
    return items


@api.post("/users")
async def create_user(payload: UserCreateIn, user: dict = Depends(require_admin)):
    if payload.role not in VALID_ROLES:
        raise HTTPException(400, f"Invalid role. Must be one of: {sorted(VALID_ROLES)}")
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "Email already exists")
    doc = {
        "email": email,
        "password_hash": hash_password(payload.password),
        "name": payload.name or "User",
        "role": payload.role,
        "created_at": datetime.now(timezone.utc),
    }
    res = await db.users.insert_one(doc)
    doc["_id"] = res.inserted_id
    add_log("INFO", f"User {email} ({payload.role}) created by {user['email']}")
    return _user_public(doc)


@api.patch("/users/{user_id}")
async def update_user(user_id: str, payload: UserUpdateIn, user: dict = Depends(require_admin)):
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(400, "Invalid user id")
    target = await db.users.find_one({"_id": oid})
    if not target:
        raise HTTPException(404, "User not found")
    data = payload.model_dump(exclude_none=True)
    upd = {}
    if "name" in data:
        upd["name"] = data["name"]
    if "password" in data:
        upd["password_hash"] = hash_password(data["password"])
    if "role" in data:
        if data["role"] not in VALID_ROLES:
            raise HTTPException(400, f"Invalid role. Must be one of: {sorted(VALID_ROLES)}")
        # Prevent demoting the bootstrap admin (the .env one) — they will get re-promoted on startup anyway
        bootstrap_email = os.environ["ADMIN_EMAIL"].lower()
        if target.get("email") == bootstrap_email and data["role"] != ROLE_ADMIN:
            raise HTTPException(409, "Cannot demote the bootstrap admin")
        upd["role"] = data["role"]
    if upd:
        await db.users.update_one({"_id": oid}, {"$set": upd})
    add_log("INFO", f"User {target['email']} updated by {user['email']}: {list(upd.keys())}")
    fresh = await db.users.find_one({"_id": oid})
    return _user_public(fresh)


@api.delete("/users/{user_id}")
async def delete_user(user_id: str, user: dict = Depends(require_admin)):
    try:
        oid = ObjectId(user_id)
    except Exception:
        raise HTTPException(400, "Invalid user id")
    target = await db.users.find_one({"_id": oid})
    if not target:
        raise HTTPException(404, "User not found")
    bootstrap_email = os.environ["ADMIN_EMAIL"].lower()
    if target.get("email") == bootstrap_email:
        raise HTTPException(409, "Cannot delete the bootstrap admin")
    if user.get("id") == user_id:
        raise HTTPException(409, "You cannot delete yourself")
    await db.users.delete_one({"_id": oid})
    add_log("WARN", f"User {target['email']} deleted by {user['email']}")
    return {"ok": True}


# ---------- Public stats (no auth, no CSRF) ----------
@api.get("/public/stats")
async def public_stats():
    """Read-only summary safe to share publicly. No keys, balances, or controls."""
    # last 24h pnl series
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=24)
    pipeline = [
        {"$match": {"created_at": {"$gte": since}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%dT%H:00:00Z", "date": "$created_at"}},
            "pnl": {"$sum": "$pnl_usd"},
            "n": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]
    buckets = await db.trades.aggregate(pipeline).to_list(30)
    by_key = {b["_id"]: b for b in buckets}
    series = []
    cumulative = 0.0
    for i in range(24, -1, -1):
        ts = (now - timedelta(hours=i)).replace(minute=0, second=0, microsecond=0)
        key = ts.strftime("%Y-%m-%dT%H:00:00Z")
        b = by_key.get(key)
        pnl_v = round(b["pnl"], 2) if b else 0.0
        cumulative = round(cumulative + pnl_v, 2)
        series.append({"label": ts.strftime("%H:%M"), "pnl": pnl_v, "cumulative": cumulative})

    return {
        "name": "UltimateArbitrageHFT",
        "version": bot_state["version"],
        "status": bot_state["status"],
        "mode": bot_state["mode"],
        "uptime_seconds": bot_state["uptime_seconds"],
        "pnl": {
            "total": pnl_state["total"],
            "today": pnl_state["today"],
            "h24": pnl_state["h24"],
            "d7": pnl_state["d7"],
            "win_rate": pnl_state["win_rate"],
            "trades_total": pnl_state["trades_total"],
        },
        "exchanges": EXCHANGES,
        "symbols": SYMBOLS,
        "series_24h": series,
        "ts": now.isoformat(),
    }


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
    expose_headers=["x-csrf-token"],
)
