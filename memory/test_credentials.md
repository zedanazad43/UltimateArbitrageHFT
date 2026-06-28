# Test Credentials — UltimateArbitrageHFT Control Center

## Admin Account
- Email: `admin@arbhft.io`
- Password: `Admin@123`
- Role: `admin`

## Auth Endpoints
- POST `/api/auth/login` — body: `{email, password}` — returns `{token, user}` and sets `access_token` cookie
- POST `/api/auth/logout` — clears `access_token` cookie
- GET `/api/auth/me` — returns current user (auth required)

## Notes
- Backend stores admin in MongoDB (`users` collection), bcrypt hashed.
- Frontend persists the JWT in `localStorage` (`auth_token`) as Bearer fallback, and via `access_token` httpOnly cookie.
- Mock data engine (`background_tick`) runs server-side and generates spreads / trades / logs every ~2s while bot is "running".
