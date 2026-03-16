# M4 Security Review Checklist

**Milestone:** M4 — Enterprise Features (RBAC, SSO/LDAP, Audit Log, Public API)
**Date:** 2026-03-16
**Reviewer:** Engineer
**Scope:** Review + light remediation. Not a full penetration test.

---

## 1. Authentication

### 1.1 JWT

| Item | Status | Notes |
|------|--------|-------|
| JWT secret is not hardcoded | ⚠️ WARN | `.env` contains dev placeholder `docflow-dev-secret-change-in-production`; must be replaced in production with a long random secret |
| JWT secret loaded from environment variable | ✅ PASS | `process.env.JWT_SECRET` used in `middleware/auth.js` and both SSO/LDAP services |
| Token expiry configured | ✅ PASS | Default `8h` via `JWT_EXPIRES_IN` env var |
| Token verified with `jwt.verify` | ✅ PASS | `middleware/auth.js:12` — uses `jwt.verify(token, process.env.JWT_SECRET)` |
| Token revocation / blacklist | ❌ FAIL | No blacklist mechanism; tokens remain valid until expiry even after logout. **Track as follow-up.** |
| Token refresh mechanism | ❌ FAIL | No refresh endpoint; sessions expire after 8h with no renewal. **Track as follow-up.** |

### 1.2 SSO / SAML Assertion Validation

| Item | Status | Notes |
|------|--------|-------|
| SAML assertions required to be signed | ✅ FIXED | Was `false`; remediated to `wantAssertionsSigned: true` in `services/ssoService.js:90` |
| IdP certificate configured | ✅ PASS | `SSO_CERT` env var required for SAML strategy |
| OIDC state parameter for CSRF | ✅ PASS | `state` parameter generated and validated in OIDC callback flow |
| OIDC token validation via library | ✅ PASS | `openid-client` handles ID token verification |
| SSO user auto-provisioning domain restriction | ❌ FAIL | Any valid IdP user can create a local account; no email domain allowlist. **Track as follow-up.** |
| SSO events logged to audit log | ❌ FAIL | SSO login/failure not recorded. **Track as follow-up.** |

### 1.3 LDAP Injection Prevention

| Item | Status | Notes |
|------|--------|-------|
| LDAP filter special chars escaped | ✅ FIXED | Was a character blacklist (`[\*()\x00/]`); remediated to RFC 4515 hex-encoding of all special chars in `services/ldapService.js:155` |
| Service account credentials in environment | ⚠️ WARN | `LDAP_BIND_PASSWORD` in `.env`; should use a secrets manager in production |
| TLS enforced for LDAP connections | ❌ FAIL | No requirement for `ldaps://`; connections may be unencrypted. **Track as follow-up.** |
| Rate limiting on LDAP auth failures | ❌ FAIL | No brute-force protection for LDAP credential attempts. **Track as follow-up.** |

---

## 2. Authorization (RBAC)

| Item | Status | Notes |
|------|--------|-------|
| RBAC middleware applied to all admin routes | ✅ PASS | All `/api/admin/*` routes use `authenticate` + `requirePermission(...)` (`routes/admin.js`) |
| RBAC middleware applied to document routes | ✅ PASS | Document routes check authentication and owner |
| RBAC middleware applied to routing-rules routes | ✅ PASS | Confirmed in `routes/routingRules.js` |
| RBAC middleware applied to approval routes | ✅ PASS | Confirmed in `routes/approvals.js` |
| Public API v1 routes authenticated | ✅ PASS | `routes/v1.js` applies `authenticateApiKey` to all routes |
| Superadmin bypass scope documented | ⚠️ WARN | `role === 'admin'` check in `middleware/rbac.js:41` skips all permission checks. Acceptable for now but scope should be audited; admin role assignment requires `admin:users` permission |
| Permission cache TTL | ⚠️ WARN | 60-second TTL means permission revocations take up to 60s to propagate; acceptable for current scale |
| No unguarded protected routes found | ✅ PASS | Manual review of all route files; no routes found without auth middleware |

---

## 3. API Keys

| Item | Status | Notes |
|------|--------|-------|
| API keys hashed at rest (bcrypt) | ✅ PASS | `bcryptjs` with cost factor 12; raw key returned only once on creation (`routes/admin.js:153`) |
| No plaintext key storage | ✅ PASS | Only `keyHash` persisted in `ApiKey` table |
| Key revocation enforced | ✅ PASS | `revokedAt` soft-delete; revoked keys rejected immediately in `middleware/apiKeyAuth.js` |
| Rate limiting active | ✅ PASS | 100 req/min per `apiKeyId` via `express-rate-limit` on all `/api/v1` routes |
| Rate limiter persistence | ⚠️ WARN | In-memory store; resets on server restart and not suitable for multi-instance deployments. **Track as follow-up (Redis store).** |
| API key lookup performance | ⚠️ WARN | Full table scan on every request (`prisma.apiKey.findMany`). Acceptable at current scale but will degrade. **Track as follow-up (key prefix index).** |
| API key expiration dates | ❌ FAIL | Keys never expire automatically; only manual revocation. **Track as follow-up.** |
| API key scope / permission limits | ❌ FAIL | Keys inherit full user permissions. **Track as follow-up.** |

---

## 4. Audit Log

| Item | Status | Notes |
|------|--------|-------|
| `user.login` events logged | ✅ PASS | `controllers/authController.js` |
| `user.login_failed` events logged | ✅ PASS | `controllers/authController.js` |
| `user.role_changed` events logged | ✅ PASS | `routes/admin.js:42` |
| `apikey.created` events logged | ✅ PASS | `routes/admin.js:167` |
| `apikey.revoked` events logged | ✅ PASS | `routes/admin.js:204` |
| `document.viewed` events logged | ✅ PASS | `controllers/documentController.js:192` |
| `document.submitted_via_api` events logged | ✅ PASS | `routes/v1.js:105` |
| PII leakage in metadata | ⚠️ WARN | Login failure metadata includes plaintext email and reason string. Acceptable for security audit purposes but not suitable if audit logs are shared widely |
| Audit log write errors surfaced | ⚠️ WARN | Fire-and-forget pattern (`auditLog.js:19`); write errors only go to stderr. Low risk for audit completeness but metrics/alerting recommended |
| Missing: SSO/LDAP auth events | ❌ FAIL | SSO and LDAP login/failure not logged. **Track as follow-up.** |
| Missing: document download events | ❌ FAIL | Downloads via `/api/v1/documents/:id/download` not logged. **Track as follow-up.** |
| Missing: permission denial events | ❌ FAIL | RBAC `requirePermission` denials not logged. **Track as follow-up.** |

---

## 5. Input Validation

| Item | Status | Notes |
|------|--------|-------|
| File upload MIME type check | ✅ PASS | Allowlist: PDF + DOCX only (`routes/v1.js:24`, `controllers/documentController.js`) |
| File size limit enforced | ✅ PASS | 50MB hard limit via multer |
| Uploaded file stored with UUID name | ✅ PASS | `uuidv4()` as storage filename prevents directory traversal |
| Content-Disposition header injection | ✅ FIXED | Was raw filename interpolation; remediated to strip `\r`, `\n`, `"` in `routes/v1.js:203` |
| MIME type magic bytes verification | ❌ FAIL | Only checks `file.mimetype` from multer (client-controllable). **Track as follow-up (add `file-type` magic bytes check).** |
| SAML input (nameID / email) | ✅ PASS | `profile.email || profile.nameID`; used only for DB lookup, no shell execution |
| LDAP filter injection | ✅ FIXED | See section 1.3 above |
| JSON request body parsing | ✅ PASS | `express.json()` middleware with default 100kb limit |

---

## 6. Dependency Audit (`npm audit`)

Run: `npm audit` in `backend/` on 2026-03-16.

**Summary:** 12 vulnerabilities (6 moderate, 5 high, 1 critical)

| Package | Severity | Advisory | Fix Status |
|---------|----------|----------|-----------|
| `passport-saml` | **CRITICAL** | [GHSA-4mxg-3p6v-xgq3](https://github.com/advisories/GHSA-4mxg-3p6v-xgq3) — SAML Signature Verification Bypass | No fix available from upstream. Mitigated by enabling `wantAssertionsSigned: true`. **Track for package replacement (node-saml / samlify).** |
| `xml2js` < 0.5.0 | MODERATE | [GHSA-776f-qx25-q3cc](https://github.com/advisories/GHSA-776f-qx25-q3cc) — Prototype pollution | No fix available; transitive dep of `passport-saml` |
| `nodemailer` ≤ 7.0.10 | HIGH | [GHSA-mm7p-fcc7-pg87](https://github.com/advisories/GHSA-mm7p-fcc7-pg87) — Domain interpretation conflict | Fix via `npm audit fix --force` (breaking: upgrades to v8); **track for upgrade** |
| `nodemailer` ≤ 7.0.10 | HIGH | [GHSA-rcmh-qjqh-p98v](https://github.com/advisories/GHSA-rcmh-qjqh-p98v) — DoS via recursive address parse | Same fix as above |
| `@hono/node-server` < 1.19.10 | HIGH | [GHSA-wc8c-qw6v-h7f6](https://github.com/advisories/GHSA-wc8c-qw6v-h7f6) — Auth bypass via encoded slashes | Transitive via `@prisma/dev` (dev-only). Not exploitable in production build. Fix: upgrade `prisma` to v6 (breaking) |
| `hono` < 4.11.7 | HIGH (3×) | Various XSS, cache deception, IPv4 spoofing | Transitive via `@prisma/dev` (dev-only). Not production exploitable. Fix: upgrade `prisma` to v6 |
| `chevrotain` / `@chevrotain/*` / `lodash` | MODERATE | Prototype pollution | Transitive via `@prisma/dev` (dev-only) |

**Full `npm audit` output:** see `backend/npm-audit.txt` (generated below).

---

## 7. HTTPS / Security Headers

| Item | Status | Notes |
|------|--------|-------|
| `helmet.js` configured | ✅ PASS | Applied globally in `src/app.js:19` |
| `Content-Security-Policy` set | ✅ PASS | Configured with `defaultSrc: ['self']`, `scriptSrc: ['self']`, etc. |
| `Strict-Transport-Security` configured | ✅ PASS | 1-year maxAge, `includeSubDomains: true`, `preload: true` |
| `X-Content-Type-Options: nosniff` | ✅ PASS | Default helmet behavior |
| `X-Frame-Options: DENY` | ✅ PASS | `frameSrc: ['none']` in CSP |
| CORS policy reviewed | ✅ PASS | Default `CORS_ORIGIN=false` = same-origin only; configurable via env var |
| `styleSrc: 'unsafe-inline'` | ⚠️ WARN | Weakens CSP; allows all inline styles. **Track for follow-up (use nonces or hash-based CSP).** |
| `Referrer-Policy` header | ❌ FAIL | Not set. **Track as follow-up.** |
| `Permissions-Policy` header | ❌ FAIL | Not set. **Track as follow-up.** |

---

## Summary

### Items Fixed Inline

| # | File | Change |
|---|------|--------|
| 1 | `services/ssoService.js` | `wantAssertionsSigned: false` → `true` |
| 2 | `routes/v1.js` | Sanitize `originalFilename` before use in `Content-Disposition` header |
| 3 | `services/ldapService.js` | LDAP filter escaping: character blacklist → RFC 4515 hex-encoding |

### Follow-up Issues to Track

| Priority | Item |
|----------|------|
| HIGH | Replace / upgrade `passport-saml` (GHSA-4mxg-3p6v-xgq3; no fix available) |
| HIGH | Upgrade `nodemailer` to v8 (breaking change — review impact first) |
| HIGH | Add magic bytes MIME validation for file uploads |
| MEDIUM | JWT token revocation / blacklist |
| MEDIUM | JWT refresh token endpoint |
| MEDIUM | SSO: email domain allowlist for auto-provisioning |
| MEDIUM | Log SSO/LDAP auth events to audit log |
| MEDIUM | Log document downloads to audit log |
| MEDIUM | Log RBAC permission denials to audit log |
| MEDIUM | Add `Referrer-Policy` and `Permissions-Policy` headers |
| MEDIUM | LDAP: enforce TLS (`ldaps://`) |
| MEDIUM | LDAP: rate-limit failed auth attempts |
| LOW | API key: add expiration dates |
| LOW | API key: scope / permission limits |
| LOW | API key: persistent rate limit store (Redis) for multi-instance |
| LOW | API key: indexed lookup to avoid full table scan |
| LOW | `styleSrc: 'unsafe-inline'` → CSP nonces |
