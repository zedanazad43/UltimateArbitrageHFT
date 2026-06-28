# Test Credentials — UltimateArbitrageHFT Control Center

## Admin Account
- Email: `admin@arbhft.io`
- Password: `Admin@123`
- Role: `admin`

## Auth Endpoints
- POST `/api/auth/login` — body: `{email, password}` — returns `{token, user}` and sets `access_token` cookie
- POST `/api/auth/logout` — clears `access_token` cookie
- GET `/api/auth/me` — returns current user (auth required)

## Auth Mechanism
- Backend stores admin in MongoDB (`users` collection), bcrypt hashed.
- Frontend uses **cookie-only authentication**: `access_token` is an httpOnly + Secure cookie set by `/api/auth/login`. The frontend axios client uses `withCredentials: true`. JWT is **NOT** stored in `localStorage` (XSS-hardened).
- Pytest test file `/app/backend/tests/test_iteration2.py` reads credentials from `TEST_ADMIN_EMAIL` / `TEST_ADMIN_PASSWORD` or `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars, falling back to parsing `/app/backend/.env`.

## Notes
- Mock data engine (`background_tick`) runs server-side and generates spreads / trades / logs every ~2s while bot is "running".
- Trades and logs are persisted to MongoDB (`trades`, `engine_logs`) and survive restarts.
- Exchange API keys are stored Fernet-encrypted in `exchange_keys` collection.
- Worker URL: `https://ecostamp.net` (currently returns Cloudflare 1014/403 — backend gracefully falls back to mock).
