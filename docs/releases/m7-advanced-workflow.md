# M7 Release Notes — Advanced Workflow & Automation

**Release:** Milestone 7
**Date:** 2026-03-17
**Audience:** Document administrators, approvers, integration developers

---

## Overview

Milestone 7 delivers the Advanced Workflow & Automation layer for DocFlow Platform. This release makes approval workflows more resilient and self-managing: overdue approvals escalate automatically, approvers can delegate authority during absences, and document history is now fully versioned. Administrators gain bulk operation capabilities that dramatically reduce the time needed to process high-volume queues. Conditional routing closes the gap between flat assignment rules and real-world routing logic by letting metadata fields drive queue selection.

---

## New Features

### Conditional Routing (DOCA-63)

Routing rules can now evaluate document metadata conditions to determine which approval queue receives a document at submission time. This replaces the previous flat assignment model with a flexible, metadata-driven routing engine.

- **Condition syntax** — rules specify a field name, operator (e.g. `equals`, `contains`, `gt`, `lt`), and value. Multiple conditions on a single rule are combined with `AND` logic.
- **Rule priority** — rules are evaluated in priority order; the first matching rule wins. A catch-all rule with no conditions can serve as the default queue.
- **Admin UI** — routing rules are managed at `/admin/routing-rules`. The editor exposes the full condition builder and a priority drag-to-reorder interface.
- **API endpoints:** `POST /api/routing-rules`, `GET /api/routing-rules`, `PUT /api/routing-rules/:id`, `DELETE /api/routing-rules/:id`.

---

### Approval Escalation (DOCA-64)

Approvals that exceed a configurable deadline are automatically escalated to a backup approver, preventing workflows from stalling when primary approvers are unavailable.

- **Per-queue escalation window** — each routing queue can define an escalation deadline (in hours). When the assigned approver has not acted within this window, DocFlow reassigns the document to the queue's designated backup approver.
- **Escalation notifications** — the `document.escalated` lifecycle event fires on escalation, triggering email and in-app notifications per the M6 notification preferences rules.
- **Audit trail** — escalation actions are recorded in the audit log with actor (`system`), original approver, and escalation target.
- **Configuration:** Set the escalation window per queue in the routing rules admin UI or via `PUT /api/routing-rules/:id` (`escalationWindowHours` field). Set the backup approver with `escalationAssigneeId`.

---

### Approval Delegation (DOCA-65)

Approvers can transfer their approval authority to a colleague for a defined period — for example during annual leave — without requiring an admin to reassign individual documents.

- **Delegation period** — a delegation entry specifies a delegate user, a start date, and an end date. During the active period all documents assigned to the delegating user are treated as assigned to the delegate.
- **Audit visibility** — delegated approvals are stamped with `delegatedByUserId` in the audit log so the original authority chain remains visible.
- **Self-service** — approvers create and revoke delegations from their user profile page at `/settings/delegation`.
- **API endpoints:** `POST /api/approvals/delegate` (create delegation), `GET /api/approvals/delegate` (list active delegations), `DELETE /api/approvals/delegate/:id` (revoke).

---

### Document Versioning (DOCA-66)

Every document upload and edit now creates a numbered version entry. Users can inspect the full history and download any previous version.

- **Automatic versioning** — re-uploading a document or editing its metadata increments the version number. Version 1 is created on first upload.
- **Version metadata** — each version record stores the uploader's user ID, upload timestamp, file size, and an optional change summary.
- **Download any version** — all versions remain accessible via API. The document list and detail views display the current (latest) version by default.
- **API endpoints:** `GET /api/documents/:id/versions` (list all versions), `GET /api/documents/:id/versions/:versionId` (version metadata), `GET /api/documents/:id/versions/:versionId/download` (download file).

---

### Bulk Document Operations (DOCA-67)

Admins and approvers can now act on multiple documents simultaneously from the document list view, reducing the overhead of high-volume queues.

- **Supported bulk actions:** submit (submitter role), approve (approver/admin role), reject (approver/admin role). Bulk reject requires a single rejection reason applied to all selected documents.
- **Individual event emission** — each document in a bulk action receives its own lifecycle event (`document.submitted`, `document.approved`, `document.rejected`), ensuring notification delivery and audit log entries are not aggregated or lost.
- **UI** — checkboxes appear in the document list when the user has the required role. A floating action bar shows the count of selected documents and available bulk actions.
- **API endpoints:** `POST /api/documents/bulk/submit` (body: `{ documentIds: string[] }`), `POST /api/documents/bulk/approve` (body: `{ documentIds: string[] }`), `POST /api/documents/bulk/reject` (body: `{ documentIds: string[], rejectionReason: string }`).

---

## Known Limitations

- Conditional routing evaluates conditions against document metadata fields present at submission time. Dynamic re-routing after approval steps have begun is not supported in this release.
- Delegation does not cascade: if User A delegates to User B and User B has also delegated to User C, documents are assigned to User B, not User C.
- Document versioning does not include diff or comparison views. File downloads are available for all versions but in-browser diff is not provided.
- Bulk operations are limited to 100 documents per request.

---

## Upgrade Notes

### Database migration

Run the Prisma migration after upgrading to add the `RoutingRuleCondition`, `ApprovalDelegation`, and `DocumentVersion` tables, and extend the `RoutingRule` table with escalation fields:

```bash
npm run db:migrate
```

All new tables and columns are additive; no existing data is modified.

### Routing rule conditions

Existing routing rules without conditions continue to match all documents (catch-all behaviour). Add conditions via the admin UI or API to narrow their scope.

---

## Related Documentation

| Document | Description |
|:---------|:------------|
| [docs/admin/routing-rules.md](../admin/routing-rules.md) | Routing rule configuration guide — condition syntax, priority ordering, escalation setup |
| [docs/user-guide/delegation.md](../user-guide/delegation.md) | Approver delegation guide — creating and revoking delegations |
| [docs/api/rest-api.md](../api/rest-api.md) | Public REST API reference — versioning, bulk operations, delegation endpoints |
| [CHANGELOG.md](../../CHANGELOG.md) | Full changelog following Keep a Changelog format |
| [docs/releases/m6-notifications-integrations.md](m6-notifications-integrations.md) | M6 milestone release notes — notifications & integrations |
