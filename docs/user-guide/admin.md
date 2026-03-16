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

Audit events currently accumulate indefinitely. Monitor the `audit_logs` table size in PostgreSQL for high-traffic deployments and plan a retention strategy accordingly.

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

The Dashboard (`/dashboard`) shows summary statistics: document count, pending approvals, and completed items.

> **Status:** Live stat queries are planned for a future milestone. The current dashboard shows placeholder values (`—`).

---

## 6. Settings — Retention Policy

Document and audit log retention configuration is planned for a future release. There is currently no automated pruning. All uploaded files and audit events are stored indefinitely.

For urgent data removal needs, contact your database administrator to remove records directly from PostgreSQL.
