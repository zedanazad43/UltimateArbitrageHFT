"""Iteration 7 backend tests: Autopilot + Live-mode safety readiness gating."""
import os
import time
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
VIEWER_EMAIL = "viewer_iter7@arbhft.io"
VIEWER_PASSWORD = "Viewer@123"


def _bearer_session(email, password):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed: {r.text}"
    token = r.json()["token"]
    s.cookies.clear()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s, token


@pytest.fixture(scope="session")
def admin():
    s, _ = _bearer_session(ADMIN_EMAIL, ADMIN_PASSWORD)
    return s


@pytest.fixture(scope="session")
def viewer(admin):
    # cleanup pre-existing
    for u in admin.get(f"{BASE_URL}/api/users", timeout=15).json():
        if u["email"] == VIEWER_EMAIL:
            admin.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=15)
    r = admin.post(f"{BASE_URL}/api/users", json={
        "email": VIEWER_EMAIL, "password": VIEWER_PASSWORD, "name": "Iter7 Viewer", "role": "viewer"
    }, timeout=15)
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    sess, _ = _bearer_session(VIEWER_EMAIL, VIEWER_PASSWORD)
    yield sess
    admin.delete(f"{BASE_URL}/api/users/{vid}", timeout=15)


# ---------- Live readiness ----------
def test_live_readiness_shape(admin):
    r = admin.get(f"{BASE_URL}/api/safety/live-readiness", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("ready", "blocking_count", "checks", "ts"):
        assert k in body, f"missing {k}: {body}"
    assert isinstance(body["checks"], list) and len(body["checks"]) == 5
    ids = [c["id"] for c in body["checks"]]
    expected = {"trade_key", "telegram", "fast_alert", "paper_track", "worker"}
    assert set(ids) == expected, f"expected {expected}, got {ids}"
    # Each check has required keys
    for c in body["checks"]:
        for k in ("id", "label", "ok", "required"):
            assert k in c, f"check missing {k}: {c}"
    # Per environment notes: Telegram unconfigured, worker fails → blocking_count >= 2
    assert body["blocking_count"] >= 2, f"expected blocking_count>=2, got {body['blocking_count']}: {body['checks']}"
    assert body["ready"] is False


# ---------- Safety gating on /api/bot/mode ----------
def test_bot_mode_live_blocked(admin):
    r = admin.post(f"{BASE_URL}/api/bot/mode", json={"mode": "live"}, timeout=15)
    assert r.status_code == 409, f"expected 409 got {r.status_code}: {r.text}"
    detail = r.json().get("detail", "")
    assert "LIVE mode blocked" in detail, detail
    assert "prerequisite" in detail.lower(), detail


def test_bot_mode_paper_succeeds(admin):
    r = admin.post(f"{BASE_URL}/api/bot/mode", json={"mode": "paper"}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["mode"] == "paper"


# ---------- Autopilot status ----------
def test_autopilot_status_shape(admin):
    r = admin.get(f"{BASE_URL}/api/autopilot/status", timeout=15)
    assert r.status_code == 200, r.text
    doc = r.json()
    required = ("enabled", "promote_interval_hours", "min_winner_lead_pct",
                "min_lane_trades", "circuit_breaker_enabled",
                "breaker_events", "breaker_window_minutes",
                "last_promoted_at", "last_promoted_preset", "last_pause_at")
    for k in required:
        assert k in doc, f"missing {k} in autopilot/status: {doc}"


# ---------- Autopilot config ----------
def test_autopilot_config_update(admin):
    payload = {
        "enabled": True, "promote_interval_hours": 6, "min_winner_lead_pct": 5.0,
        "min_lane_trades": 10, "circuit_breaker_enabled": True,
        "breaker_events": 3, "breaker_window_minutes": 10,
    }
    r = admin.put(f"{BASE_URL}/api/autopilot/config", json=payload, timeout=15)
    assert r.status_code == 200, r.text
    doc = r.json()
    for k, v in payload.items():
        assert doc.get(k) == v, f"{k}: expected {v} got {doc.get(k)}"


def test_autopilot_config_invalid(admin):
    for bad in ({"promote_interval_hours": 0}, {"promote_interval_hours": 200}):
        r = admin.put(f"{BASE_URL}/api/autopilot/config", json=bad, timeout=15)
        assert r.status_code == 400, f"{bad} -> {r.status_code} {r.text}"


def test_autopilot_config_viewer_forbidden(viewer):
    r = viewer.put(f"{BASE_URL}/api/autopilot/config", json={"enabled": False}, timeout=15)
    assert r.status_code == 403, r.text


# ---------- Autopilot resume ----------
def test_autopilot_resume_sets_running(admin):
    r = admin.post(f"{BASE_URL}/api/autopilot/resume", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") == "running"

    # verify audit entry
    time.sleep(0.5)
    r = admin.get(f"{BASE_URL}/api/audit?action=autopilot.resume&limit=20", timeout=15)
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) >= 1, "no autopilot.resume audit entry"
    assert all(e["action"] == "autopilot.resume" for e in entries)


def test_autopilot_resume_viewer_forbidden(viewer):
    r = viewer.post(f"{BASE_URL}/api/autopilot/resume", timeout=15)
    assert r.status_code == 403


# ---------- Circuit breaker integration ----------
def test_autopilot_circuit_breaker(admin):
    """Force 2 alert events in window, expect autopilot loop to pause bot."""
    # 1) Wipe alert events to start clean
    # Use rules list, then trigger events
    # We can't directly delete events via API; instead we set breaker_events high enough
    # AND test logic by counting events post-trigger. To make this deterministic with a
    # 60s loop, configure breaker_events=2 within breaker_window_minutes=5.
    # Pre-condition: bot must be running
    admin.post(f"{BASE_URL}/api/bot/action", json={"action": "start"}, timeout=15)

    # Configure autopilot for low threshold
    r = admin.put(f"{BASE_URL}/api/autopilot/config", json={
        "enabled": True, "circuit_breaker_enabled": True,
        "breaker_events": 2, "breaker_window_minutes": 5,
    }, timeout=15)
    assert r.status_code == 200, r.text

    # Need at least one alert rule
    rules = admin.get(f"{BASE_URL}/api/alerts/rules", timeout=15).json()
    if not rules:
        r = admin.post(f"{BASE_URL}/api/alerts/rules", json={
            "name": "ITER7_breaker", "metric": "max_spread_pct", "op": ">",
            "threshold": 0, "cooldown_seconds": 1, "enabled": True,
        }, timeout=15)
        assert r.status_code == 200, r.text
        rule_id = r.json()["id"]
        cleanup_rule = True
    else:
        rule_id = rules[0]["id"]
        cleanup_rule = False

    # Force-fire 2 events
    for _ in range(2):
        r = admin.post(f"{BASE_URL}/api/alerts/rules/{rule_id}/test", timeout=15)
        # endpoint may return 200 or 404; check shape later via events
        time.sleep(0.5)

    # Wait up to 90s for autopilot loop tick (sleeps 60s)
    deadline = time.time() + 95
    paused = False
    while time.time() < deadline:
        time.sleep(5)
        st = admin.get(f"{BASE_URL}/api/bot/status", timeout=15).json()
        if st.get("status") == "stopped":
            paused = True
            break

    try:
        assert paused, f"bot was not paused by autopilot within 95s. Final status: {st}"

        ap = admin.get(f"{BASE_URL}/api/autopilot/status", timeout=15).json()
        assert ap.get("last_pause_at"), f"last_pause_at not set: {ap}"

        # Resume
        r = admin.post(f"{BASE_URL}/api/autopilot/resume", timeout=15)
        assert r.status_code == 200
        st = admin.get(f"{BASE_URL}/api/bot/status", timeout=15).json()
        assert st["status"] == "running"
    finally:
        # Restore thresholds
        admin.put(f"{BASE_URL}/api/autopilot/config", json={
            "breaker_events": 3, "breaker_window_minutes": 10, "enabled": False,
        }, timeout=15)
        if cleanup_rule:
            admin.delete(f"{BASE_URL}/api/alerts/rules/{rule_id}", timeout=15)


# ---------- REGRESSION ----------
def test_regression_iter6_endpoints(admin):
    paths = [
        "/api/bot/status", "/api/bot/config", "/api/market/spreads",
        "/api/market/opportunities", "/api/trades", "/api/pnl",
        "/api/wallet/balances", "/api/logs", "/api/telegram/config",
        "/api/exchange-keys", "/api/worker/health", "/api/users",
        "/api/pnl/series?hours=24", "/api/public/stats",
        "/api/bot/presets", "/api/alerts/rules", "/api/alerts/events",
        "/api/alerts/metrics", "/api/audit?limit=10", "/api/ab/status",
        "/api/autopilot/status", "/api/safety/live-readiness",
    ]
    for p in paths:
        r = admin.get(f"{BASE_URL}{p}", timeout=15)
        assert r.status_code == 200, f"{p} -> {r.status_code}: {r.text[:200]}"
