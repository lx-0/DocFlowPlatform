# M6 Release Notes — Notifications & Integrations

**Release:** Milestone 6
**Date:** March 2026
**Audience:** End users, system administrators, integration developers

---

## Overview

Milestone 6 delivers the Notifications & Integrations layer for DocFlow Platform. This release ensures that every stakeholder in a document workflow is kept informed in real time — through transactional email, an in-app notification inbox, and outbound webhook delivery for external systems. Administrators gain full control over email infrastructure and template content from the Admin UI, and users can tailor exactly which alerts they receive per notification channel. Together these features eliminate the need for manual status checks and enable DocFlow to push events into any downstream platform that supports HTTP webhooks.

---

## New Features

### Email Notifications

DocFlow now sends transactional emails for every document lifecycle event, keeping submitters and approvers informed without requiring them to log in to check status.

- **Lifecycle events covered:** `document.submitted` (notifies assigned approvers), `document.approved` (notifies submitter), `document.rejected` (notifies submitter, includes rejection reason), `document.assigned` (notifies new assignee), and `document.escalated` (notifies escalation target).
- **Async dispatch** — emails are queued and delivered asynchronously so document operations are never delayed by mail delivery. In development mode, emails are logged to the console instead of sent (`EMAIL_ENABLED=false`).
- **Configurable transport** — SMTP credentials are set via `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and `SMTP_PASS` environment variables. Templates for each event type live in `src/templates/email/` and provide both plain-text and HTML variants.

See [docs/admin/email-notifications.md](../admin/email-notifications.md) for SMTP setup, template customisation, and event reference.

---

### Webhook Event Delivery

External systems integrated through the DocFlow public REST API can now subscribe to document lifecycle events via HTTP webhooks, enabling real-time push notifications to third-party platforms without polling.

- **Webhook registration** — integrators register endpoints via the API (`POST /api/webhooks`). Each webhook specifies the target URL, a list of event types to subscribe to, and an HMAC signing secret.
- **Signed payloads** — every delivery is signed with `X-DocFlow-Signature: sha256=<hmac>` so receiving systems can verify the request originated from DocFlow. Payload shape matches the public REST API document response.
- **Reliable delivery** — failed deliveries are retried up to three times with exponential back-off. All attempts are logged to the `WebhookDelivery` table and queryable via `GET /api/webhooks/:id/deliveries` (last 50 entries).
- **Webhook management endpoints:** `POST /api/webhooks` (register), `GET /api/webhooks` (list), `DELETE /api/webhooks/:id` (remove), `GET /api/webhooks/:id/deliveries` (delivery log).

See [docs/api/webhooks.md](../api/webhooks.md) for the full integration guide, payload schemas, and signature verification examples.

---

### In-App Notification Center

Users can now see a real-time notification inbox in the DocFlow interface without relying on email, providing a persistent record of pending actions and recent document activity.

- **Notification bell** — a bell icon in the top navigation bar shows the unread count badge. Clicking opens a panel listing recent notifications (up to 50), each with an icon, title, relative timestamp, and a direct link to the relevant document. A "Mark all read" button clears the badge.
- **Same events as email** — notifications are created for all five document lifecycle events (submitted, approved, rejected, assigned, escalated), ensuring both channels stay in sync.
- **API endpoints:** `GET /api/notifications` (list, supports `?unreadOnly=true`), `PATCH /api/notifications/:id/read` (mark single read), `POST /api/notifications/read-all` (mark all read), `GET /api/notifications/unread-count` (badge count).
- **Automatic purge** — notifications older than 30 days are deleted nightly to prevent unbounded table growth.

---

### User Notification Preferences

Users can opt in or out of email and in-app notifications independently for each event type, reducing noise while preserving critical alerts.

- **Per-event toggles** — a settings page at `/settings/notifications` presents a table with a row for each event type and separate toggles for the Email and In-App channels.
- **Default all-on** — all notifications are enabled by default on first login, matching enterprise expectations.
- **Preference-aware dispatch** — both the email and in-app dispatch services check preferences before sending; opting out of a channel suppresses delivery without affecting the other channel.
- **Admin exception** — the `document.escalated` event is always delivered to admins regardless of preference settings.

---

### Admin SMTP Configuration & Template Management

Administrators can configure the DocFlow mail server and customise notification email templates directly from the Admin UI, without requiring environment variable changes or redeploys.

- **SMTP settings UI** — a new "Email" tab on the `/admin/settings` page exposes all SMTP fields (`smtpHost`, `smtpPort`, `smtpUser`, `smtpPass`, `smtpFromAddress`, `smtpFromName`). A "Send test email" button verifies the configuration before saving. Environment variable values serve as fallback when database settings are absent.
- **Encrypted at rest** — SMTP passwords are stored using AES-256 encryption keyed by `ENCRYPTION_KEY`. All changes are recorded in the audit log (`system.smtp_config_changed`).
- **Template management** — admins can view and edit the subject line and body (Handlebars format) for each notification event type. A "Preview" button renders the template with sample data before saving. Template changes take effect immediately for new notifications.
- **API endpoints:** `GET /api/admin/notification-templates`, `PATCH /api/admin/notification-templates/:eventType`, `PATCH /api/admin/settings` (SMTP), `POST /api/admin/settings/test-email`.

---

## Known Limitations

The following items are known gaps at M6 release. They will be addressed in M7:

- **WebSocket/SSE push** — in-app notifications use 60-second polling. Real-time server-sent events (or WebSocket delivery) are planned for a future milestone.
- **Mobile notification center** — the notification bell panel is not optimised for mobile viewports in this release. Mobile responsiveness is out of scope for M6.
- **Webhook HTTPS enforcement** — webhook delivery requires HTTPS URLs in production. HTTP is permitted in development and test environments only.
- **Advanced workflow notifications** — event types related to the advanced approval workflow (DOCA-64 escalation rules, bulk actions) will be added in M7.

---

## Upgrade Notes

### Database migration

Run the Prisma migration after upgrading to add the `Webhook`, `WebhookDelivery`, `Notification`, and `NotificationPreference` tables:

```bash
npm run db:migrate
```

No data loss occurs — all new tables are additive.

### Email transport

Configure SMTP credentials in `backend/.env` or via the Admin UI (Admin Settings → Email tab):

| Variable | Required | Description |
|:---------|:---------|:------------|
| `SMTP_HOST` | Yes | SMTP server hostname |
| `SMTP_PORT` | Yes | SMTP port (typically `587` for STARTTLS, `465` for SSL) |
| `SMTP_USER` | Yes | SMTP authentication username |
| `SMTP_PASS` | Yes | SMTP authentication password |
| `EMAIL_ENABLED` | No | Set `true` to send real emails (default: `false` — logs to console) |

### Admin SMTP encryption key

Set `ENCRYPTION_KEY` in `backend/.env` (minimum 32 bytes, base64-encoded) before using the Admin UI SMTP settings form:

```env
ENCRYPTION_KEY=<your-32-byte-base64-key>
```

Omitting this variable disables encrypted storage of the SMTP password in the database; environment variable fallback continues to function.

---

## Related Documentation

| Document | Description |
|:---------|:------------|
| [docs/admin/email-notifications.md](../admin/email-notifications.md) | Email notification admin guide — SMTP setup, template reference, event catalogue |
| [docs/api/webhooks.md](../api/webhooks.md) | Webhook integration guide — registration, payload schema, signature verification, retry semantics |
| [docs/user-guide/notifications.md](../user-guide/notifications.md) | User guide — in-app notification center and preference settings |
| [docs/api/rest-api.md](../api/rest-api.md) | Public REST API reference — webhook-compatible document response shapes |
| [CHANGELOG.md](../../CHANGELOG.md) | Full changelog following Keep a Changelog format |
| [docs/releases/m5-analytics-reporting.md](m5-analytics-reporting.md) | M5 milestone release notes — analytics & reporting |
