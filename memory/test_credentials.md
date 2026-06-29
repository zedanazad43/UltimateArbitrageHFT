# Test Credentials — UltimateArbitrageHFT Control Center

## Bootstrap Admin (re-seeded from backend/.env on every startup)
- **Email**: `zedanazad43@gmail.com`
- **Password**: `Zed-gxvgfNixv4biRJ!`  ← TEMPORARY — change immediately
- Role: `admin`

⚠️ This is a generated temporary password. Sign in once, then go to the **Users** page and change it to a strong unique password you've never used anywhere else. **NEVER reuse your email password for any service.**

## Roles
- `admin` — full control
- `viewer` — read-only

## Auth Mechanism
- Cookie-only JWT (httpOnly + Secure + SameSite=None)
- CSRF double-submit via non-httpOnly `csrf_token` cookie + `X-CSRF-Token` header
- JWT revocation: `users.token_version` bumped on password / role change
- Bootstrap admin cannot be demoted or deleted via API (lifespan re-promotes role on every startup)

## Endpoints
- `POST /api/auth/login` — `{email, password}` → `{token, csrf_token, user}` + cookies
- `POST /api/auth/logout` — clears both cookies
- `GET /api/auth/me` — current user
- `GET /api/auth/csrf` — refresh CSRF token

## To change the admin password permanently
1. Sign in with the temporary password above
2. Go to **Users** page → click your row → set a new password via the (currently API-only) `PATCH /api/users/{id}` endpoint with `{"password":"YourNewStrongPassword"}` — or update `ADMIN_PASSWORD` in `/app/backend/.env` and restart backend; the new password will be re-seeded.
