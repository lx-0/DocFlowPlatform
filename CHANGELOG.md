# Changelog

All notable changes to DocFlow Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [M4] — Enterprise Integration & Security — 2026-03-16

Full release notes: [docs/releases/m4-release-notes.md](docs/releases/m4-release-notes.md)

### Added

- **Role-Based Access Control (RBAC)** — permission-enforcing middleware applied at every API route. Four built-in roles (`admin`, `approver`, `submitter`, `viewer`) ship from seed. Custom roles can be created with any combination of the five available permissions (`documents:read`, `documents:write`, `documents:approve`, `admin:users`, `admin:roles`). Admin UI at `/admin/users` and `/admin/roles`.
- **SAML 2.0 / OIDC Single Sign-On** — DocFlow can act as a SAML 2.0 Service Provider or an OIDC Relying Party. SP metadata endpoint at `GET /api/auth/sso/metadata`. Automatic user provisioning on first login. Role claim mapping via `SSO_ROLE_CLAIM`. Tested with Okta, Azure AD, and Google Workspace.
- **LDAP / Active Directory authentication** — authenticate users against any LDAP-compatible directory via `POST /api/auth/ldap/login`. Configurable user search filter, TLS support (`ldaps://`), and group-to-role mapping via `LDAP_ROLE_MAP`.
- **Audit trail** — immutable event log covering authentication, administration, and document lifecycle events. Admin UI at `/admin/audit-logs`. API access at `GET /api/admin/audit-logs` with filtering by actor, action, resource, and date range.
- **Public REST API** (`/api/v1/`) — versioned, API-key-authenticated external integration surface. Endpoints: `POST /api/v1/documents`, `GET /api/v1/documents/:id`, `GET /api/v1/documents/:id/download`. Rate limited to 100 requests/minute per key.
- **API key management** — admins can generate and revoke API keys at `/admin/api-keys`. Keys are stored hashed; plaintext is shown only at creation.
- **Auth mode configuration** — frontend auth mode controlled by `VITE_AUTH_MODE` (`local`, `ldap`, `sso`).

### Known Limitations

- SSO logout does not initiate IdP Single Logout (SLO) or OIDC end-session.
- Audit log has no automatic retention/pruning.
- Processed documents are not automatically purged from storage.
- RBAC Admin UI (`/admin/users`, `/admin/roles`) depends on DOCA-32 (ships separately).
- Frontend SSO/LDAP wiring (DOCA-35) is in progress; backend endpoints are fully functional.

---

## [M3] — Routing & Approval Workflow

### Added

- Multi-step approval workflow engine with state machine transitions.
- Routing engine to auto-assign documents to named approval queues based on configurable routing rules.
- Routing rules data model and CRUD API.
- Approver UI with queue and document review pages.
- Routing rules admin UI.
- Submitter status tracking view.
- Email notification service for workflow events.

---

## [M2] — Document Ingestion & Formatting Engine

### Added

- Document upload endpoint with file storage (PDF and DOCX).
- Document metadata extraction for PDF and DOCX files.
- DOCX template engine with company formatting rules.
- Format validation service.
- Cover sheet generator.
- Document processing pipeline orchestration.

---

## [M1] — Foundation & Infrastructure

### Added

- Node.js / Express backend with PostgreSQL and Prisma ORM.
- React frontend with Vite dev server proxying to backend.
- JWT-based local email/password authentication.
- GitHub Actions CI pipeline.
