# DocFlow — Admin Guide

This guide covers the administrative tasks available to users with the `admin` role: user management, routing rules, the audit log, and platform settings.

## Prerequisites

You must be logged in as a user with the built-in `admin` role (superadmin). The `admin` role bypasses all permission checks and grants unrestricted access to all features and API endpoints.

---

## 1. User Management

User and role management is administered via the REST API. A dedicated admin UI (`/admin/users` and `/admin/roles`) is planned for a future release.

### Listing users

```bash
curl -H "Authorization: Bearer <your-token>" \
  http://localhost:3000/api/admin/users
```

Returns an array of users with fields: `id`, `email`, `role`, `roleId`, `createdAt`.

### Inviting users

New users register at `POST /api/auth/register` with an email and password. After registration, assign the appropriate role (see below). There is no invite-by-email flow yet — share the registration URL and credentials policy with new users directly.

### Assigning roles to users

First, find the available role IDs:

```bash
curl -H "Authorization: Bearer <your-token>" \
  http://localhost:3000/api/admin/roles
```

Then assign a role:

```bash
curl -X PATCH \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"roleId": "<roleId>"}' \
  http://localhost:3000/api/admin/users/<userId>/role
```

### Built-in roles

| Role | Description | Key permissions |
|:-----|:------------|:----------------|
| `admin` | Full access (superadmin) | All — bypasses permission checks entirely |
| `approver` | Review and approve documents | `documents:read`, `documents:approve` |
| `submitter` | Upload and submit documents | `documents:read`, `documents:write` |
| `viewer` | Read-only access | `documents:read` |

These roles are seeded by running `npm run db:seed` in the `backend/` directory.

> **New users with no role:** Any user account created before RBAC was introduced (no `roleId` set) is automatically assigned the `submitter` role during seeding.

### Creating custom roles

```bash
curl -X POST \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "finance-approver",
    "description": "Can approve finance department documents",
    "permissionIds": ["<documents:read-id>", "<documents:approve-id>"]
  }' \
  http://localhost:3000/api/admin/roles
```

### Permission reference

| Permission key | What it protects |
|:--------------|:----------------|
| `documents:read` | View and download documents |
| `documents:write` | Upload and create new documents |
| `documents:approve` | Approve, reject, or request changes in workflows |
| `admin:users` | View user list; change role assignments |
| `admin:roles` | View, create, and edit roles |

For full RBAC documentation, see [docs/admin/rbac.md](../admin/rbac.md).

---

## 2. Routing Rules

Routing rules determine which approval queue a document is sent to after processing completes. Rules are matched by document type, department tag, or both.

### Accessing the routing rules page

Navigate to **Routing Rules** in the left sidebar (visible only to `admin` users), or go directly to `/admin/routing-rules`.

### How matching works

When a document finishes processing, DocFlow evaluates active routing rules in **priority order** (lowest number = highest priority). The first rule whose conditions match the document's metadata wins.

Match conditions:

| Field | Description |
|:------|:------------|
| `documentType` | Matches documents where the extracted `documentType` equals this value. Leave blank to match any type. |
| `departmentTag` | Matches documents tagged with this department. Leave blank to match any department. |

If a rule specifies both `documentType` and `departmentTag`, both must match.

### Rule fields

| Field | Required | Description |
|:------|:---------|:------------|
| `name` | Yes | Human-readable label for the rule |
| `documentType` | No | Document type to match (e.g. `invoice`, `contract`) |
| `departmentTag` | No | Department tag to match (e.g. `finance`, `legal`) |
| `priority` | Yes | Integer; lower value = higher priority |
| `targetQueue` | Yes | Name of the approval queue to route matching documents to |
| `isActive` | — | Whether the rule is active (defaults to `true`; set to `false` to disable) |

### Creating a routing rule (UI)

1. Go to `/admin/routing-rules`.
2. Fill in the **Name**, **Document Type** (optional), **Department Tag** (optional), **Priority**, and **Target Queue** fields.
3. Click **Add Rule**.

### Creating a routing rule (API)

```bash
curl -X POST \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Finance invoices",
    "documentType": "invoice",
    "departmentTag": "finance",
    "priority": 10,
    "targetQueue": "finance-approvals"
  }' \
  http://localhost:3000/api/routing-rules
```

### Editing a routing rule (API)

```bash
curl -X PATCH \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"priority": 5}' \
  http://localhost:3000/api/routing-rules/<ruleId>
```

### Disabling a routing rule

Setting `isActive` to `false` deactivates the rule without deleting it:

```bash
curl -X PATCH \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false}' \
  http://localhost:3000/api/routing-rules/<ruleId>
```

> **Note:** Deleting a rule via `DELETE /api/routing-rules/:id` performs a soft delete (sets `isActive: false`). Rules are never hard-deleted.

---

## 3. Audit Log

The audit log records every security-relevant and compliance-relevant event on the platform.

> **Status:** The audit log UI (`/admin/audit-logs`) and `GET /api/admin/audit-logs` API endpoint are in development (DOCA-36). The section below describes the intended behaviour when that work ships.

### Events recorded

**Authentication**

| Event | Description |
|:------|:------------|
| `user.login` | Successful login (local, LDAP, or SSO) |
| `user.login_failed` | Failed authentication attempt |
| `user.logout` | Explicit sign-out |

**Administration**

| Event | Description |
|:------|:------------|
| `user.created` | New user registered |
| `user.role_changed` | Admin changed a user's role |

**Documents**

| Event | Description |
|:------|:------------|
| `document.uploaded` | Document uploaded |
| `document.viewed` | Document viewed or downloaded |
| `document.approved` | Step approved in a workflow |
| `document.rejected` | Document rejected in a workflow |
| `document.changes_requested` | Changes requested at a workflow step |

### Accessing audit logs (API)

Requires the `admin:audit` permission (included in the built-in `admin` role).

```bash
# All approval decisions in March 2026
curl -H "Authorization: Bearer <your-token>" \
  "http://localhost:3000/api/admin/audit-logs?action=document.approved&from=2026-03-01&to=2026-03-31"
```

**Filter parameters**

| Parameter | Description |
|:----------|:------------|
| `action` | Filter by event type (e.g. `document.approved`) |
| `actorId` | Filter by user ID |
| `actorEmail` | Filter by user email |
| `resourceId` | Filter by document or user ID |
| `resourceType` | `user` or `document` |
| `from` | Start date (ISO 8601) |
| `to` | End date (ISO 8601) |
| `page` | Page number (default: 1) |
| `pageSize` | Results per page, max 200 (default: 50) |

See [docs/admin/audit-logs.md](../admin/audit-logs.md) for the full reference including common compliance queries.

### Log retention

Audit log records are automatically purged by the nightly retention job according to the `auditLogRetentionDays` setting (default: 90 days). See [Section 6 — Settings: Retention Policy](#6-settings--retention-policy) for how to configure this. For the full reference including compliance queries, see [docs/admin/audit-logs.md](../admin/audit-logs.md).

---

## 4. Authentication Configuration

DocFlow supports three authentication modes. Switching modes is a configuration change — not a UI action.

| Mode | What users see | How to configure |
|:-----|:--------------|:----------------|
| `local` | Email + password form | Default; no extra config needed |
| `ldap` | Email + password form (authenticates against LDAP) | Set `LDAP_URL` and related vars in `backend/.env`; set `VITE_AUTH_MODE=ldap` in `frontend/.env` |
| `sso` | "Sign in with SSO" button | Set `SSO_PROVIDER` (and related vars) in `backend/.env`; set `VITE_AUTH_MODE=sso` in `frontend/.env` |

Detailed setup instructions:

- [docs/admin/ldap.md](../admin/ldap.md) — LDAP/Active Directory integration
- [docs/admin/sso.md](../admin/sso.md) — SAML 2.0 / OIDC SSO
- [docs/admin/auth-modes.md](../admin/auth-modes.md) — mode reference and security considerations

---

## 5. Analytics Dashboard

Navigate to **Admin → Analytics** (`/admin/analytics`) to open the analytics dashboard. The dashboard is restricted to users with the `admin` role.

### Summary cards

Five at-a-glance metrics appear at the top: **Submitted**, **Approved**, **Rejected**, **Rejection Rate**, and **Avg Approval Time** — all calculated across the selected date range.

### Charts

Three chart panels show workflow performance over the selected date range:

| Panel | What it shows |
|:------|:-------------|
| **Processing Volume** | Daily document counts — submitted, approved, and rejected |
| **Approval Time** | Average days-to-approval per day; rising trends indicate reviewer overload |
| **Rejection Rate** | Daily rejection rate as a percentage of all decisions |

**Date range controls:** Use the preset buttons (**7d**, **30d**, **90d**) or the custom date picker to change the reporting window. All panels update simultaneously.

### Bottleneck Detection

The **Bottlenecks** section below the charts shows routing queues and individual approvers whose average processing time exceeds the configured threshold (default: 48 hours). Rows between 1× and 2× the threshold are highlighted **amber**; rows exceeding **2× the threshold** are highlighted **red**. When no bottlenecks are detected, the section displays a confirmation message.

### Exporting Data

Two export buttons appear at the top of the analytics page:

| Format | Button | Use case |
|:-------|:-------|:---------|
| **CSV** | Export CSV | Spreadsheet analysis; filename `docflow-report-{from}-{to}.csv` |
| **PDF** | Export PDF | Compliance reporting; filename `docflow-report-{from}-{to}.pdf` |

Both exports respect the selected date range. A loading spinner is shown while the file is generated.

For the full analytics reference including API endpoints and chart interpretation guidance, see [docs/admin/analytics-reporting.md](../admin/analytics-reporting.md).

---

## 6. Settings — Retention Policy

Navigate to **Admin → Settings** (`/admin/settings`) to configure how long documents and audit logs are retained before automatic purging.

### Retention settings

| Setting | Default | Description |
|:--------|:--------|:------------|
| **Document Retention (days)** | 365 | Days after which completed (`approved` or `rejected`) documents are soft-deleted. Set to `0` to disable automatic document purging. |
| **Audit Log Retention (days)** | 90 | Days after which audit log records are permanently deleted. Minimum value: `1`. |

To update: enter new values in the **Retention** section and click **Save**. Changes take effect on the next nightly purge run (03:00 server time).

### Monitoring purge runs

The settings page shows:

- **Last purge** — timestamp of the most recent purge run
- **Documents archived** — documents soft-deleted in the last run
- **Logs deleted** — audit log records deleted in the last run

If the last-purge timestamp is more than 25 hours old, the nightly cron job may not be running — check the server logs.

> **Warning:** Reducing `auditLogRetentionDays` on a production system will delete older audit records permanently at the next 03:00 run. Confirm your compliance requirements before lowering this value.

For the full reference including compliance implications and example policy configurations, see [docs/admin/retention-purge.md](../admin/retention-purge.md).
