# M5 Release Notes — Analytics & Reporting

**Release:** Milestone 5
**Date:** March 2026
**Audience:** IT administrators, DevOps engineers, compliance officers

---

## Overview

Milestone 5 delivers the Analytics & Reporting layer for DocFlow Platform. This release gives administrators real-time visibility into document workflow performance: processing volumes, approval cycle times, rejection rates, bottleneck identification, and flexible data export for compliance reporting. It also introduces configurable retention and purge policies so organisations can meet data governance requirements without manual intervention.

---

## New Features

### Analytics Dashboard — `/admin/analytics`

A new admin-only dashboard provides an at-a-glance view of workflow health through three chart panels and a bottleneck detection section.

**Charts and date range controls:**
- **Processing Volume** — Daily submitted, approved, and rejected document counts plotted over the selected period. Useful for capacity planning and identifying processing backlogs.
- **Approval Time** — Average days-to-approval per day over the selected range. Rising trends indicate reviewer overload or queue congestion.
- **Rejection Rate** — Daily rejection rate as a percentage of all decisions. Sustained high rates warrant investigation into submission quality or routing rules.

**Date range controls:**
- Preset buttons: **7d**, **30d** (default), **90d**
- Custom date picker for arbitrary start and end dates
- All three chart panels refresh simultaneously when the date range changes

**Navigation:** Admin sidebar → Analytics (visible to `admin` role only)

See [docs/admin/analytics-reporting.md](../admin/analytics-reporting.md) for full chart interpretation guidance.

---

### Bottleneck Detection

A **Bottlenecks** section below the charts highlights queues and individual approvers whose average processing time significantly exceeds the platform threshold.

- **Slow Queues table** — routing queues ranked by average document wait time, with document count for the period
- **Slow Approvers table** — individual approvers ranked by average response time, with document count for the period
- Rows where wait time exceeds **2× threshold** are highlighted in amber/red for immediate attention
- Empty state shown when no bottlenecks are detected in the period

**Threshold configuration:** Set via the `ANALYTICS_BOTTLENECK_THRESHOLD_HOURS` environment variable (default: **48 hours**). Restart the server after changing.

---

### Data Export — CSV and PDF

Admins can export analytics data directly from the `/admin/analytics` dashboard.

| Export | Button | Filename |
|:-------|:-------|:---------|
| CSV (spreadsheet) | **Export CSV** | `docflow-report-{from}-{to}.csv` |
| PDF (compliance report) | **Export PDF** | `docflow-report-{from}-{to}.pdf` |

Both exports respect the currently selected date range. A loading spinner is shown while the file is generated.

**CSV columns:** Date, Submitted, Approved, Rejected, AvgApprovalDays, RejectionRate%

**PDF contents:** Report title, date range, summary statistics table, and tabular metric data. PDF uses a table layout rather than embedded chart graphics — intentional for compliance use cases where reproducible text-based data is preferred.

**API access (direct):**
```
GET /api/admin/analytics/export?format=csv&from=YYYY-MM-DD&to=YYYY-MM-DD
GET /api/admin/analytics/export?format=pdf&from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer <token>
```

Requires `admin:users` permission.

---

### Data Retention & Purge Policy — `/admin/settings`

A new settings page at `/admin/settings` lets administrators configure retention thresholds and monitor the nightly purge job.

**Configurable settings:**

| Setting | Default | Description |
|:--------|:--------|:------------|
| `documentRetentionDays` | 365 days | Days after which completed (`done` or `rejected`) documents are soft-deleted. Set to `0` to disable. |
| `auditLogRetentionDays` | 90 days | Days after which audit log records are **permanently deleted**. |

> **Warning:** `auditLogRetentionDays` is a hard delete. Ensure this value meets your organisation's compliance requirements before reducing it.

**Last-purge display:** The settings page shows the last purge timestamp, documents archived, and audit log records deleted — confirming the nightly job is operating correctly.

**Purge schedule:**
- Aggregation job: **02:00 server time** — computes daily analytics metrics from raw `AuditLog` and `Document` data
- Purge job: **03:00 server time** — applies retention policies to documents and audit logs

Changing retention settings creates a `system.config_changed` audit event for traceability.

---

## Known Limitations

The following items are out of scope for M5 and will be addressed in a future milestone:

- **Physical file purge** — the nightly purge job soft-deletes document records but does not remove the underlying stored files from disk. File cleanup must be performed manually for now.
- **Dashboard charts** (DOCA-44) — the `/admin/analytics` dashboard frontend is in development. The backend analytics API endpoints (`/api/admin/analytics/*`) are fully implemented and can be queried directly.
- **Bottleneck detection UI** (DOCA-45) — the bottleneck UI panel is in development. The `GET /api/admin/analytics/bottlenecks` endpoint is available for direct API use.
- **Export UI buttons** (DOCA-46) — the export buttons are in development. Export endpoints (`/api/admin/analytics/export?format=csv|pdf`) are operational.
- **Retention settings UI** (DOCA-47) — the `/admin/settings` frontend is in development. Retention values can be read and updated via `GET /api/admin/settings` and `PATCH /api/admin/settings`.
- **Dashboard data is nightly** — analytics reflect data up to the end of the previous day; today's activity appears after the 02:00 aggregation run.

---

## Upgrade Notes

### Database migration

Run the Prisma migration after upgrading to add the analytics metric tables (`DocumentMetric`, `ApproverMetric`, `QueueMetric`) and the `SystemConfig` table for retention settings:

```bash
npm run db:migrate
```

No data loss occurs — the new tables are additive. Analytics data will begin accumulating from the first nightly aggregation run after upgrade.

### Seed default retention settings

Run the database seed to populate default retention configuration:

```bash
npm run db:seed
```

This sets `documentRetentionDays: 365` and `auditLogRetentionDays: 90`. Values can be changed at `/admin/settings` after seeding.

### Environment variable

Set the bottleneck threshold if the default (48h) is not appropriate for your workflows:

```env
ANALYTICS_BOTTLENECK_THRESHOLD_HOURS=48   # default
```

This variable is optional. If unset, the server defaults to 48 hours.

---

## Analytics API Endpoints

All analytics endpoints require `Authorization: Bearer <token>` with `admin:users` permission.

| Endpoint | Description |
|:---------|:------------|
| `GET /api/admin/analytics/volume?from=&to=` | Daily submitted/approved/rejected counts |
| `GET /api/admin/analytics/approval-time?from=&to=` | Average days-to-approval per day |
| `GET /api/admin/analytics/rejection-rate?from=&to=` | Daily rejection rate |
| `GET /api/admin/analytics/bottlenecks?from=&to=` | Slow queues and slow approvers |
| `GET /api/admin/analytics/export?format=csv&from=&to=` | CSV export download |
| `GET /api/admin/analytics/export?format=pdf&from=&to=` | PDF export download |
| `GET /api/admin/settings` | Read current retention settings |
| `PATCH /api/admin/settings` | Update retention settings |

Date parameters use ISO 8601 format: `YYYY-MM-DD`.

---

## Related Documentation

| Document | Description |
|:---------|:------------|
| [docs/admin/analytics-reporting.md](../admin/analytics-reporting.md) | Analytics & Reporting admin guide — dashboard, bottleneck detection, data export, and retention settings |
| [docs/admin/audit-logs.md](../admin/audit-logs.md) | Audit log admin guide — events captured, access, and compliance reporting |
| [docs/ops/deployment.md](../ops/deployment.md) | Production deployment guide — environment variables including `ANALYTICS_BOTTLENECK_THRESHOLD_HOURS` |
| [CHANGELOG.md](../../CHANGELOG.md) | Full changelog following Keep a Changelog format |
| [docs/releases/m4-release-notes.md](m4-release-notes.md) | M4 milestone release notes — enterprise features |
