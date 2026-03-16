# Email Notifications Admin Guide

DocFlow sends transactional emails when documents change state. This guide explains how to configure the mail server, which events trigger emails, and how to customise notification templates.

---

## Prerequisites

You must be logged in as a user with the `admin` role.

---

## Overview

The email notification system (`backend/services/email.js`) dispatches emails asynchronously for the following document lifecycle events:

| Event | Recipients | Subject |
|:------|:-----------|:--------|
| `document.submitted` | Assigned approvers | "New document awaiting your review: `<title>`" |
| `document.approved` | Submitter | "Your document has been approved: `<title>`" |
| `document.rejected` | Submitter | "Your document has been rejected: `<title>`" |
| `document.assigned` | New assignee | "A document has been assigned to you: `<title>`" |
| `document.escalated` | Escalation target | "A document has been escalated to you: `<title>`" |

Emails are dispatched asynchronously via `setImmediate`. They never block the request handler that triggers them.

---

## SMTP Configuration

Configure the mail server using environment variables. All four SMTP variables must be set for emails to be delivered.

| Variable | Required | Description | Example |
|:---------|:---------|:------------|:--------|
| `SMTP_HOST` | Yes | SMTP server hostname | `smtp.example.com` |
| `SMTP_PORT` | Yes | SMTP server port | `587` |
| `SMTP_USER` | Yes | SMTP authentication username | `docflow@example.com` |
| `SMTP_PASS` | Yes | SMTP authentication password | `s3cr3t` |
| `EMAIL_FROM` | No | Sender address (default: `noreply@docflow.local`) | `docflow@example.com` |
| `EMAIL_ENABLED` | No | Set to `false` to disable sending and log to console instead (default: enabled) | `false` |

**Example `.env` snippet:**

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=docflow@example.com
SMTP_PASS=s3cr3t
EMAIL_FROM=docflow@example.com
EMAIL_ENABLED=true
```

If `EMAIL_ENABLED=false` (useful in development), the service logs what would have been sent to `stdout` without connecting to an SMTP server.

If any of `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, or `SMTP_PASS` are absent, the service skips delivery and logs a warning — it does not throw an error.

---

## Email Templates

Templates live in `backend/templates/email/`. Each event has two variants:

| File | Format |
|:-----|:-------|
| `<event>.html` | HTML email body |
| `<event>.txt` | Plain-text fallback |

Available template files:

```
backend/templates/email/
  approved.html / approved.txt
  assigned.html / assigned.txt
  escalated.html / escalated.txt
  rejected.html / rejected.txt
  submitted.html / submitted.txt
```

### Template Variables

Templates use `{{variableName}}` placeholders. The following variables are injected per event:

| Variable | Present in | Description |
|:---------|:-----------|:------------|
| `{{documentTitle}}` | All events | Document title (falls back to ID if title is absent) |
| `{{documentId}}` | All events | Document UUID |
| `{{reasonRow}}` | `rejected` HTML only | Pre-rendered `<tr>` block containing the rejection reason (empty string when no reason given) |
| `{{reasonLine}}` | `rejected` TXT only | Plain-text rejection reason line (empty string when no reason given) |

### Customising a Template

Edit the relevant `.html` or `.txt` file directly. Changes take effect immediately for new notifications — no restart required.

Keep `{{documentTitle}}` and `{{documentId}}` in every template; they are always supplied by the service. Do not add other `{{}}` placeholders unless you also update `backend/services/email.js` to supply them.

---

## Admin SMTP Settings UI

> **Note:** The in-browser SMTP configuration UI and template management page (DOCA-59) are not yet available. Until that feature ships, configure SMTP via environment variables as described above.

---

## Troubleshooting

| Symptom | Likely cause | Action |
|:--------|:-------------|:-------|
| No emails delivered | `SMTP_*` vars not set | Verify all four SMTP env vars are present and restart the server |
| Emails logged to console instead of sent | `EMAIL_ENABLED=false` | Set `EMAIL_ENABLED=true` or remove the variable |
| SMTP authentication failure | Wrong credentials | Check `SMTP_USER` / `SMTP_PASS`; confirm the account has SMTP access |
| Template placeholder shows raw `{{...}}` | Typo in placeholder name | Cross-check variable names in the table above |
