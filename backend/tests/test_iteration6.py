"""Iteration 6 backend tests: JWT revocation, audit log, alert cooldown persistence, A/B endpoints."""
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
VIEWER_EMAIL = "viewer_iter6@arbhft.io"
VIEWER_PASSWORD = "Viewer@123"
VIEWER2_EMAIL = "viewer_iter6b@arbhft.io"
VIEWER2_PASSWORD = "Viewer@123"


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


# ---------- REGRESSION ----------
def test_regression_endpoints(admin):
    """All iteration_1..5 endpoints still respond OK."""
    paths = [
        "/api/bot/status", "/api/bot/config", "/api/market/spreads",
        "/api/market/opportunities", "/api/trades", "/api/pnl",
        "/api/wallet/balances", "/api/logs", "/api/telegram/config",
        "/api/exchange-keys", "/api/worker/health", "/api/users",
        "/api/pnl/series?hours=24", "/api/public/stats",
        "/api/bot/presets", "/api/alerts/rules", "/api/alerts/events",
        "/api/alerts/metrics",
    ]
    for p in paths:
        r = admin.get(f"{BASE_URL}{p}", timeout=15)
        assert r.status_code == 200, f"{p} -> {r.status_code}: {r.text[:200]}"


# ---------- JWT revocation via role change ----------
def test_jwt_revocation_on_role_change(admin):
    # Cleanup pre-existing viewer
    for u in admin.get(f"{BASE_URL}/api/users", timeout=15).json():
        if u["email"] == VIEWER_EMAIL:
            admin.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=15)

    r = admin.post(f"{BASE_URL}/api/users",
                   json={"email": VIEWER_EMAIL, "password": VIEWER_PASSWORD, "name": "Iter6 Viewer", "role": "viewer"},
                   timeout=15)
    assert r.status_code == 200, r.text
    vid = r.json()["id"]

    try:
        # Viewer token1
        v_sess, token2 = _bearer_session(VIEWER_EMAIL, VIEWER_PASSWORD)
        r = v_sess.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200

        # Admin promotes viewer to admin → token_version bumps
        r = admin.patch(f"{BASE_URL}/api/users/{vid}", json={"role": "admin"}, timeout=15)
        assert r.status_code == 200, r.text

        # token2 (old) should now be revoked
        r = v_sess.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text}"
        assert "revoked" in r.text.lower(), r.text

        # Fresh login works
        v_sess2, _ = _bearer_session(VIEWER_EMAIL, VIEWER_PASSWORD)
        r = v_sess2.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"
    finally:
        admin.delete(f"{BASE_URL}/api/users/{vid}", timeout=15)


# ---------- JWT revocation via password change ----------
def test_jwt_revocation_on_password_change(admin):
    for u in admin.get(f"{BASE_URL}/api/users", timeout=15).json():
        if u["email"] == VIEWER2_EMAIL:
            admin.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=15)
    r = admin.post(f"{BASE_URL}/api/users",
                   json={"email": VIEWER2_EMAIL, "password": VIEWER2_PASSWORD, "name": "Iter6 Viewer B", "role": "viewer"},
                   timeout=15)
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    try:
        v_sess, _ = _bearer_session(VIEWER2_EMAIL, VIEWER2_PASSWORD)
        assert v_sess.get(f"{BASE_URL}/api/auth/me", timeout=15).status_code == 200

        # Admin changes password
        r = admin.patch(f"{BASE_URL}/api/users/{vid}", json={"password": "NewPass@123"}, timeout=15)
        assert r.status_code == 200, r.text

        # Old token is revoked
        r = v_sess.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 401
        assert "revoked" in r.text.lower()

        # New password works
        v_sess2, _ = _bearer_session(VIEWER2_EMAIL, "NewPass@123")
        assert v_sess2.get(f"{BASE_URL}/api/auth/me", timeout=15).status_code == 200
    finally:
        admin.delete(f"{BASE_URL}/api/users/{vid}", timeout=15)


# ---------- Audit log endpoint ----------
def test_audit_endpoint_basic(admin):
    # Generate audit events
    r = admin.post(f"{BASE_URL}/api/bot/action", json={"action": "start"}, timeout=15)
    assert r.status_code == 200, r.text
    r = admin.post(f"{BASE_URL}/api/bot/mode", json={"mode": "paper"}, timeout=15)
    assert r.status_code == 200, r.text

    time.sleep(0.5)
    r = admin.get(f"{BASE_URL}/api/audit?limit=200", timeout=15)
    assert r.status_code == 200, r.text
    entries = r.json()
    assert isinstance(entries, list) and len(entries) >= 2
    sample = entries[0]
    for k in ("ts", "actor_email", "actor_role", "action", "details"):
        assert k in sample, f"missing key {k} in audit entry: {sample}"

    actions = {e["action"] for e in entries}
    assert "bot.start" in actions, f"actions={actions}"
    assert "bot.mode" in actions, f"actions={actions}"


def test_audit_filter(admin):
    admin.post(f"{BASE_URL}/api/bot/action", json={"action": "start"}, timeout=15)
    time.sleep(0.3)
    r = admin.get(f"{BASE_URL}/api/audit?action=bot.start&limit=50", timeout=15)
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) >= 1
    assert all(e["action"] == "bot.start" for e in entries)


def test_audit_viewer_forbidden(admin):
    # Create temp viewer for this test
    em = "viewer_iter6_audit@arbhft.io"
    for u in admin.get(f"{BASE_URL}/api/users", timeout=15).json():
        if u["email"] == em:
            admin.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=15)
    r = admin.post(f"{BASE_URL}/api/users",
                   json={"email": em, "password": "Viewer@123", "name": "Audit Viewer", "role": "viewer"},
                   timeout=15)
    assert r.status_code == 200
    vid = r.json()["id"]
    try:
        v_sess, _ = _bearer_session(em, "Viewer@123")
        r = v_sess.get(f"{BASE_URL}/api/audit", timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"
    finally:
        admin.delete(f"{BASE_URL}/api/users/{vid}", timeout=15)


def test_audit_failed_login_entry(admin):
    """Failed login should be audited with action='auth.login_failed'."""
    bogus_email = "iter6_fail@arbhft.io"
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": bogus_email, "password": "wrongpass"}, timeout=15)
    assert r.status_code in (401, 403, 400)
    time.sleep(0.5)
    r = admin.get(f"{BASE_URL}/api/audit?action=auth.login_failed&limit=50", timeout=15)
    assert r.status_code == 200
    entries = r.json()
    # check at least one entry contains our email in details
    found = any((e.get("details") or {}).get("email") == bogus_email for e in entries)
    assert found, f"failed login not audited for {bogus_email}. Recent={entries[:3]}"


# ---------- A/B endpoints ----------
def test_ab_full_flow(admin):
    # Reset
    r = admin.post(f"{BASE_URL}/api/ab/reset", timeout=15)
    assert r.status_code == 200

    # Status after reset returns defaults
    r = admin.get(f"{BASE_URL}/api/ab/status", timeout=15)
    assert r.status_code == 200
    s = r.json()
    assert s.get("enabled") is False
    for k in ("lane_a", "lane_b"):
        assert k in s
        lane = s[k]
        for f in ("preset", "pnl", "trades", "wins", "win_rate"):
            assert f in lane, f"missing {f} in {k}: {lane}"

    # Start with unknown preset → 400
    r = admin.post(f"{BASE_URL}/api/ab/start", json={"lane_a_preset": "nope", "lane_b_preset": "aggressive"}, timeout=15)
    assert r.status_code == 400

    # Start valid
    r = admin.post(f"{BASE_URL}/api/ab/start",
                   json={"lane_a_preset": "conservative", "lane_b_preset": "aggressive"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["enabled"] is True
    assert body["lane_a"]["preset"] == "conservative"
    assert body["lane_b"]["preset"] == "aggressive"
    assert body["lane_a"]["trades"] == 0 and body["lane_b"]["trades"] == 0

    # Wait for the per-tick simulator to fire (background_tick runs every 2s, ~45% chance per lane per tick)
    deadline = time.time() + 20
    trades_seen = 0
    while time.time() < deadline:
        time.sleep(2)
        r = admin.get(f"{BASE_URL}/api/ab/status", timeout=15)
        st = r.json()
        trades_seen = (st["lane_a"]["trades"] or 0) + (st["lane_b"]["trades"] or 0)
        if trades_seen > 0:
            break
    assert trades_seen > 0, f"no A/B trades after 20s: {st}"

    # Stop retains counters
    r = admin.post(f"{BASE_URL}/api/ab/stop", timeout=15)
    assert r.status_code == 200
    r = admin.get(f"{BASE_URL}/api/ab/status", timeout=15)
    st = r.json()
    assert st["enabled"] is False
    assert (st["lane_a"]["trades"] or 0) + (st["lane_b"]["trades"] or 0) == trades_seen

    # Reset wipes
    r = admin.post(f"{BASE_URL}/api/ab/reset", timeout=15)
    assert r.status_code == 200
    r = admin.get(f"{BASE_URL}/api/ab/status", timeout=15)
    st = r.json()
    assert st["enabled"] is False
    assert st["lane_a"]["trades"] == 0 and st["lane_b"]["trades"] == 0


def test_ab_viewer_forbidden(admin):
    em = "viewer_iter6_ab@arbhft.io"
    for u in admin.get(f"{BASE_URL}/api/users", timeout=15).json():
        if u["email"] == em:
            admin.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=15)
    r = admin.post(f"{BASE_URL}/api/users",
                   json={"email": em, "password": "Viewer@123", "name": "AB Viewer", "role": "viewer"},
                   timeout=15)
    assert r.status_code == 200
    vid = r.json()["id"]
    try:
        v_sess, _ = _bearer_session(em, "Viewer@123")
        # GET status allowed for any authenticated user
        r = v_sess.get(f"{BASE_URL}/api/ab/status", timeout=15)
        assert r.status_code == 200
        # Writes forbidden
        for path, body in [("/api/ab/start", {"lane_a_preset": "conservative", "lane_b_preset": "aggressive"}),
                           ("/api/ab/stop", {}),
                           ("/api/ab/reset", {})]:
            r = v_sess.post(f"{BASE_URL}{path}", json=body, timeout=15)
            assert r.status_code == 403, f"{path} -> {r.status_code}"
    finally:
        admin.delete(f"{BASE_URL}/api/users/{vid}", timeout=15)


# ---------- Alert cooldown persistence ----------
def test_alert_cooldown_survives_restart(admin):
    """Create rule that fires fast, wait for event, then restart backend and confirm cooldown survives."""
    # Ensure bot is running so background_tick evaluates alerts
    admin.post(f"{BASE_URL}/api/bot/action", json={"action": "start"}, timeout=15)
    time.sleep(0.5)
    # Create rule: max_spread_pct > 0 (always fires); cooldown=20s
    name = "ITER6_cooldown"
    r = admin.post(f"{BASE_URL}/api/alerts/rules",
                   json={"name": name, "metric": "max_spread_pct", "op": ">", "threshold": 0,
                         "cooldown_seconds": 20, "enabled": True}, timeout=15)
    assert r.status_code == 200, r.text
    rule_id = r.json()["id"]

    try:
        # Wait up to 20s for the rule to fire at least once
        events_before = 0
        deadline = time.time() + 20
        while time.time() < deadline:
            time.sleep(2)
            r = admin.get(f"{BASE_URL}/api/alerts/events?limit=200", timeout=15)
            evts = r.json()
            mine = [e for e in evts if e.get("rule_id") == rule_id]
            if mine:
                events_before = len(mine)
                break
        assert events_before >= 1, "Rule did not fire in 10s"

        # Verify rule doc now has last_fired_at
        r = admin.get(f"{BASE_URL}/api/alerts/rules", timeout=15)
        rule_docs = [x for x in r.json() if x.get("id") == rule_id]
        assert rule_docs, "rule missing"
        assert rule_docs[0].get("last_fired_at"), f"last_fired_at not set on rule: {rule_docs[0]}"

        # Restart backend
        subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=False, timeout=30)
        # wait for backend to come back up
        for _ in range(30):
            time.sleep(1)
            try:
                hr = requests.get(f"{BASE_URL}/api/health", timeout=5)
                if hr.status_code == 200:
                    break
            except Exception:
                pass

        # Re-login (token kept in admin fixture is still valid but cookies cleared; bearer still ok)
        time.sleep(4)  # let background_tick run a couple of cycles
        r = admin.get(f"{BASE_URL}/api/alerts/events?limit=200", timeout=15)
        if r.status_code == 401:
            # bearer token still works since JWT_SECRET unchanged across restart; just retry once
            time.sleep(2)
            r = admin.get(f"{BASE_URL}/api/alerts/events?limit=200", timeout=15)
        assert r.status_code == 200, r.text
        evts = r.json()
        mine_after = [e for e in evts if e.get("rule_id") == rule_id]
        delta = len(mine_after) - events_before
        # Cooldown 20s — within 4-6s after restart we should see 0 or at most 1 additional event,
        # not a storm of 3+.
        assert delta <= 1, f"cooldown did not survive restart: before={events_before} after={len(mine_after)} delta={delta}"
    finally:
        admin.delete(f"{BASE_URL}/api/alerts/rules/{rule_id}", timeout=15)
