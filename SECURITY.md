# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 2.x     | ✅ Yes    |
| < 2.0   | ❌ No     |

---

## Reporting a Vulnerability

**DO NOT** open a public GitHub issue for security vulnerabilities.

### How to report

1. **GitHub Security Advisory (preferred)**  
   Go to **[Security → Advisories → Report a vulnerability](../../security/advisories/new)** and submit a private report.

2. **Email**  
   Send details to the repository owner via the email listed on the GitHub profile.

Please include:
- A clear description of the vulnerability
- Steps to reproduce (proof-of-concept if possible)
- Potential impact / CVSS score estimate
- Any suggested fix

### What to expect

| Timeline       | Action |
|----------------|--------|
| Within 48 h    | Acknowledgement of the report |
| Within 7 days  | Initial severity assessment and response |
| Within 30 days | Patch released (or agreed remediation timeline) |
| After fix      | Public disclosure with credit to reporter |

---

## Security Design

### Secrets Management
- All API keys and secrets are stored in **GitHub Actions Secrets** and pushed to **Cloudflare Workers Secrets** at deploy time.
- Secrets are **never** logged, echoed, or stored in source code.
- The temp file used during secret upload is written with `0o600` permissions and deleted immediately.
- Rotate all keys periodically; isolate DEV and PROD keys.

### Dependency Security
- Dependabot is enabled for automated dependency updates.
- `npm audit --audit-level=high` runs on every CI push and PR.
- Review and merge Dependabot PRs regularly.

### Runtime Protection
- All exchange API requests are authenticated with HMAC signatures.
- Rate limiting is enforced per-exchange in `src/exchange.js`.
- The Worker validates the `ADMIN_TOKEN` header on all administrative endpoints.
- Sensitive environment variables are injected via Cloudflare Worker Secrets, never via `wrangler.toml`.

### Access Control
- Least-privilege principle: API tokens have only the permissions they need.
- Remove "Client IP Address Filtering" from Cloudflare tokens only if absolutely required; prefer scoped permissions instead.

---

## Security Checklist for Contributors

- [ ] No secrets, API keys, or tokens in code or comments
- [ ] No new `console.log` / logging of request headers or auth credentials
- [ ] Dependencies added via `npm install` and audited with `npm audit`
- [ ] PR reviewed by at least one maintainer before merge to `main`
- [ ] Wrangler env secrets used — never plain text in `wrangler.toml`
