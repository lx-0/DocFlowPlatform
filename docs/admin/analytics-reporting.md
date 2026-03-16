# Analytics & Reporting Admin Guide

The Analytics & Reporting features give DocFlow administrators visibility into document workflow performance — how many documents are being processed, how long approvals take, where bottlenecks form, and how to export data for compliance reporting.

> **M5 status:** Report export (`/api/admin/analytics/export`), retention policy settings (`/admin/settings`), and the `/admin/analytics` dashboard (volume, approval time, and rejection rate charts) are live. Bottleneck detection is in progress.

---

## Prerequisites

You must be logged in as a user with the `admin` role. All analytics pages and API endpoints require the `admin:users` permission.

---

## Analytics Dashboard — `/admin/analytics`

Navigate to **Admin → Analytics** in the sidebar to open the dashboard. The dashboard presents three chart panels and a bottleneck detection section.

### Date Range Controls

All charts respect the selected date range. You can choose:

| Control | Description |
|:--------|:------------|
| **7d** | Last 7 days |
| **30d** | Last 30 days (default) |
| **90d** | Last 90 days |
| **Custom** | Pick a specific start and end date using the date picker |

Changing the date range reloads all panels simultaneously.

---

### Volume Chart

**What it shows:** Daily document counts — how many documents were submitted, approved, and rejected on each day within the selected range.

**How to read it:**
- Each day is shown as a bar or line with three values: Submitted, Approved, Rejected.
- A rising Submitted count indicates increasing workflow load.
- A widening gap between Submitted and Approved may indicate a processing backlog.
- Spikes in Rejected can indicate upstream quality issues or policy changes.

**Underlying data:** Sourced from the `DocumentMetric` table, populated nightly by the aggregation job.

---

### Approval Time Chart

**What it shows:** Average time (in days) from document submission to approval decision, plotted per day.

**How to read it:**
- A flat, low line indicates consistent, efficient review cycles.
- Rising average approval time is an early warning sign of reviewer overload or queue congestion.
- Dips may correspond to days with fewer complex documents or additional reviewer capacity.

**Underlying data:** Sourced from `DocumentMetric.processingTimeMs`, averaged per day.

---

### Rejection Rate Chart

**What it shows:** Daily rejection rate as a percentage of all decisions (approved + rejected).

**How to read it:**
- A stable rejection rate suggests consistent document quality and reviewer criteria.
- A sudden spike may indicate a policy change, a batch of non-compliant submissions, or a misconfigured routing rule.
- A sustained high rate (above ~20%) warrants investigation into submission quality or approval criteria clarity.

**Underlying data:** Derived from daily `DocumentMetric` approved/rejected counts.

---

## Bottleneck Detection

The **Bottlenecks** section appears below the three charts. It highlights queues and individual approvers whose average processing time significantly exceeds the platform threshold.

### Slow Queues Table

Lists routing queues where documents wait longer than the configured bottleneck threshold.

| Column | Description |
|:-------|:------------|
| Queue Name | The routing queue identifier |
| Avg Wait Time | Average time a document waits in this queue (formatted as "Xd Yh") |
| Documents | Number of documents routed through this queue in the selected period |

### Slow Approvers Table

Lists individual approvers whose average response time exceeds the threshold.

| Column | Description |
|:-------|:------------|
| Approver | User display name |
| Avg Wait Time | Average time between assignment and decision (formatted as "Xd Yh") |
| Documents | Number of documents assigned to this approver in the selected period |

### Threshold and Highlighting

The threshold is displayed above the tables (e.g., "Showing queues/approvers exceeding 48h avg wait").

- Rows where avg wait exceeds **1× threshold**: shown normally.
- Rows where avg wait exceeds **2× threshold**: highlighted in **amber/red** for immediate attention.
- If no queues or approvers exceed the threshold: the section shows "No bottlenecks detected in this period 🎉"

**Configuring the threshold:** The threshold is set via the `ANALYTICS_BOTTLENECK_THRESHOLD_HOURS` environment variable on the backend server. The default is **48 hours**. Restart the server after changing this value.

```
ANALYTICS_BOTTLENECK_THRESHOLD_HOURS=72   # Example: raise to 72h
```

**Underlying data:** Sourced from nightly `QueueMetric` and `ApproverMetric` rollup tables.

---

## Exporting Analytics Data

The dashboard provides two export options: **Export CSV** and **Export PDF**. Both buttons appear at the top of the `/admin/analytics` page and respect the currently selected date range. A loading spinner is shown while the file is being generated.

### CSV Export

Downloads a spreadsheet-compatible file containing daily aggregated metrics.

**Button:** "Export CSV"

**Filename format:** `docflow-report-{from}-{to}.csv`
Example: `docflow-report-2026-01-01-2026-03-31.csv`

**Columns:**

| Column | Description |
|:-------|:------------|
| Date | Calendar date (YYYY-MM-DD) |
| Submitted | Documents submitted that day |
| Approved | Documents approved that day |
| Rejected | Documents rejected that day |
| AvgApprovalDays | Average days-to-approval for that day |
| RejectionRate% | Rejection rate as a percentage |

**API endpoint (direct access):**

```
GET /api/admin/analytics/export?format=csv&from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer <token>
```

The response has `Content-Disposition: attachment` so browsers download the file directly.

---

### PDF Export

Downloads a formatted PDF report suitable for compliance submissions or executive review.

**Button:** "Export PDF"

**Filename format:** `docflow-report-{from}-{to}.pdf`
Example: `docflow-report-2026-01-01-2026-03-31.pdf`

**PDF contents:**
- Report title and date range
- Summary statistics table (totals for the period)
- Tabular representation of volume, approval time, and rejection rate data

> **Note:** The PDF uses a table layout rather than embedded chart graphics. This is intentional for compliance use cases where reproducible, text-based data is preferred.

**API endpoint (direct access):**

```
GET /api/admin/analytics/export?format=pdf&from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer <token>
```

---

## Data Retention & Purge Settings — `/admin/settings`

Navigate to **Admin → Settings** to configure how long the platform retains document records and audit logs before automatic purging.

### Retention Settings

| Setting | Default | Description |
|:--------|:--------|:------------|
| `documentRetentionDays` | 365 days | Days after which completed (`done` or `rejected`) documents are soft-deleted. Set to `0` to disable automatic document purging. |
| `auditLogRetentionDays` | 90 days | Days after which audit log records are hard-deleted. |

> **Warning:** `auditLogRetentionDays` controls a **hard delete** — audit log records older than this value are permanently removed from the database with no recovery path. Ensure this value meets your organisation's compliance requirements before reducing it.

### Configuring Retention Values

1. Open `/admin/settings`.
2. Enter new values in the **Document Retention (days)** and **Audit Log Retention (days)** fields.
3. Click **Save**.

Changes take effect on the next nightly purge run. Changing a retention setting creates an audit log entry (`system.config_changed`) for traceability.

### Last-Purge Display

The settings page shows when the purge job last ran and how many records were processed:

- **Last purge:** Timestamp of the most recent purge run.
- **Documents archived:** Number of documents soft-deleted in the last run.
- **Logs deleted:** Number of audit log records hard-deleted in the last run.

This information helps verify the purge job is operating correctly. If the last-purge timestamp is more than 25 hours ago, the nightly cron job (03:00 server time) may not be running — check the server logs.

---

## How Analytics Data Is Collected

DocFlow uses a nightly aggregation pipeline to compute analytics metrics:

| Job | Schedule | What it does |
|:----|:---------|:-------------|
| **Analytics aggregation** | 02:00 server time | Reads raw `AuditLog` and `Document` records from the past 24h; upserts daily aggregated rows into `DocumentMetric`, `ApproverMetric`, and `QueueMetric` tables. |
| **Retention purge** | 03:00 server time | Soft-deletes documents and hard-deletes audit log records older than the configured retention thresholds. |

> **Note:** Because data is aggregated nightly, the analytics dashboard reflects data up to the end of the previous day. Activity from today will appear after the 02:00 job runs.

If you need the aggregation backfilled (e.g. after a fresh install), contact your platform operator to trigger the job manually.

---

## API Endpoints Reference

All analytics endpoints require `Authorization: Bearer <token>` with a user holding `admin:users` permission.

| Endpoint | Description |
|:---------|:------------|
| `GET /api/admin/analytics/volume?from=&to=` | Daily submitted/approved/rejected counts |
| `GET /api/admin/analytics/approval-time?from=&to=` | Average days-to-approval per day |
| `GET /api/admin/analytics/rejection-rate?from=&to=` | Daily rejection rate as a percentage |
| `GET /api/admin/analytics/bottlenecks?from=&to=` | Combined slow queues and slow approvers |
| `GET /api/admin/analytics/export?format=csv&from=&to=` | Download CSV export |
| `GET /api/admin/analytics/export?format=pdf&from=&to=` | Download PDF export |
| `GET /api/admin/settings` | Read current retention settings |
| `PATCH /api/admin/settings` | Update retention settings |

Date parameters use ISO 8601 format: `YYYY-MM-DD`.

---

## Related Documentation

- [Retention & Purge Policy Admin Guide](retention-purge.md) — full guide to configuring retention windows, purge behaviour, and compliance implications
- [Audit Log Admin Guide](audit-logs.md) — audit events generated by system purge and config changes
- [RBAC Admin Guide](rbac.md) — managing the `admin:users` permission
- [Deployment Guide](../ops/deployment.md) — setting environment variables such as `ANALYTICS_BOTTLENECK_THRESHOLD_HOURS`
