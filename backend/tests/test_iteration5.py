"""Iteration 5 backend tests: strategy presets, exchange-key test, alert rules CRUD/evaluator, runtime-state persistence."""
import os
import time
import subprocess
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

ADMIN_EMAIL = "admin@arbhft.io"
ADMIN_PASSWORD = "Admin@123"
VIEWER_EMAIL = "viewer_iter5@arbhft.io"
VIEWER_PASSWORD = "Viewer@123"


def _bearer_session(email, password):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.text}"
    token = r.json()["token"]
    s.cookies.clear()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="session")
def admin():
    return _bearer_session(ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def viewer(admin):
    # cleanup if exists
    for u in admin.get(f"{BASE_URL}/api/users", timeout=15).json():
        if u["email"] == VIEWER_EMAIL:
            admin.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=15)
    r = admin.post(f"{BASE_URL}/api/users",
                   json={"email": VIEWER_EMAIL, "password": VIEWER_PASSWORD, "name": "Iter5 Viewer", "role": "viewer"},
                   timeout=15)
    assert r.status_code == 200, r.text
    uid = r.json()["id"]
    sess = _bearer_session(VIEWER_EMAIL, VIEWER_PASSWORD)
    yield sess
    admin.delete(f"{BASE_URL}/api/users/{uid}", timeout=15)


# ---------- REGRESSION ----------
def test_regression_endpoints(admin):
    for path in ["/api/bot/status", "/api/bot/config", "/api/market/spreads",
                 "/api/market/opportunities", "/api/trades", "/api/pnl",
                 "/api/wallet/balances", "/api/logs", "/api/telegram/config",
                 "/api/exchange-keys", "/api/worker/health", "/api/users",
                 "/api/pnl/series?hours=24", "/api/public/stats"]:
        r = admin.get(f"{BASE_URL}{path}", timeout=15)
        assert r.status_code == 200, f"{path} -> {r.status_code}: {r.text[:200]}"


# ---------- STRATEGY PRESETS ----------
def test_list_presets(admin):
    r = admin.get(f"{BASE_URL}/api/bot/presets", timeout=15)
    assert r.status_code == 200
    body = r.json()
    presets = body.get("presets") or body
    assert set(presets.keys()) == {"conservative", "balanced", "aggressive"}
    needed = {"min_spread_pct", "max_position_usd", "max_slippage_pct", "trade_cooldown_ms", "auto_restart"}
    for name, p in presets.items():
        assert needed <= set(p.keys()), f"{name} missing fields"


def test_apply_aggressive_then_balanced(admin):
    r = admin.post(f"{BASE_URL}/api/bot/preset/aggressive", timeout=15)
    assert r.status_code == 200, r.text
    cfg = admin.get(f"{BASE_URL}/api/bot/config", timeout=15).json()
    assert cfg["min_spread_pct"] == 0.18
    assert cfg["max_position_usd"] == 5000.0
    assert cfg["max_slippage_pct"] == 0.25
    assert cfg["trade_cooldown_ms"] == 300
    assert cfg["auto_restart"] is True

    r = admin.post(f"{BASE_URL}/api/bot/preset/balanced", timeout=15)
    assert r.status_code == 200
    cfg = admin.get(f"{BASE_URL}/api/bot/config", timeout=15).json()
    assert cfg["min_spread_pct"] == 0.35
    assert cfg["max_position_usd"] == 2500.0


def test_apply_unknown_preset(admin):
    r = admin.post(f"{BASE_URL}/api/bot/preset/unknown", timeout=15)
    assert r.status_code == 400


def test_viewer_preset_forbidden(viewer):
    r = viewer.post(f"{BASE_URL}/api/bot/preset/balanced", timeout=15)
    assert r.status_code == 403
    # GET works
    assert viewer.get(f"{BASE_URL}/api/bot/presets", timeout=15).status_code == 200


# ---------- EXCHANGE KEY TEST ----------
def test_exchange_key_test_no_key(admin):
    # Ensure no Bybit key
    keys = admin.get(f"{BASE_URL}/api/exchange-keys", timeout=15).json()["items"]
    for k in keys:
        if k["exchange"] == "Bybit":
            admin.delete(f"{BASE_URL}/api/exchange-keys/Bybit", timeout=15)
    r = admin.post(f"{BASE_URL}/api/exchange-keys/Bybit/test", timeout=15)
    assert r.status_code == 404, r.text


def test_exchange_key_test_after_upsert(admin):
    # Create Bybit key
    r = admin.post(f"{BASE_URL}/api/exchange-keys",
                   json={"exchange": "Bybit", "api_key": "ITER5-bybit-key",
                         "api_secret": "ITER5-bybit-secret", "permissions": ["read"]},
                   timeout=15)
    assert r.status_code == 200, r.text
    try:
        r = admin.post(f"{BASE_URL}/api/exchange-keys/Bybit/test", timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["source"] in ("mock", "worker")
        assert "latency_ms" in body
        assert "balances" in body
    finally:
        admin.delete(f"{BASE_URL}/api/exchange-keys/Bybit", timeout=15)


def test_viewer_exchange_key_test_forbidden(admin, viewer):
    # Make sure key exists for the duration
    admin.post(f"{BASE_URL}/api/exchange-keys",
               json={"exchange": "Bybit", "api_key": "k", "api_secret": "s", "permissions": ["read"]}, timeout=15)
    try:
        r = viewer.post(f"{BASE_URL}/api/exchange-keys/Bybit/test", timeout=15)
        assert r.status_code == 403
    finally:
        admin.delete(f"{BASE_URL}/api/exchange-keys/Bybit", timeout=15)


# ---------- ALERT RULES CRUD ----------
def test_alert_metrics(admin):
    r = admin.get(f"{BASE_URL}/api/alerts/metrics", timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert len(body["metrics"]) == 8
    assert set(body["ops"]) == {"<", "<=", "==", ">", ">="}


def test_alert_rule_crud(admin):
    # Create
    payload = {"name": "ITER5_test_rule", "metric": "pnl_today", "op": ">=",
               "threshold": 9999.0, "enabled": False, "cooldown_seconds": 60}
    r = admin.post(f"{BASE_URL}/api/alerts/rules", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    rule = r.json()
    rid = rule["id"]
    assert rule["metric"] == "pnl_today"
    assert rule["op"] == ">="

    # Invalid metric
    r = admin.post(f"{BASE_URL}/api/alerts/rules",
                   json={"name": "x", "metric": "bogus", "op": ">", "threshold": 0}, timeout=15)
    assert r.status_code == 400

    # Invalid op
    r = admin.post(f"{BASE_URL}/api/alerts/rules",
                   json={"name": "x", "metric": "pnl_today", "op": "!!", "threshold": 0}, timeout=15)
    assert r.status_code == 400

    # PATCH
    r = admin.patch(f"{BASE_URL}/api/alerts/rules/{rid}",
                    json={"threshold": 1234.5, "enabled": True}, timeout=15)
    assert r.status_code == 200
    assert r.json()["threshold"] == 1234.5
    assert r.json()["enabled"] is True

    # PATCH bad metric
    r = admin.patch(f"{BASE_URL}/api/alerts/rules/{rid}", json={"metric": "bogus"}, timeout=15)
    assert r.status_code == 400

    # Test fire
    r = admin.post(f"{BASE_URL}/api/alerts/rules/{rid}/test", timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["delivered"] is True

    # Events should have a TEST FIRE entry
    evs = admin.get(f"{BASE_URL}/api/alerts/events?limit=20", timeout=15).json()
    assert any("TEST FIRE" in (e.get("msg") or "") and "ITER5_test_rule" in (e.get("msg") or "") for e in evs)

    # DELETE
    r = admin.delete(f"{BASE_URL}/api/alerts/rules/{rid}", timeout=15)
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_viewer_blocked_on_alerts(viewer, admin):
    # GETs allowed
    assert viewer.get(f"{BASE_URL}/api/alerts/metrics", timeout=15).status_code == 200
    assert viewer.get(f"{BASE_URL}/api/alerts/rules", timeout=15).status_code == 200
    assert viewer.get(f"{BASE_URL}/api/alerts/events", timeout=15).status_code == 200

    # Writes blocked
    r = viewer.post(f"{BASE_URL}/api/alerts/rules",
                    json={"name": "x", "metric": "pnl_today", "op": ">", "threshold": 0}, timeout=15)
    assert r.status_code == 403

    # Create via admin to test PATCH/DELETE/test forbidden
    r = admin.post(f"{BASE_URL}/api/alerts/rules",
                   json={"name": "iter5_viewer_block", "metric": "pnl_today", "op": ">",
                         "threshold": 9999.0, "enabled": False}, timeout=15)
    rid = r.json()["id"]
    try:
        assert viewer.patch(f"{BASE_URL}/api/alerts/rules/{rid}",
                            json={"enabled": True}, timeout=15).status_code == 403
        assert viewer.post(f"{BASE_URL}/api/alerts/rules/{rid}/test", timeout=15).status_code == 403
        assert viewer.delete(f"{BASE_URL}/api/alerts/rules/{rid}", timeout=15).status_code == 403
    finally:
        admin.delete(f"{BASE_URL}/api/alerts/rules/{rid}", timeout=15)


# ---------- ALERT EVALUATOR (background tick) ----------
def test_alert_evaluator_fires(admin):
    """Create rule with metric max_spread_pct > 0 and verify the background tick records an event."""
    r = admin.post(f"{BASE_URL}/api/alerts/rules",
                   json={"name": "ITER5_eval_spread", "metric": "max_spread_pct",
                         "op": ">", "threshold": 0.0, "enabled": True,
                         "cooldown_seconds": 10}, timeout=15)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    try:
        # background_tick runs every 2s; give it ~6s
        time.sleep(6)
        evs = admin.get(f"{BASE_URL}/api/alerts/events?limit=50", timeout=15).json()
        matches = [e for e in evs if "ITER5_eval_spread" in (e.get("msg") or "") or "max_spread_pct" in (e.get("msg") or "")]
        # Look for the auto-fired version (not TEST FIRE)
        auto = [e for e in matches if "TEST FIRE" not in (e.get("msg") or "")]
        assert auto, f"No auto-fired event for max_spread_pct > 0 within 6s. Sample: {evs[:5]}"
        ev = auto[0]
        assert ev.get("channel") == "telegram"
        assert (ev.get("value") or 0) > 0
        assert "max_spread_pct" in ev.get("msg", "")
    finally:
        admin.delete(f"{BASE_URL}/api/alerts/rules/{rid}", timeout=15)


# ---------- RUNTIME STATE PERSISTENCE ----------
def test_runtime_state_persistence_across_restart(admin):
    # Apply aggressive preset
    r = admin.post(f"{BASE_URL}/api/bot/preset/aggressive", timeout=15)
    assert r.status_code == 200
    cfg = admin.get(f"{BASE_URL}/api/bot/config", timeout=15).json()
    assert cfg["min_spread_pct"] == 0.18

    # Wait for persistence loop to write (every 15s)
    time.sleep(17)

    # Restart backend
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=True, timeout=30)

    # Wait until healthy
    for _ in range(30):
        try:
            r = requests.get(f"{BASE_URL}/api/health", timeout=5)
            if r.status_code == 200:
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        pytest.fail("backend did not come back up after restart")

    # Re-login (cookies/state cleared)
    s = _bearer_session(ADMIN_EMAIL, ADMIN_PASSWORD)
    cfg = s.get(f"{BASE_URL}/api/bot/config", timeout=15).json()
    assert cfg["min_spread_pct"] == 0.18, f"runtime state not hydrated: {cfg}"
    assert cfg["max_position_usd"] == 5000.0

    # Restore defaults
    s.post(f"{BASE_URL}/api/bot/preset/balanced", timeout=15)
