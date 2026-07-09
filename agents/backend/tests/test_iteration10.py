"""Iteration 10 backend tests: /api/safety/live-readiness now admin-only (require_admin).

Verifies the iter_10 surgical fix:
- Admin → 200 with full shape unchanged
- Viewer → 403 (was 200 in iter_9)
- No auth → 401/403
Plus iter_8 + iter_9 regression (worker probe/health/smoke + core endpoints).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")

ADMIN_EMAIL = "zedanazad43@gmail.com"
ADMIN_PASSWORD = "Zed-gxvgfNixv4biRJ!"
VIEWER_EMAIL = "viewer_iter10@arbhft.io"
VIEWER_PASSWORD = "Viewer@123"

EXPECTED_CHECK_IDS = ["trade_key", "telegram", "fast_alert", "paper_track", "worker"]


def _bearer_session(email, password):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, f"login failed [{r.status_code}]: {r.text}"
    data = r.json()
    token = data["token"]
    csrf = data.get("csrf_token") or s.cookies.get("csrf_token")
    s.cookies.clear()
    s.headers.update({"Authorization": f"Bearer {token}"})
    if csrf:
        s.headers.update({"X-CSRF-Token": csrf})
    return s, token


@pytest.fixture(scope="session")
def admin():
    s, _ = _bearer_session(ADMIN_EMAIL, ADMIN_PASSWORD)
    return s


@pytest.fixture(scope="session")
def viewer(admin):
    # Cleanup any leftover viewer first
    users = admin.get(f"{BASE_URL}/api/users", timeout=15).json()
    for u in users:
        if u["email"] == VIEWER_EMAIL:
            admin.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=15)
    r = admin.post(f"{BASE_URL}/api/users", json={
        "email": VIEWER_EMAIL, "password": VIEWER_PASSWORD, "name": "Iter10 Viewer", "role": "viewer"
    }, timeout=15)
    assert r.status_code in (200, 201), r.text
    vid = r.json()["id"]
    sess, _ = _bearer_session(VIEWER_EMAIL, VIEWER_PASSWORD)
    yield sess
    admin.delete(f"{BASE_URL}/api/users/{vid}", timeout=15)


# ---------- /api/safety/live-readiness ----------
class TestLiveReadinessAdminOnly:
    """Iter_10 fix: endpoint now requires admin role."""

    def test_admin_returns_200_with_full_shape(self, admin):
        r = admin.get(f"{BASE_URL}/api/safety/live-readiness", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("ready", "blocking_count", "checks", "ts"):
            assert k in data, f"missing top-level key {k}"
        assert isinstance(data["ready"], bool)
        assert isinstance(data["blocking_count"], int)
        assert isinstance(data["checks"], list)
        assert len(data["checks"]) == 5
        ids = [c["id"] for c in data["checks"]]
        assert ids == EXPECTED_CHECK_IDS
        for c in data["checks"]:
            for f in ("id", "label", "ok", "required"):
                assert f in c
            assert isinstance(c["ok"], bool)
            assert isinstance(c["required"], bool)

    def test_blocking_count_matches_not_ok_required(self, admin):
        r = admin.get(f"{BASE_URL}/api/safety/live-readiness", timeout=20)
        data = r.json()
        expected_blocking = sum(1 for c in data["checks"] if c["required"] and not c["ok"])
        assert data["blocking_count"] == expected_blocking
        assert data["ready"] == (expected_blocking == 0)

    def test_worker_check_is_not_ok(self, admin):
        r = admin.get(f"{BASE_URL}/api/safety/live-readiness", timeout=20)
        data = r.json()
        worker = next(c for c in data["checks"] if c["id"] == "worker")
        assert worker["ok"] is False
        assert data["ready"] is False

    def test_viewer_now_returns_403(self, viewer):
        """ITER_10 FIX: was 200 in iter_9, must now be 403."""
        r = viewer.get(f"{BASE_URL}/api/safety/live-readiness", timeout=20)
        assert r.status_code == 403, (
            f"viewer should now be FORBIDDEN, got {r.status_code}: {r.text}"
        )

    def test_no_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/safety/live-readiness", timeout=15)
        assert r.status_code in (401, 403), f"unexpected {r.status_code}: {r.text}"


# ---------- Iter 8/9 regression ----------
class TestWorkerProbeRegression:
    def test_probe_returns_fresh_state(self, admin):
        r = admin.post(f"{BASE_URL}/api/worker/probe", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("last_check", "configured", "ok"):
            assert k in data

    def test_health_returns_cached(self, admin):
        r = admin.get(f"{BASE_URL}/api/worker/health", timeout=15)
        assert r.status_code == 200, r.text


class TestWorkerSmokeRegression:
    def test_smoke_admin_returns_5_rows(self, admin):
        r = admin.get(f"{BASE_URL}/api/worker/smoke", timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("configured", "url", "ts", "all_ok", "results"):
            assert k in data
        if data["configured"]:
            assert len(data["results"]) == 5
            paths = [row["path"] for row in data["results"]]
            assert paths == ["/health", "/status", "/spreads", "/opportunities", "/balances"]

    def test_smoke_requires_admin(self, viewer):
        r = viewer.get(f"{BASE_URL}/api/worker/smoke", timeout=30)
        assert r.status_code == 403


class TestCoreRegression:
    def test_bot_status(self, admin):
        r = admin.get(f"{BASE_URL}/api/bot/status", timeout=15)
        assert r.status_code == 200

    def test_pnl(self, admin):
        r = admin.get(f"{BASE_URL}/api/pnl", timeout=15)
        assert r.status_code == 200

    def test_opportunities(self, admin):
        r = admin.get(f"{BASE_URL}/api/market/opportunities", timeout=15)
        assert r.status_code == 200

    def test_trades(self, admin):
        r = admin.get(f"{BASE_URL}/api/trades?limit=6", timeout=15)
        assert r.status_code == 200

    def test_autopilot_status(self, admin):
        r = admin.get(f"{BASE_URL}/api/autopilot/status", timeout=15)
        assert r.status_code == 200

    def test_alerts_rules(self, admin):
        r = admin.get(f"{BASE_URL}/api/alerts/rules", timeout=15)
        assert r.status_code == 200

    def test_audit_log(self, admin):
        r = admin.get(f"{BASE_URL}/api/audit", timeout=15)
        assert r.status_code == 200

    def test_users_list(self, admin):
        r = admin.get(f"{BASE_URL}/api/users", timeout=15)
        assert r.status_code == 200
