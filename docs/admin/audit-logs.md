# Audit Log Admin Guide

The audit log records security-relevant and compliance-relevant events across the DocFlow Platform. This guide covers what events are captured, how to access them, and how to use them for compliance reporting.

> **Note:** The audit log service is being implemented as part of DOCA-36. The `/admin/audit-logs` UI page and `GET /api/admin/audit-logs` API endpoint will be available when that work ships. This document describes the intended behaviour.

---

## What Events Are Recorded

Every audit event captures a timestamp, the actor who triggered it, the action taken, and any relevant resource identifier.

### Authentication Events

| Action | Description |
|:-------|:------------|
| `user.login` | A user successfully authenticated (local, LDAP, or SSO) |
| `user.login_failed` | An authentication attempt failed — wrong credentials or unknown user |
| `user.logout` | A user explicitly ended their session |

### Administration Events

| Action | Description |
|:-------|:------------|
| `user.role_changed` | An admin changed a user's role assignment |
| `user.created` | A new user account was registered |

### Document Events

| Action | Description |
|:-------|:------------|
| `document.viewed` | A user viewed or downloaded a document |
| `document.uploaded` | A document was uploaded to the platform |
| `document.approved` | An approver approved a document at a workflow step |
| `document.rejected` | An approver rejected a document at a workflow step |
| `document.changes_requested` | An approver requested changes on a document |

### Audit Log Entry Shape

Each entry in the log contains:

| Field | Type | Description |
|:------|:-----|:------------|
| `id` | UUID | Unique identifier for this log entry |
| `action` | string | Event type (e.g. `user.login`, `document.approved`) |
| `actorId` | UUID \| null | ID of the user who triggered the event (`null` for system events) |
| `actorEmail` | string \| null | Email of the actor at the time of the event |
| `resourceType` | string \| null | Type of the resource affected (e.g. `user`, `document`) |
| `resourceId` | UUID \| null | ID of the affected resource |
| `metadata` | object | Additional context (role name, document title, IP address, etc.) |
| `createdAt` | ISO 8601 | When the event occurred |

---

## Accessing Audit Logs

### Admin UI — `/admin/audit-logs`

The audit log page (available once DOCA-36 ships) provides a searchable, filterable table of all recorded events.

**Filters available:**

| Filter | Description |
|:-------|:------------|
| Actor | Filter by user email or ID |
| Action | Filter by event type (e.g. show only `document.approved`) |
| From date | Include only events on or after this date |
| To date | Include only events on or before this date |

Results are returned in reverse-chronological order (newest first).

### API — `GET /api/admin/audit-logs`

See the [API reference](#api-reference) section below for full endpoint documentation.

---

## Compliance Use Cases

### Who approved a document and when?

Filter by `action=document.approved` and the document ID. Each entry records the approver's email and the exact timestamp.

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/admin/audit-logs?action=document.approved&resourceId=<documentId>"
```

### Who viewed a sensitive document?

Filter by `action=document.viewed` and the document ID to produce a complete access log.

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/admin/audit-logs?action=document.viewed&resourceId=<documentId>"
```

### Investigate a failed login burst (potential account takeover)

Filter by `action=user.login_failed` and a specific actor email to see how many failed attempts occurred and from where.

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/admin/audit-logs?action=user.login_failed&actorEmail=alice%40example.com"
```

### Role change history for a user

Filter by `action=user.role_changed` and `resourceId=<userId>` to see every role change and who performed it.

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/admin/audit-logs?action=user.role_changed&resourceId=<userId>"
```

---

## API Reference

### `GET /api/admin/audit-logs`

Requires authentication and the `admin:audit` permission (included in the built-in `admin` role).

**Query parameters**

| Parameter | Type | Description |
|:----------|:-----|:------------|
| `action` | string | Filter by event type (exact match, e.g. `document.approved`) |
| `actorId` | UUID | Filter by actor user ID |
| `actorEmail` | string | Filter by actor email (URL-encoded) |
| `resourceId` | UUID | Filter by affected resource ID |
| `resourceType` | string | Filter by resource type (`user`, `document`) |
| `from` | ISO 8601 date | Include events on or after this timestamp |
| `to` | ISO 8601 date | Include events on or before this timestamp |
| `page` | integer | Page number, 1-indexed (default: `1`) |
| `pageSize` | integer | Results per page, max 200 (default: `50`) |

**Example request**

```bash
# All document approvals in March 2026
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/admin/audit-logs?action=document.approved&from=2026-03-01&to=2026-03-31"
```

**Response `200 OK`**

```json
{
  "total": 2,
  "page": 1,
  "pageSize": 50,
  "entries": [
    {
      "id": "a1b2c3d4-...",
      "action": "document.approved",
      "actorId": "e5f6a7b8-...",
      "actorEmail": "carol@example.com",
      "resourceType": "document",
      "resourceId": "09ab1cd2-...",
      "metadata": {
        "documentTitle": "Q1 Expense Report",
        "workflowStep": 2,
        "queueName": "finance-approvals"
      },
      "createdAt": "2026-03-15T14:32:01.000Z"
    },
    {
      "id": "b2c3d4e5-...",
      "action": "document.approved",
      "actorId": "f7a8b9c0-...",
      "actorEmail": "dave@example.com",
      "resourceType": "document",
      "resourceId": "09ab1cd2-...",
      "metadata": {
        "documentTitle": "Q1 Expense Report",
        "workflowStep": 1,
        "queueName": "finance-approvals"
      },
      "createdAt": "2026-03-14T09:11:44.000Z"
    }
  ]
}
```

**Error responses**

| Status | Condition |
|:-------|:----------|
| `401 Unauthorized` | Missing or invalid JWT |
| `403 Forbidden` | Authenticated user lacks `admin:audit` permission |
| `400 Bad Request` | Invalid query parameter (e.g. bad date format) |

---

## Log Retention Policy

Audit log retention is configured via **Admin → Settings** (`auditLogRetentionDays`, default 90 days). The nightly purge job (03:00 server time) permanently hard-deletes records older than this threshold. This deletion is irreversible — ensure the window meets your compliance requirements before reducing it.

See the [Retention & Purge Policy Admin Guide](retention-purge.md) for full configuration details, compliance guidance, and example policies.
