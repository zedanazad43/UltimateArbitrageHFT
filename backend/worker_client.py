"""HTTPX adapter for talking to the Cloudflare Worker.

Best-effort: if the worker is unreachable / returns non-2xx, the caller falls
back to local mock data. Endpoints are guessed; override the map via env if
your worker uses different routes.
"""
import os
import httpx
from typing import Any, Optional

WORKER_URL = (os.environ.get("WORKER_URL") or "").rstrip("/")
WORKER_ADMIN_TOKEN = os.environ.get("WORKER_ADMIN_TOKEN") or ""
WORKER_AUTH_SCHEME = os.environ.get("WORKER_AUTH_SCHEME") or "Bearer"

_client: Optional[httpx.AsyncClient] = None


def _headers() -> dict:
    h = {"accept": "application/json"}
    if WORKER_ADMIN_TOKEN:
        h["authorization"] = f"{WORKER_AUTH_SCHEME} {WORKER_ADMIN_TOKEN}"
    return h


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(4.0, connect=2.0))
    return _client


def is_configured() -> bool:
    return bool(WORKER_URL)


async def get(path: str, params: Optional[dict] = None) -> Optional[Any]:
    if not WORKER_URL:
        return None
    url = f"{WORKER_URL}{path}"
    try:
        r = await get_client().get(url, params=params, headers=_headers())
        if r.status_code >= 200 and r.status_code < 300:
            ct = r.headers.get("content-type", "")
            return r.json() if "application/json" in ct else r.text
        return None
    except Exception:
        return None


async def post(path: str, json: Optional[dict] = None) -> Optional[Any]:
    if not WORKER_URL:
        return None
    url = f"{WORKER_URL}{path}"
    try:
        r = await get_client().post(url, json=json or {}, headers=_headers())
        if r.status_code >= 200 and r.status_code < 300:
            ct = r.headers.get("content-type", "")
            return r.json() if "application/json" in ct else r.text
        return None
    except Exception:
        return None


async def health() -> dict:
    """Return liveness info about the worker."""
    if not WORKER_URL:
        return {"configured": False, "reachable": False, "url": None}
    url = f"{WORKER_URL}/health"
    try:
        r = await get_client().get(url, headers=_headers())
        return {
            "configured": True,
            "reachable": 200 <= r.status_code < 500,
            "ok": 200 <= r.status_code < 300,
            "status_code": r.status_code,
            "url": WORKER_URL,
        }
    except Exception as e:
        return {"configured": True, "reachable": False, "url": WORKER_URL, "error": str(e)[:160]}
