# Document Retention & Purge Policy Admin Guide

DocFlow automatically purges old documents and audit log records according to configurable retention windows. This guide explains how to view and update those settings, what happens during each purge run, and how to align your configuration with common compliance requirements.

---

## Prerequisites

You must be logged in as a user with the `admin` role. All settings pages and API endpoints described here require the `admin:users` permission.

---

## Overview

DocFlow stores two categories of data subject to automatic retention:

| Category | Purge type | Default retention |
|:---------|:-----------|:------------------|
| **Documents** (status `approved` or `rejected`) | Soft-delete — sets `deletedAt` field | 365 days |
| **Audit log records** | Hard-delete — permanently removed from the database | 90 days |

A nightly cron job runs at **03:00 server time** and enforces both thresholds. After each run, the job writes a `system.purge_run` audit event recording how many documents were archived and how many audit log records were deleted.

> **Important:** Document purge is reversible in principle (the file and database row are not immediately destroyed — `deletedAt` is set). Audit log purge is **not reversible** — records are permanently deleted with no recovery path.

---

## Configuring Retention Settings

### Admin UI — `/admin/settings`

1. Navigate to **Admin → Settings**.
2. Locate the **Retention** section.
3. Update one or both fields:
   - **Document Retention (days)** — days after which completed documents are soft-deleted. Enter `0` to disable automatic document purging entirely.
   - **Audit Log Retention (days)** — days after which audit log records are permanently deleted. Minimum value: `1`.
4. Click **Save**.

Changes take effect on the **next nightly purge run** (03:00 server time). Each save generates a `system.config_changed` audit event, recording the old and new values and the actor who made the change.

### API

```bash
# Read current settings
GET /api/admin/settings
Authorization: Bearer <token>
```

**Response `200 OK`:**

```json
{
  "documentRetentionDays": 365,
  "auditLogRetentionDays": 90,
  "lastPurgeAt": "2026-03-16T03:00:00.000Z",
  "lastPurgeDocumentsArchived": 42,
  "lastPurgeLogsDeleted": 1204
}
```

```bash
# Update settings
PATCH /api/admin/settings
Authorization: Bearer <token>
Content-Type: application/json

{
  "documentRetentionDays": 730,
  "auditLogRetentionDays": 180
}
```

You may update one or both fields in a single request. The response mirrors the full settings object (same shape as `GET`).

**Validation rules:**

| Field | Constraint |
|:------|:-----------|
| `documentRetentionDays` | Non-negative integer (`0` = disabled) |
| `auditLogRetentionDays` | Positive integer (minimum `1`) |

**Error responses:**

| Status | Condition |
|:-------|:----------|
| `400 Bad Request` | Value is not a valid integer, or `auditLogRetentionDays < 1` |
| `401 Unauthorized` | Missing or invalid JWT |
| `403 Forbidden` | Caller lacks `admin:users` permission |

---

## What Gets Purged

### Document Purge (Soft-Delete)

The purge job selects documents that meet **all** of the following criteria:

- `routingStatus` is `approved` or `rejected`
- `createdAt` is older than `documentRetentionDays` days before the purge run time
- `deletedAt` is `null` (not already soft-deleted)

Matching documents have their `deletedAt` timestamp set to the purge run time. The database row and any associated files are **not** immediately removed — soft-deleted documents are excluded from normal queries but can be recovered by a database administrator if needed.

Setting `documentRetentionDays = 0` skips document purging entirely. Documents with status `pending`, `in_review`, or other active statuses are never purged regardless of age.

### Audit Log Purge (Hard-Delete)

The purge job permanently deletes all `AuditLog` rows where `createdAt` is older than `auditLogRetentionDays` days. There is **no recovery path** once audit log records are deleted.

Unlike document purge, audit log purge cannot be disabled — `auditLogRetentionDays` must be at least `1`.

### Purge Run Audit Event

After each run, a `system.purge_run` audit event is written with:

```json
{
  "action": "system.purge_run",
  "actorId": null,
  "metadata": {
    "documentsArchived": 42,
    "logsDeleted": 1204
  }
}
```

This event itself is subject to the `auditLogRetentionDays` window.

---

## Monitoring Purge Runs

The **Admin → Settings** page displays:

| Field | Description |
|:------|:------------|
| **Last purge** | Timestamp of the most recent purge run |
| **Documents archived** | Documents soft-deleted in the last run |
| **Logs deleted** | Audit log records hard-deleted in the last run |

These values are also available via `GET /api/admin/settings` as `lastPurgeAt`, `lastPurgeDocumentsArchived`, and `lastPurgeLogsDeleted`.

**If the last-purge timestamp is more than 25 hours old**, the nightly cron job may not be running. Check the backend server logs for `[PurgeJob]` entries and ensure the process did not crash overnight.

---

## Compliance Implications

### What is retained during the retention window

All documents and audit log records within their respective retention windows are fully accessible via the normal UI and API. No data is hidden or restricted by the retention system.

### What happens at the audit log boundary

When audit log records are hard-deleted, the associated history of who viewed, approved, or rejected a document is permanently gone. Before reducing `auditLogRetentionDays`, confirm that:

- Your organisation's compliance framework (SOC 2, ISO 27001, GDPR, HIPAA, etc.) does not require a longer minimum retention.
- Any pending regulatory audits or legal holds have been completed for documents in that time window.

### Config changes are themselves audited

Every change to retention settings produces a `system.config_changed` audit log entry. These entries are subject to the same `auditLogRetentionDays` window — if you need a permanent record of configuration history, export or archive these entries before they age out.

### Soft-deleted documents and compliance exports

Soft-deleted documents (`deletedAt` is set) are excluded from standard document listings and searches. If a compliance export or legal hold requires access to soft-deleted records, your database administrator can query the `Document` table directly, filtering on `deletedAt IS NOT NULL`.

---

## Example Policy Configurations

### Standard enterprise (recommended baseline)

```json
{
  "documentRetentionDays": 365,
  "auditLogRetentionDays": 90
}
```

Retains completed documents for one year and audit logs for a quarter. Suitable for most internal workflows without strict regulatory requirements.

---

### Extended regulatory retention (finance / healthcare)

```json
{
  "documentRetentionDays": 2555,
  "auditLogRetentionDays": 2555
}
```

Seven-year retention for both documents and audit logs. Common for organisations subject to financial record-keeping regulations (e.g. SOX, FINRA) or healthcare data rules (e.g. HIPAA).

---

### High-volume short-cycle (development / staging)

```json
{
  "documentRetentionDays": 30,
  "auditLogRetentionDays": 14
}
```

Aggressive purge schedule for non-production environments where storage costs matter and compliance requirements do not apply. Do **not** use in production.

---

### Disable document purging, keep audit logs 180 days

```json
{
  "documentRetentionDays": 0,
  "auditLogRetentionDays": 180
}
```

Useful when documents are managed externally (e.g. archived to S3 by a custom process) and DocFlow should not auto-purge them, but audit logs should still roll over on a 6-month cycle.

---

## Warnings and Best Practices

> **Audit log hard-delete is irreversible.** Reducing `auditLogRetentionDays` on a production system immediately exposes older records to deletion at the next 03:00 run. Export any compliance-critical records before making this change.

> **Test in staging first.** Before adjusting retention windows in production, apply the change in a staging environment and verify the purge run output via the settings page or `system.purge_run` audit events.

> **Coordinate with legal and compliance teams.** Retention windows are often governed by external requirements. Changing them without sign-off may create legal exposure.

> **`documentRetentionDays = 0` does not protect documents indefinitely.** It disables the automatic purge job only. Manual deletes via the API or database administration are still possible.

> **Active documents are never purged.** Only documents with `routingStatus` of `approved` or `rejected` are eligible. Documents still in review or pending approval are not affected regardless of age.

> **Purge runs once per day.** A newly lowered retention threshold takes effect at the next 03:00 run, not immediately. If you need an immediate purge (e.g. GDPR erasure request), a platform operator must trigger the purge job manually.

---

## API Reference

All endpoints require `Authorization: Bearer <token>` with a user holding `admin:users` permission.

| Endpoint | Description |
|:---------|:------------|
| `GET /api/admin/settings` | Read current retention settings and last-purge stats |
| `PATCH /api/admin/settings` | Update `documentRetentionDays` and/or `auditLogRetentionDays` |

---

## Related Documentation

- [Analytics & Reporting Admin Guide](analytics-reporting.md) — includes the settings UI location and last-purge display
- [Audit Log Admin Guide](audit-logs.md) — understanding `system.purge_run` and `system.config_changed` events
- [Deployment Guide](../ops/deployment.md) — server environment and cron job monitoring
