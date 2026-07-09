"""Iteration 8 backend tests: Worker Deploy page — probe + smoke endpoints."""
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
VIEWER_EMAIL = "viewer_iter8@arbhft.io"
VIEWER_PASSWORD = "Viewer@123"


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
    # cleanup pre-existing
    for u in admin.get(f"{BASE_URL}/api/users", timeout=15).json():
        if u["email"] == VIEWER_EMAIL:
            admin.delete(f"{BASE_URL}/api/users/{u['id']}", timeout=15)
    r = admin.post(f"{BASE_URL}/api/users", json={
        "email": VIEWER_EMAIL, "password": VIEWER_PASSWORD, "name": "Iter8 Viewer", "role": "viewer"
    }, timeout=15)
    assert r.status_code in (200, 201), r.text
    vid = r.json()["id"]
    sess, _ = _bearer_session(VIEWER_EMAIL, VIEWER_PASSWORD)
    yield sess
    admin.delete(f"{BASE_URL}/api/users/{vid}", timeout=15)


# ---------- Worker probe ----------
class TestWorkerProbe:
    def test_probe_returns_fresh_state(self, admin):
        r = admin.post(f"{BASE_URL}/api/worker/probe", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        # should have status_code (int or None) and last_check timestamp string
        assert "last_check" in data
        assert isinstance(data["last_check"], str) and len(data["last_check"]) > 0
        assert "configured" in data
        # since ecostamp.net is 403, ok should be False (worker unreachable / non-200)
        assert "ok" in data

    def test_probe_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/worker/probe", timeout=15)
        assert r.status_code in (401, 403)

    def test_health_returns_cached(self, admin):
        r = admin.get(f"{BASE_URL}/api/worker/health", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "configured" in data
        assert "ok" in data


# ---------- Worker smoke ----------
class TestWorkerSmoke:
    def test_smoke_admin_returns_5_rows(self, admin):
        r = admin.get(f"{BASE_URL}/api/worker/smoke", timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "configured" in data
        assert "url" in data
        assert "ts" in data
        assert "all_ok" in data
        assert "results" in data
        assert isinstance(data["results"], list)
        if data["configured"]:
            assert len(data["results"]) == 5, f"expected 5 rows got {len(data['results'])}"
            paths = [row["path"] for row in data["results"]]
            assert paths == ["/health", "/status", "/spreads", "/opportunities", "/balances"]
            for row in data["results"]:
                for key in ("ok", "shape_ok", "status_code", "expected_type", "expected_keys", "missing_keys", "error", "sample"):
                    assert key in row, f"row {row['path']} missing key {key}"
            # Worker is intentionally unreachable (403 from ecostamp.net) — expect all failing
            # all_ok must be false
            assert data["all_ok"] is False
            # at least one row should have non-2xx status (most likely all 5)
            non_2xx = [row for row in data["results"] if not row["ok"]]
            assert len(non_2xx) >= 1, "Worker appears reachable — expected 403/unreachable on ecostamp.net"

    def test_smoke_requires_admin(self, viewer):
        r = viewer.get(f"{BASE_URL}/api/worker/smoke", timeout=30)
        assert r.status_code == 403, f"expected 403 for viewer, got {r.status_code}: {r.text}"

    def test_smoke_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/worker/smoke", timeout=15)
        assert r.status_code in (401, 403)


# ---------- Regression on existing endpoints ----------
class TestRegression:
    def test_dashboard_status(self, admin):
        r = admin.get(f"{BASE_URL}/api/bot/status", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "status" in data
        assert "mode" in data

    def test_spreads(self, admin):
        r = admin.get(f"{BASE_URL}/api/market/spreads", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "rows" in data or isinstance(data, list)

    def test_opportunities(self, admin):
        r = admin.get(f"{BASE_URL}/api/market/opportunities", timeout=15)
        assert r.status_code == 200

    def test_balances(self, admin):
        r = admin.get(f"{BASE_URL}/api/wallet/balances", timeout=15)
        assert r.status_code == 200

    def test_autopilot_status(self, admin):
        r = admin.get(f"{BASE_URL}/api/autopilot/status", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "enabled" in data

    def test_alerts_rules(self, admin):
        r = admin.get(f"{BASE_URL}/api/alerts/rules", timeout=15)
        assert r.status_code == 200

    def test_audit_log(self, admin):
        r = admin.get(f"{BASE_URL}/api/audit", timeout=15)
        assert r.status_code == 200

    def test_users_list(self, admin):
        r = admin.get(f"{BASE_URL}/api/users", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
