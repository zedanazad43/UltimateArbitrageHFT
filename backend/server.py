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


def create_access_token(user_id: str, email: str, role: str, token_version: int = 0) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "tv": token_version,
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
        # Revocation: token_version on user must match the one in the JWT.
        # Bumping users.token_version (on password/role change) invalidates all prior JWTs.
        if int(user.get("token_version", 0)) != int(payload.get("tv", 0)):
            raise HTTPException(status_code=401, detail="Token revoked")
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


# --- Alert rules ---
ALERT_METRICS = {
    "pnl_total", "pnl_today", "pnl_h24",
    "uptime_seconds", "win_rate", "trades_total",
    "max_spread_pct",  # current best spread on the board
    "no_trade_minutes",  # minutes since last fill
}
ALERT_OPS = {">", ">=", "<", "<=", "=="}


class AlertRuleIn(BaseModel):
    name: str
    metric: str
    op: str
    threshold: float
    enabled: bool = True
    cooldown_seconds: int = 600  # avoid alert spam
    channels: Optional[List[str]] = None  # ["telegram"] (default)
    notes: Optional[str] = None


class AlertRuleUpdate(BaseModel):
    name: Optional[str] = None
    metric: Optional[str] = None
    op: Optional[str] = None
    threshold: Optional[float] = None
    enabled: Optional[bool] = None
    cooldown_seconds: Optional[int] = None
    channels: Optional[List[str]] = None
    notes: Optional[str] = None


# --- Strategy presets ---
STRATEGY_PRESETS = {
    "conservative": {
        "min_spread_pct": 0.55,
        "max_position_usd": 1000.0,
        "max_slippage_pct": 0.08,
        "trade_cooldown_ms": 1500,
        "auto_restart": True,
    },
    "balanced": {
        "min_spread_pct": 0.35,
        "max_position_usd": 2500.0,
        "max_slippage_pct": 0.15,
        "trade_cooldown_ms": 750,
        "auto_restart": True,
    },
    "aggressive": {
        "min_spread_pct": 0.18,
        "max_position_usd": 5000.0,
        "max_slippage_pct": 0.25,
        "trade_cooldown_ms": 300,
        "auto_restart": True,
    },
}


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
                    global _last_trade_ts
                    _last_trade_ts = datetime.now(timezone.utc)
                    add_log("INFO", f"TRADE filled {op['symbol']} {op['buy_exchange']}->{op['sell_exchange']} pnl={pnl:.2f} USDT")
                    await _persist_trade(trade)
                if random.random() < 0.04:
                    add_log("WARN", random.choice([
                        "Latency spike on KuCoin websocket (212ms)",
                        "Order book gap on MEXC briefly exceeded threshold",
                        "Rate limit nearing on Bybit public feed",
                    ]))
                bot_state["uptime_seconds"] += 2
                # alert rules evaluation (cheap; cooldown enforced)
                try:
                    await _evaluate_alerts(spreads)
                except Exception as e:
                    add_log("ERROR", f"alert eval error: {e}")
                # A/B paper-lane simulator (cheap; only ticks if enabled)
                try:
                    await _ab_tick(spreads)
                except Exception as e:
                    add_log("ERROR", f"ab tick error: {e}")
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


# ---------- State persistence (bot_state, bot_config, pnl_state) ----------
async def _persist_runtime_state():
    """Snapshot mutable runtime dicts to Mongo so they survive restarts."""
    try:
        await db.runtime_state.update_one(
            {"_id": "singleton"},
            {"$set": {
                "bot_state": bot_state,
                "bot_config": bot_config,
                "pnl_state": pnl_state,
                "telegram_config": {**telegram_config, "bot_token_enc": encrypt(telegram_config.get("bot_token") or "")},
                "saved_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
    except Exception:
        pass


async def _restore_runtime_state():
    doc = await db.runtime_state.find_one({"_id": "singleton"})
    if not doc:
        return
    for src_key, target in [("bot_state", bot_state), ("bot_config", bot_config), ("pnl_state", pnl_state)]:
        src = doc.get(src_key) or {}
        for k, v in src.items():
            if k in target:
                target[k] = v
    # Telegram: decrypt token if we persisted an encrypted variant
    tg = doc.get("telegram_config") or {}
    enc = tg.get("bot_token_enc")
    if enc:
        plain = decrypt(enc)
        if plain:
            telegram_config["bot_token"] = plain
    for k in ("chat_id", "alerts_enabled"):
        if k in tg:
            telegram_config[k] = tg[k]


# ---------- Alert evaluator ----------
_last_trade_ts: Optional[datetime] = None
_alert_last_fired: dict = {}  # rule_id -> ts


async def _send_telegram_alert(rule: dict, value: float, msg: str) -> bool:
    """Mocked Telegram dispatch: logs + persists. Replace with real worker/Telegram API later."""
    add_log("WARN", f"ALERT[{rule.get('name')}]: {msg}")
    try:
        now = datetime.now(timezone.utc)
        await db.alert_events.insert_one({
            "rule_id": str(rule.get("_id")),
            "rule_name": rule.get("name"),
            "metric": rule.get("metric"),
            "op": rule.get("op"),
            "threshold": rule.get("threshold"),
            "value": value,
            "msg": msg,
            "delivered": True,
            "channel": "telegram",
            "ts": now,
        })
        # Persist cooldown to the rule itself so post-restart we don't storm.
        if rule.get("_id") is not None:
            await db.alert_rules.update_one({"_id": rule["_id"]}, {"$set": {"last_fired_at": now}})
    except Exception:
        pass
    return True


# ---------- Audit log ----------
async def _audit(actor: Optional[dict], action: str, details: Optional[dict] = None):
    try:
        await db.audit_log.insert_one({
            "ts": datetime.now(timezone.utc),
            "actor_id": (actor or {}).get("id"),
            "actor_email": (actor or {}).get("email"),
            "actor_role": (actor or {}).get("role"),
            "action": action,
            "details": details or {},
        })
    except Exception:
        pass


def _eval_op(value: float, op: str, threshold: float) -> bool:
    if op == ">":
        return value > threshold
    if op == ">=":
        return value >= threshold
    if op == "<":
        return value < threshold
    if op == "<=":
        return value <= threshold
    if op == "==":
        return value == threshold
    return False


async def _current_metric_value(metric: str, spreads: list) -> Optional[float]:
    if metric in pnl_state and isinstance(pnl_state[metric], (int, float)):
        return float(pnl_state[metric])
    if metric == "uptime_seconds":
        return float(bot_state.get("uptime_seconds") or 0)
    if metric == "max_spread_pct":
        return float(spreads[0]["spread_pct"]) if spreads else 0.0
    if metric == "no_trade_minutes":
        if _last_trade_ts is None:
            return 0.0
        delta = (datetime.now(timezone.utc) - _last_trade_ts).total_seconds() / 60.0
        return float(delta)
    return None


async def _evaluate_alerts(spreads: list):
    cur = db.alert_rules.find({"enabled": True})
    now = datetime.now(timezone.utc)
    async for rule in cur:
        rule_id = str(rule["_id"])
        last = _alert_last_fired.get(rule_id)
        cooldown = int(rule.get("cooldown_seconds") or 600)
        if last and (now - last).total_seconds() < cooldown:
            continue
        try:
            v = await _current_metric_value(rule["metric"], spreads)
        except Exception:
            continue
        if v is None:
            continue
        if _eval_op(v, rule["op"], float(rule["threshold"])):
            msg = f"{rule['metric']} {rule['op']} {rule['threshold']} (actual={v:.4f})"
            await _send_telegram_alert(rule, v, msg)
            _alert_last_fired[rule_id] = now


async def state_persistence_loop():
    while True:
        try:
            await asyncio.sleep(15)
            await _persist_runtime_state()
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(5)


# ---------- Lifespan ----------
@asynccontextmanager
async def lifespan(app: FastAPI):
    # startup
    await db.users.create_index("email", unique=True)
    await db.exchange_keys.create_index("exchange", unique=True)
    await db.trades.create_index("ts")
    await db.engine_logs.create_index("ts")
    await db.alert_rules.create_index("name")
    await db.alert_events.create_index([("ts", -1)])
    await db.audit_log.create_index([("ts", -1)])
    await db.audit_log.create_index("action")

    # restore runtime state from previous run (best-effort)
    await _restore_runtime_state()

    # Hydrate per-rule alert cooldown markers so the cooldown window survives a restart
    try:
        cur = db.alert_rules.find({"last_fired_at": {"$exists": True}})
        async for r in cur:
            lf = r.get("last_fired_at")
            if lf:
                # MongoDB returns naive datetimes — coerce to UTC-aware to match datetime.now(timezone.utc)
                if isinstance(lf, datetime) and lf.tzinfo is None:
                    lf = lf.replace(tzinfo=timezone.utc)
                _alert_last_fired[str(r["_id"])] = lf
    except Exception:
        pass

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
    _tasks.append(asyncio.create_task(state_persistence_loop()))

    yield

    # shutdown
    await _persist_runtime_state()
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
        await _audit(None, "auth.login_failed", {"email": email})
        raise HTTPException(status_code=401, detail="Invalid email or password")
    role = user.get("role") or ROLE_VIEWER
    tv = int(user.get("token_version") or 0)
    token = create_access_token(str(user["_id"]), email, role, tv)
    csrf = secrets.token_urlsafe(32)
    set_auth_cookies(response, token, csrf)
    await _audit({"id": str(user["_id"]), "email": email, "role": role}, "auth.login", {})
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
    await _audit(user, f"bot.{payload.action}", {"mode": bot_state["mode"]})
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
    await _audit(user, "bot.mode", {"mode": mode})
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
        upd["token_version"] = int(target.get("token_version") or 0) + 1  # revoke all prior tokens
    if "role" in data:
        if data["role"] not in VALID_ROLES:
            raise HTTPException(400, f"Invalid role. Must be one of: {sorted(VALID_ROLES)}")
        # Prevent demoting the bootstrap admin (the .env one) — they will get re-promoted on startup anyway
        bootstrap_email = os.environ["ADMIN_EMAIL"].lower()
        if target.get("email") == bootstrap_email and data["role"] != ROLE_ADMIN:
            raise HTTPException(409, "Cannot demote the bootstrap admin")
        upd["role"] = data["role"]
        if data["role"] != target.get("role"):
            upd["token_version"] = int(target.get("token_version") or 0) + 1  # role change → revoke
    if upd:
        await db.users.update_one({"_id": oid}, {"$set": upd})
    await _audit(user, "user.update", {"target": target["email"], "fields": list(upd.keys())})
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


# ---------- Strategy presets ----------
@api.get("/bot/presets")
async def list_presets(user: dict = Depends(get_current_user)):
    return {"presets": STRATEGY_PRESETS}


@api.post("/bot/preset/{name}")
async def apply_preset(name: str, user: dict = Depends(require_admin)):
    if name not in STRATEGY_PRESETS:
        raise HTTPException(400, f"Unknown preset. Valid: {list(STRATEGY_PRESETS.keys())}")
    bot_config.update(STRATEGY_PRESETS[name])
    add_log("INFO", f"Strategy preset '{name}' applied by {user['email']}")
    return {"ok": True, "preset": name, "config": bot_config}


# ---------- Exchange-key connectivity test ----------
@api.post("/exchange-keys/{exchange}/test")
async def test_exchange_key(exchange: str, user: dict = Depends(require_admin)):
    """Probe the key by calling the worker's /exchange/{ex}/account endpoint.
    Falls back to a mock OK if worker is not reachable (so the UI flow still works)."""
    doc = await db.exchange_keys.find_one({"exchange": exchange})
    if not doc:
        raise HTTPException(404, "No key stored for this exchange")
    if worker_health_cache.get("ok"):
        upstream = await worker_client.get(f"/exchange/{exchange}/account")
        if isinstance(upstream, dict):
            add_log("INFO", f"Key test for {exchange} via worker by {user['email']}: ok")
            return {"ok": True, "source": "worker", "latency_ms": upstream.get("latency_ms"), "balances": upstream.get("balances")}
    # mock fallback
    latency = random.randint(45, 320)
    fake_balance = {"USDT": round(random.uniform(500, 4000), 2)}
    add_log("INFO", f"Key test for {exchange} (mock) by {user['email']}: ok")
    return {"ok": True, "source": "mock", "latency_ms": latency, "balances": fake_balance, "note": "worker unreachable — synthetic result"}


# ---------- Alert rules ----------
def _rule_public(d: dict) -> dict:
    return {
        "id": str(d["_id"]),
        "name": d.get("name"),
        "metric": d.get("metric"),
        "op": d.get("op"),
        "threshold": d.get("threshold"),
        "enabled": d.get("enabled", True),
        "cooldown_seconds": d.get("cooldown_seconds", 600),
        "channels": d.get("channels") or ["telegram"],
        "notes": d.get("notes") or "",
        "created_at": d.get("created_at").isoformat() if d.get("created_at") else None,
        "last_fired_at": d.get("last_fired_at").isoformat() if d.get("last_fired_at") else None,
    }


@api.get("/alerts/metrics")
async def alert_metrics(user: dict = Depends(get_current_user)):
    return {"metrics": sorted(ALERT_METRICS), "ops": sorted(ALERT_OPS)}


@api.get("/alerts/rules")
async def list_alert_rules(user: dict = Depends(get_current_user)):
    cur = db.alert_rules.find({}).sort("created_at", 1)
    out = []
    async for d in cur:
        out.append(_rule_public(d))
    return out


@api.post("/alerts/rules")
async def create_alert_rule(payload: AlertRuleIn, user: dict = Depends(require_admin)):
    if payload.metric not in ALERT_METRICS:
        raise HTTPException(400, f"Invalid metric. Allowed: {sorted(ALERT_METRICS)}")
    if payload.op not in ALERT_OPS:
        raise HTTPException(400, f"Invalid op. Allowed: {sorted(ALERT_OPS)}")
    doc = {
        "name": payload.name,
        "metric": payload.metric,
        "op": payload.op,
        "threshold": float(payload.threshold),
        "enabled": payload.enabled,
        "cooldown_seconds": int(payload.cooldown_seconds),
        "channels": payload.channels or ["telegram"],
        "notes": payload.notes or "",
        "created_at": datetime.now(timezone.utc),
        "created_by": user["email"],
    }
    res = await db.alert_rules.insert_one(doc)
    doc["_id"] = res.inserted_id
    add_log("INFO", f"Alert rule '{payload.name}' created by {user['email']}")
    return _rule_public(doc)


@api.patch("/alerts/rules/{rule_id}")
async def update_alert_rule(rule_id: str, payload: AlertRuleUpdate, user: dict = Depends(require_admin)):
    try:
        oid = ObjectId(rule_id)
    except Exception:
        raise HTTPException(400, "Invalid rule id")
    target = await db.alert_rules.find_one({"_id": oid})
    if not target:
        raise HTTPException(404, "Rule not found")
    data = payload.model_dump(exclude_none=True)
    if "metric" in data and data["metric"] not in ALERT_METRICS:
        raise HTTPException(400, f"Invalid metric. Allowed: {sorted(ALERT_METRICS)}")
    if "op" in data and data["op"] not in ALERT_OPS:
        raise HTTPException(400, f"Invalid op. Allowed: {sorted(ALERT_OPS)}")
    if data:
        await db.alert_rules.update_one({"_id": oid}, {"$set": data})
    fresh = await db.alert_rules.find_one({"_id": oid})
    add_log("INFO", f"Alert rule {rule_id} updated by {user['email']}")
    return _rule_public(fresh)


@api.delete("/alerts/rules/{rule_id}")
async def delete_alert_rule(rule_id: str, user: dict = Depends(require_admin)):
    try:
        oid = ObjectId(rule_id)
    except Exception:
        raise HTTPException(400, "Invalid rule id")
    res = await db.alert_rules.delete_one({"_id": oid})
    if res.deleted_count:
        add_log("WARN", f"Alert rule {rule_id} deleted by {user['email']}")
        _alert_last_fired.pop(rule_id, None)
    return {"ok": True, "removed": res.deleted_count}


@api.post("/alerts/rules/{rule_id}/test")
async def fire_alert_test(rule_id: str, user: dict = Depends(require_admin)):
    try:
        oid = ObjectId(rule_id)
    except Exception:
        raise HTTPException(400, "Invalid rule id")
    rule = await db.alert_rules.find_one({"_id": oid})
    if not rule:
        raise HTTPException(404, "Rule not found")
    msg = f"TEST FIRE: {rule['name']} ({rule['metric']} {rule['op']} {rule['threshold']})"
    await _send_telegram_alert(rule, 0.0, msg)
    return {"ok": True, "delivered": True}


@api.get("/alerts/events")
async def alert_events(limit: int = 100, user: dict = Depends(get_current_user)):
    docs = await db.alert_events.find({}, {"_id": 0}).sort("ts", -1).limit(min(limit, 500)).to_list(min(limit, 500))
    for d in docs:
        if isinstance(d.get("ts"), datetime):
            d["ts"] = d["ts"].isoformat()
    return docs


# ---------- Audit log endpoint ----------
@api.get("/audit")
async def get_audit_log(limit: int = 100, action: Optional[str] = None, user: dict = Depends(require_admin)):
    q = {}
    if action:
        q["action"] = action
    cur = db.audit_log.find(q, {"_id": 0}).sort("ts", -1).limit(min(limit, 500))
    out = []
    async for d in cur:
        if isinstance(d.get("ts"), datetime):
            d["ts"] = d["ts"].isoformat()
        out.append(d)
    return out


# ---------- Strategy A/B mode ----------
# Two paper-trading lanes running in parallel, each with its own preset config.
# Backed by db.ab_lanes (singleton doc) — accumulates pnl & trades per lane.
DEFAULT_AB = {
    "enabled": False,
    "lane_a": {"preset": "conservative", "pnl": 0.0, "trades": 0, "wins": 0},
    "lane_b": {"preset": "aggressive", "pnl": 0.0, "trades": 0, "wins": 0},
    "started_at": None,
}


class ABStartIn(BaseModel):
    lane_a_preset: str = "conservative"
    lane_b_preset: str = "aggressive"


async def _ab_get():
    doc = await db.ab_lanes.find_one({"_id": "singleton"})
    return doc or {**DEFAULT_AB, "_id": "singleton"}


async def _ab_tick(spreads: list):
    """Per-tick A/B simulator — mirrors background_tick but uses each lane's preset config."""
    doc = await _ab_get()
    if not doc.get("enabled"):
        return
    for lane_key in ("lane_a", "lane_b"):
        lane = doc.get(lane_key) or {}
        preset = STRATEGY_PRESETS.get(lane.get("preset")) or STRATEGY_PRESETS["balanced"]
        min_spread = preset["min_spread_pct"]
        size = preset["max_position_usd"]
        viable = [s for s in spreads if s["spread_pct"] >= min_spread]
        if not viable or random.random() >= 0.45:
            continue
        op = viable[0]
        gross = op["spread_pct"] / 100 * size
        # paper-style realized fraction
        pnl = gross * random.uniform(0.5, 0.95)
        lane["pnl"] = round(float(lane.get("pnl") or 0.0) + pnl, 2)
        lane["trades"] = int(lane.get("trades") or 0) + 1
        if pnl > 0:
            lane["wins"] = int(lane.get("wins") or 0) + 1
        doc[lane_key] = lane
    try:
        await db.ab_lanes.update_one({"_id": "singleton"}, {"$set": doc}, upsert=True)
    except Exception:
        pass


@api.get("/ab/status")
async def ab_status(user: dict = Depends(get_current_user)):
    doc = await _ab_get()
    doc.pop("_id", None)
    if doc.get("started_at") and isinstance(doc["started_at"], datetime):
        doc["started_at"] = doc["started_at"].isoformat()
    # decorate with win rates
    for k in ("lane_a", "lane_b"):
        ln = doc.get(k) or {}
        n = ln.get("trades") or 0
        ln["win_rate"] = round((ln.get("wins") or 0) / n, 4) if n else 0.0
        doc[k] = ln
    return doc


@api.post("/ab/start")
async def ab_start(payload: ABStartIn, user: dict = Depends(require_admin)):
    for p in (payload.lane_a_preset, payload.lane_b_preset):
        if p not in STRATEGY_PRESETS:
            raise HTTPException(400, f"Unknown preset: {p}. Valid: {list(STRATEGY_PRESETS.keys())}")
    doc = {
        "_id": "singleton",
        "enabled": True,
        "lane_a": {"preset": payload.lane_a_preset, "pnl": 0.0, "trades": 0, "wins": 0},
        "lane_b": {"preset": payload.lane_b_preset, "pnl": 0.0, "trades": 0, "wins": 0},
        "started_at": datetime.now(timezone.utc),
    }
    await db.ab_lanes.update_one({"_id": "singleton"}, {"$set": doc}, upsert=True)
    await _audit(user, "ab.start", {"lane_a": payload.lane_a_preset, "lane_b": payload.lane_b_preset})
    add_log("INFO", f"A/B test started by {user['email']}: {payload.lane_a_preset} vs {payload.lane_b_preset}")
    doc.pop("_id", None)
    doc["started_at"] = doc["started_at"].isoformat()
    return doc


@api.post("/ab/stop")
async def ab_stop(user: dict = Depends(require_admin)):
    await db.ab_lanes.update_one({"_id": "singleton"}, {"$set": {"enabled": False}})
    await _audit(user, "ab.stop", {})
    add_log("INFO", f"A/B test stopped by {user['email']}")
    return {"ok": True}


@api.post("/ab/reset")
async def ab_reset(user: dict = Depends(require_admin)):
    await db.ab_lanes.delete_one({"_id": "singleton"})
    await _audit(user, "ab.reset", {})
    return {"ok": True}


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
