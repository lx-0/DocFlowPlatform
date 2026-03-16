# DocFlow — Approver Guide

This guide covers how to view the approval queue, review documents, and record decisions in DocFlow.

## Prerequisites

You need a DocFlow account with the `approver` role (or the `admin` role). The `approver` role grants:

- `documents:read` — view and download documents
- `documents:approve` — approve, reject, or request changes on documents

If you cannot see the **Approvals** item in the sidebar or receive a 403 error, contact your administrator to confirm your role assignment.

---

## 1. Accessing the Approval Queue

Click **Approvals** in the left sidebar, or navigate to `/approvals`.

The queue shows all pending workflows where at least one step is assigned to you (or is unassigned and visible to your queue). Each row displays:

| Column | Description |
|:-------|:------------|
| Document Title | Extracted title, or filename if metadata is unavailable |
| Type | Document type extracted from metadata |
| Submitted By | Name or email of the person who uploaded the document |
| Date Queued | When the approval workflow was created |
| Status | Current workflow status (`Pending`, `Approved`, `Rejected`, `Changes Requested`) |
| Queue | The routing queue this document was sent to |

Click any row to open the document review page.

---

## 2. Reviewing a Document

The review page (`/approvals/:workflowId`) has two panels:

### Document Details panel

Shows the document's metadata and a link to view or download the file:

| Field | Description |
|:------|:------------|
| Title | Document title extracted from metadata |
| Type | Document type |
| Submitted By | Uploader's name or email |
| Uploaded | Upload timestamp |
| Queue | Routing queue name |
| Step | Current step number out of total steps (e.g. "1 of 2") |
| Pages | Page count (if available) |
| Author | Document author (if available) |

Click **View Document** to open or download the file before making a decision.

### Decision panel

Enter an optional comment and then choose one of three actions:

| Action | Button | Comment required? |
|:-------|:-------|:-----------------|
| **Approve** | Green | No (optional) |
| **Request Changes** | Amber | **Yes** — explain what needs to change |
| **Reject** | Red | **Yes** — state the reason for rejection |

After submitting, you are returned to the Approval Queue. If the workflow has multiple steps, it advances to the next step automatically after an approval.

---

## 3. Multi-Step Workflows

Some documents require more than one approver in sequence. The **Step** field on the review page shows your position in the chain (e.g. "Step 2 of 3").

- You can only act on the **current step** — earlier and later steps are read-only.
- When you approve a step, the next step becomes active and the next approver is notified.
- If you **reject** at any step, the entire workflow ends as rejected.
- If you **request changes**, the workflow is paused until the submitter re-submits a revised document.

---

## 4. Email Notification Expectations

DocFlow is configured to send email notifications at the following points:

- **New document assigned to your queue** — you receive an email when a document enters an approval step where you are the assigned (or eligible) approver
- **Decision recorded** — the document submitter receives an email when any step is completed (approved, rejected, or changes requested)

> **Note:** Email delivery depends on your organization's DocFlow mail configuration. Contact your administrator if you are not receiving expected notifications.

---

## 5. Tips

- **Always read the document** before making a decision. Click **View Document** to download the formatted or final version.
- **Request Changes sparingly** — each request-changes cycle requires the submitter to re-upload a new file. Be specific and complete in your comment so they can address everything in one revision.
- **Rejection is final** — a rejected document does not automatically move to revision. The submitter must start a new submission.
- If the queue is empty, the page shows "No documents awaiting your approval." Check back later or confirm with the submitter that their document has completed processing.
