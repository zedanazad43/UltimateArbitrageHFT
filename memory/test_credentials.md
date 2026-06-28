# Test Credentials — UltimateArbitrageHFT Control Center

## Bootstrap Admin (always present)
- Email: `admin@arbhft.io`
- Password: `Admin@123`
- Role: `admin`
- Auto-seeded from `backend/.env` at startup; cannot be demoted or deleted via the API.

## Roles
- `admin` — full control (bot/action, bot/mode, bot/config PUT, telegram, exchange-keys CRUD, users CRUD)
- `viewer` — read-only (all GET endpoints + login/logout); write attempts return 403

## Auth Mechanism
- **Cookie-only JWT**: `access_token` is an httpOnly + Secure + SameSite=None cookie set by `POST /api/auth/login`.
- **CSRF (double-submit)**: a non-httpOnly companion cookie `csrf_token` is set on login; frontend axios reads it and echoes it as `X-CSRF-Token` header on every state-changing request. Backend rejects mismatched / missing headers with 403.
- **CLI/pytest**: send `Authorization: Bearer <token>` only (no cookies) — CSRF middleware bypasses pure-bearer requests.
- **Refresh CSRF**: `GET /api/auth/csrf` (authenticated) issues a fresh token and updates the cookie.

## Endpoints
- `POST /api/auth/login` — `{email, password}` → `{token, csrf_token, user}` + cookies
- `POST /api/auth/logout` — clears both cookies
- `GET /api/auth/me` — current user
- `GET /api/auth/csrf` — refreshes the CSRF token

## Test File
- `/app/backend/tests/test_iteration2.py` (phase-2 regression)
- `/app/backend/tests/test_iteration4.py` (CSRF + roles + permissions + PnL series + public stats)
- Both read creds from `TEST_ADMIN_EMAIL`/`TEST_ADMIN_PASSWORD` or `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars, falling back to parsing `/app/backend/.env`.

## Public Page (no auth required)
- `GET /share` (frontend) and `GET /api/public/stats` (backend) — share-safe stats, no secrets.
