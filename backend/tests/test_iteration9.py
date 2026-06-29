"""Iteration 9 backend tests: Go-Live Roadmap regression — /api/safety/live-readiness
plus iter_8 regression (worker probe + smoke + admin gating + core endpoints)."""
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
VIEWER_EMAIL = "viewer_iter9@arbhft.io"
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
    for u in admin.get(f"{BASE_URL}/api/users", timeout=15).json():
        if u["email"] == VIEWER_EMAIL:
            admin.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=15)
    r = admin.post(f"{BASE_URL}/api/users", json={
        "email": VIEWER_EMAIL, "password": VIEWER_PASSWORD, "name": "Iter9 Viewer", "role": "viewer"
    }, timeout=15)
    assert r.status_code in (200, 201), r.text
    vid = r.json()["id"]
    sess, _ = _bearer_session(VIEWER_EMAIL, VIEWER_PASSWORD)
    yield sess
    admin.delete(f"{BASE_URL}/api/users/{vid}", timeout=15)


# ---------- /api/safety/live-readiness ----------
class TestLiveReadiness:
    def test_shape_and_check_ids(self, admin):
        r = admin.get(f"{BASE_URL}/api/safety/live-readiness", timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        # required keys
        for k in ("ready", "blocking_count", "checks", "ts"):
            assert k in data, f"missing top-level key {k}"
        assert isinstance(data["ready"], bool)
        assert isinstance(data["blocking_count"], int)
        assert isinstance(data["checks"], list)
        assert len(data["checks"]) == 5, f"expected 5 checks, got {len(data['checks'])}"
        ids = [c["id"] for c in data["checks"]]
        assert ids == EXPECTED_CHECK_IDS, f"check ids order mismatch: {ids}"
        for c in data["checks"]:
            for f in ("id", "label", "ok", "required"):
                assert f in c, f"check {c.get('id')} missing field {f}"
            assert isinstance(c["ok"], bool)
            assert isinstance(c["required"], bool)
            assert isinstance(c["label"], str) and len(c["label"]) > 0

    def test_blocking_count_matches_not_ok_required(self, admin):
        r = admin.get(f"{BASE_URL}/api/safety/live-readiness", timeout=20)
        data = r.json()
        expected_blocking = sum(1 for c in data["checks"] if c["required"] and not c["ok"])
        assert data["blocking_count"] == expected_blocking
        assert data["ready"] == (expected_blocking == 0)

    def test_worker_check_is_not_ok(self, admin):
        # Per problem statement: ecostamp.net is 403 → worker.ok must be False
        r = admin.get(f"{BASE_URL}/api/safety/live-readiness", timeout=20)
        data = r.json()
        worker_check = next(c for c in data["checks"] if c["id"] == "worker")
        assert worker_check["ok"] is False, "Worker should not be ok while ecostamp.net is 403"
        assert data["ready"] is False, "ready should be false while worker is offline"

    def test_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/safety/live-readiness", timeout=15)
        assert r.status_code in (401, 403)

    def test_viewer_access(self, viewer):
        # Endpoint uses get_current_user (not require_admin) so viewer is allowed.
        # Frontend gates the card on isAdmin separately. Document the actual behavior.
        r = viewer.get(f"{BASE_URL}/api/safety/live-readiness", timeout=20)
        # Accept either 200 (current implementation) or 403 (if admin-gated later)
        assert r.status_code in (200, 403), f"unexpected {r.status_code}: {r.text}"


# ---------- Iter 8 regression ----------
class TestWorkerProbeRegression:
    def test_probe_returns_fresh_state(self, admin):
        r = admin.post(f"{BASE_URL}/api/worker/probe", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("last_check", "configured", "ok"):
            assert k in data
        assert isinstance(data["last_check"], str) and len(data["last_check"]) > 0

    def test_health_returns_cached(self, admin):
        r = admin.get(f"{BASE_URL}/api/worker/health", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "configured" in data and "ok" in data


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
            for row in data["results"]:
                for key in ("ok", "shape_ok", "status_code", "expected_type", "expected_keys", "missing_keys", "error", "sample"):
                    assert key in row, f"row {row['path']} missing key {key}"
            assert data["all_ok"] is False

    def test_smoke_requires_admin(self, viewer):
        r = viewer.get(f"{BASE_URL}/api/worker/smoke", timeout=30)
        assert r.status_code == 403


class TestCoreRegression:
    def test_bot_status(self, admin):
        r = admin.get(f"{BASE_URL}/api/bot/status", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "status" in d and "mode" in d

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
