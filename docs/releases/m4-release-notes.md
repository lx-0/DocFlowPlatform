# M4 Release Notes — Enterprise Integration & Security

**Release:** Milestone 4
**Date:** March 2026
**Audience:** Enterprise customers, system administrators, integration developers

---

## Overview

Milestone 4 delivers the enterprise integration and security layer for DocFlow Platform. This release equips organizations with the authentication, access control, and compliance infrastructure required for production enterprise deployments: federated Single Sign-On via SAML 2.0 and OIDC, LDAP/Active Directory authentication, granular Role-Based Access Control, a full audit trail, and a versioned public REST API secured by API keys. Organizations that previously relied on local email/password accounts can now connect DocFlow to their identity provider or directory, enforce least-privilege permissions across all document workflows, and satisfy compliance requirements with an immutable event log.

---

## New Features

### Role-Based Access Control (RBAC)

DocFlow now enforces per-route permission checks on every API request. Access is governed by roles composed of named permissions, giving administrators fine-grained control over what each user can see and do.

- **Four built-in roles** ship out of the box: `admin` (full superadmin access), `approver` (review and approve documents), `submitter` (upload and create documents), and `viewer` (read-only access). The `admin` role bypasses all permission checks — it is the superadmin role.
- **Custom roles** can be created by admins through the Admin UI (`/admin/roles`) or REST API. A custom role is any combination of the five available permissions: `documents:read`, `documents:write`, `documents:approve`, `admin:users`, `admin:roles`.
- **Admin UI** at `/admin/users` and `/admin/roles` lets administrators list all users, change role assignments, and manage role definitions without touching the API directly.

See [docs/admin/rbac.md](../admin/rbac.md) and [docs/dev/rbac.md](../dev/rbac.md) for full admin and developer references.

### Single Sign-On — SAML 2.0 & OIDC

DocFlow can now act as a SAML 2.0 Service Provider or an OIDC Relying Party, delegating all credential handling to an Identity Provider.

- **SAML 2.0** support for Okta, Azure Active Directory, Google Workspace, and any standards-compliant IdP. SP metadata is served at `GET /api/auth/sso/metadata` for automated IdP configuration.
- **OIDC** support using Discovery (`/.well-known/openid-configuration`), so endpoint configuration is automatic once `SSO_ISSUER` is set. Tested with Okta, Azure AD, and Google Workspace.
- **Automatic user provisioning** — users are created in DocFlow on first SSO login; no pre-population of accounts is required.
- **Role claim mapping** — configure `SSO_ROLE_CLAIM` to map an IdP assertion or userinfo claim directly to a DocFlow role on every login.
- Enabled by setting `SSO_PROVIDER=saml` or `SSO_PROVIDER=oidc` plus provider-specific environment variables. Disabled by default — existing local-auth deployments are unaffected.

See [docs/admin/sso.md](../admin/sso.md) for setup instructions, including provider-specific notes.

### Single Sign-On — LDAP / Active Directory

DocFlow can authenticate users against any LDAP-compatible directory, including Microsoft Active Directory and OpenLDAP.

- **Service-account bind** — a dedicated read-only service account searches the directory; end-user credentials are verified with a short-lived bind and never stored.
- **Configurable user search filter** — defaults to `(mail={email})`; can be changed to `sAMAccountName`, `userPrincipalName`, or any directory attribute.
- **Group-to-role mapping** — `LDAP_ROLE_MAP` maps LDAP group DNs to DocFlow roles. Role assignments update automatically on each login if group membership changes.
- **TLS support** — use `ldaps://` for encrypted connections to the directory server.
- Enabled by setting `LDAP_URL`. The frontend switches to LDAP mode via `VITE_AUTH_MODE=ldap`.

See [docs/admin/ldap.md](../admin/ldap.md) for full setup and troubleshooting.

### Audit Trail

Every security-relevant and compliance-relevant action across the platform is now recorded in an immutable audit log accessible to administrators.

- **Events captured:** authentication (`user.login`, `user.login_failed`, `user.logout`), administration (`user.created`, `user.role_changed`), and document lifecycle (`document.uploaded`, `document.viewed`, `document.approved`, `document.rejected`, `document.changes_requested`).
- **Each entry records:** timestamp, actor identity (ID and email at time of event), action type, affected resource, and a metadata object with additional context (document title, workflow step, IP address, etc.).
- **Admin UI** at `/admin/audit-logs` provides a searchable, filterable table of all events, with filters by actor, action type, and date range.
- **API access** via `GET /api/admin/audit-logs` supports the same filters and returns paginated results (up to 200 per page). Requires the `admin:audit` permission.
- **Compliance use cases** supported out of the box: document approval chains, sensitive document access logs, failed login investigations, role change history.

See [docs/admin/audit-logs.md](../admin/audit-logs.md) for the full event catalogue and query examples.

### Public REST API

External systems can now integrate with DocFlow through a versioned, API-key-authenticated REST API at `/api/v1/`.

- **Three endpoints** cover the full external integration flow: `POST /api/v1/documents` to submit a file, `GET /api/v1/documents/:id` to poll processing status and approval state, and `GET /api/v1/documents/:id/download` to retrieve the processed document.
- **API key authentication** — keys are issued by admins at `/admin/api-keys` and sent as `Authorization: ApiKey <key>`. Keys can be revoked at any time without affecting other integrations.
- **Rate limiting** at 100 requests per minute per key. Exceeding the limit returns `429 Too Many Requests` with a `Retry-After` header.
- **Accepted formats:** PDF and DOCX, up to 50 MB per file.
- The `/api/v1/` prefix is stable — future backwards-compatible changes will not alter these endpoints.

See [docs/api/rest-api.md](../api/rest-api.md) for the full endpoint reference and end-to-end integration examples. See [docs/api/api-key-management.md](../api/api-key-management.md) for key lifecycle management.

---

## Security Hardening

A security review of the M4 feature set was completed prior to release. Key areas addressed:

- All RBAC permission checks are enforced server-side by middleware applied at the route level — there is no client-side gate that can be bypassed.
- LDAP service-account credentials are never exposed to clients. End-user passwords are verified via a short-lived directory bind and are not stored or logged.
- SSO mode delegates all credential handling to the Identity Provider — no passwords transit DocFlow in `sso` mode.
- API keys are stored as hashed values; the plaintext key is shown only once at creation time.
- Audit log entries are append-only and cannot be modified or deleted through the API.
- LDAP connections default to plaintext on port 389 for compatibility; `ldaps://` (port 636) is recommended for all production deployments.

---

## Upgrade Notes

M4 introduces several new environment variables. **No action is required** for features you are not enabling — all M4 authentication methods are disabled by default and fall back to `501 Not Implemented` unless explicitly configured.

### RBAC

Run the database seed after upgrading to populate built-in roles and auto-assign the `submitter` role to any existing users without a role:

```bash
npm run db:seed
```

No environment variables are required for RBAC itself.

### SSO (SAML 2.0 / OIDC)

Set these variables in `backend/.env` to enable SSO. Leave unset to keep local-auth behavior:

| Variable | Required | Description |
|:---------|:---------|:------------|
| `SSO_PROVIDER` | Yes | `saml` or `oidc` |
| `SSO_ENTRY_POINT` | SAML | IdP SSO URL |
| `SSO_ISSUER` | Yes | SP entity ID (SAML) or OIDC issuer URL |
| `SSO_CERT` | SAML | IdP public certificate PEM |
| `SSO_CALLBACK_URL` | Yes | ACS URL (SAML) or OIDC redirect URI |
| `SSO_CLIENT_ID` | OIDC | OIDC client ID |
| `SSO_CLIENT_SECRET` | OIDC | OIDC client secret |
| `SSO_ROLE_CLAIM` | No | IdP claim name carrying the DocFlow role |

Set `VITE_AUTH_MODE=sso` in `frontend/.env` to switch the login UI to SSO mode.

### LDAP / Active Directory

Set these variables in `backend/.env` to enable LDAP. Leave unset to keep local-auth behavior:

| Variable | Required | Description |
|:---------|:---------|:------------|
| `LDAP_URL` | Yes | LDAP server URL (`ldap://` or `ldaps://`) |
| `LDAP_BASE_DN` | Yes | Base DN for user search |
| `LDAP_BIND_DN` | Yes | Service account DN |
| `LDAP_BIND_PASSWORD` | Yes | Service account password |
| `LDAP_USER_FILTER` | No | Search filter template (default: `(mail={email})`) |
| `LDAP_ROLE_ATTRIBUTE` | No | LDAP attribute carrying group membership |
| `LDAP_ROLE_MAP` | No | JSON mapping of LDAP group DNs to DocFlow roles |

Set `VITE_AUTH_MODE=ldap` in `frontend/.env` to switch the login UI to LDAP mode.

### Auth mode (frontend)

The frontend auth mode is controlled by `VITE_AUTH_MODE` in `frontend/.env`:

```env
VITE_AUTH_MODE=local   # default — no change needed if staying on local auth
VITE_AUTH_MODE=ldap    # switch to LDAP login form
VITE_AUTH_MODE=sso     # switch to SSO redirect button
```

After changing this variable, restart the dev server or rebuild the frontend.

---

## Known Limitations

The following items are implemented and functional but have known gaps that will be addressed in a future milestone:

- **SSO logout** — clicking "Sign out" in the DocFlow UI invalidates the local JWT session but does not initiate a SAML Single Logout (SLO) or OIDC end-session flow. The user remains authenticated at the IdP.
- **Audit log retention** — audit events accumulate indefinitely. There is no automatic pruning or archival. For high-traffic deployments, monitor table size and plan a retention strategy proactively.
- **File purge** — processed documents are not automatically purged from storage after a retention period. Cleanup must be performed manually.
- **RBAC Admin UI** — the `/admin/users` and `/admin/roles` pages depend on DOCA-32, which ships separately. Until that work is complete, user and role management must be performed via the REST API.
- **Frontend SSO/LDAP integration** — `VITE_AUTH_MODE=ldap` and `VITE_AUTH_MODE=sso` frontend wiring (DOCA-35) is in progress. Backend endpoints for both modes are fully functional and can be exercised directly.

---

## Related Documentation

| Document | Description |
|:---------|:------------|
| [docs/admin/rbac.md](../admin/rbac.md) | RBAC admin guide — roles, permissions, user management |
| [docs/dev/rbac.md](../dev/rbac.md) | RBAC developer reference — middleware, permission model |
| [docs/admin/sso.md](../admin/sso.md) | SSO setup — SAML 2.0 and OIDC configuration |
| [docs/admin/ldap.md](../admin/ldap.md) | LDAP/Active Directory integration |
| [docs/admin/auth-modes.md](../admin/auth-modes.md) | Auth mode reference — `local`, `ldap`, `sso` |
| [docs/admin/audit-logs.md](../admin/audit-logs.md) | Audit log admin guide — events, access, compliance |
| [docs/api/rest-api.md](../api/rest-api.md) | Public REST API reference |
| [docs/api/api-key-management.md](../api/api-key-management.md) | API key management guide |
