# Changelog

All notable changes to DocFlow Platform are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [M6] — Notifications & Integrations — 2026-03-16

Full release notes: [docs/releases/m6-notifications-integrations.md](docs/releases/m6-notifications-integrations.md)

### Added

- **Email notifications** — transactional emails for all document lifecycle events (`document.submitted`, `document.approved`, `document.rejected`, `document.assigned`, `document.escalated`). Async delivery via configurable SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`). HTML + plain-text templates in `src/templates/email/`. `EMAIL_ENABLED=false` logs to console in dev.
- **Webhook event delivery** — external systems can subscribe to document lifecycle events via registered webhooks. HMAC-signed payloads (`X-DocFlow-Signature`), up-to-3 retry with exponential back-off, full delivery log. API: `POST /api/webhooks`, `GET /api/webhooks`, `DELETE /api/webhooks/:id`, `GET /api/webhooks/:id/deliveries`.
- **In-app notification center** — per-user notification inbox in the top nav. Unread badge, dropdown panel, "Mark all read" button, 60-second polling. Notifications purged after 30 days. API: `GET /api/notifications`, `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all`, `GET /api/notifications/unread-count`.
- **User notification preferences** — per-event opt-in/out controls for email and in-app channels. Settings page at `/settings/notifications`. Dispatch services check preferences before sending. Admins always receive `document.escalated` regardless of preference.
- **Admin SMTP configuration & template management** — admin UI "Email" tab at `/admin/settings` for SMTP credentials (AES-256 encrypted at rest) with test-send button. Template editor for per-event subject and body with live preview. Audit log entry on config changes (`system.smtp_config_changed`).

### Known Limitations

- In-app notifications use 60-second polling; WebSocket/SSE real-time push is planned for M7.
- Notification center is not mobile-optimised in this release.
- Webhook delivery requires HTTPS URLs in production.

---

## [M7-partial] — Advanced Approval Workflow — 2026-03-16

### Added

- **Approval delegation** — approvers going on leave can temporarily delegate their authority to another user with Approver or Admin role. Delegations have mandatory start and end dates; during an active delegation, incoming documents are automatically re-routed to the delegate. The approval queue also surfaces delegated items. Admins can view and revoke any active delegation. Circular delegation chains are rejected. Audit trail records `delegation.created`, `delegation.revoked`, and `document.delegated` events.
  - API: `POST /api/delegations`, `GET /api/delegations`, `DELETE /api/delegations/:id`
  - Admin API: `GET /api/admin/delegations`, `DELETE /api/admin/delegations/:id`

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
