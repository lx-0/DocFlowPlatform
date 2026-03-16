# DocFlow — Submitter Guide

This guide covers everything a document submitter needs to use DocFlow: logging in, uploading and submitting documents, tracking status, and responding to feedback.

## Prerequisites

You need a DocFlow account with the `submitter` role (or the `admin` role). If you are unsure whether you have access, contact your administrator.

---

## 1. Logging In

Navigate to the DocFlow URL provided by your organization (e.g. `https://docflow.example.com`) and go to `/login`.

DocFlow supports three login methods depending on how your organization is configured:

| Method | What you see | What to do |
|:-------|:------------|:-----------|
| **Local** (default) | Email and password fields | Enter your DocFlow email and password, then click **Sign in** |
| **LDAP** | Email and password fields | Enter your company directory credentials (same as your network login) |
| **SSO** | "Sign in with SSO" button | Click the button — you will be redirected to your organization's identity provider (e.g. Okta, Azure AD) and returned automatically after authentication |

After a successful login, DocFlow stores a session token that expires after **8 hours**. You will be redirected to the Dashboard.

---

## 2. The Dashboard

After login you land on the **Dashboard** (`/dashboard`), which shows a summary of your documents, pending approvals, and completed items.

The sidebar on the left gives you access to all main sections:

- **Dashboard** — summary view
- **Documents** — your uploaded documents
- **Workflows** — active workflows (coming soon)
- **Approvals** — documents awaiting your review (approvers only)
- **Settings** — account settings (coming soon)

To sign out, click **Sign out** at the bottom of the sidebar.

---

## 3. Uploading and Submitting a Document

### Supported file types and limits

- **Formats**: PDF (`.pdf`) and Word (`.docx`)
- **Maximum size**: 50 MB per file

### Steps

1. Go to **Documents** (`/documents`) in the sidebar.
2. Click **Upload** (or the equivalent upload control on the page).
3. Select a PDF or DOCX file from your computer.
4. Confirm the upload.

DocFlow assigns the document an ID and immediately starts processing it through the formatting pipeline. You do not need to wait on the upload screen — you can check status at any time.

---

## 4. Understanding Document Status

Each document moves through a processing pipeline automatically after upload. You can view the current status on the document detail page (`/documents/:id`).

### Processing pipeline

| Status | What it means |
|:-------|:-------------|
| `uploaded` | File received; pipeline starting |
| `extracting_metadata` | Extracting title, author, page count, document type |
| `metadata_failed` | Metadata extraction failed (document may still continue) |
| `validating` | Checking document against formatting rules |
| `validation_failed` | Document does not meet formatting requirements |
| `validated` | Format check passed |
| `formatting` | Applying standard formatting rules to DOCX files |
| `formatting_failed` | Formatting could not be applied |
| `formatted` | Formatting complete |
| `applying_cover_sheet` | Generating and attaching the standard cover sheet |
| `cover_sheet_failed` | Cover sheet generation failed |
| `cover_sheet_applied` | Cover sheet applied — document is ready for routing |

> **Note:** PDF files are validated and routed, but formatting (DOCX reflow) is not applied to PDFs.

### Routing/approval status

Once processing completes, the document enters the routing and approval workflow. The **Approval Status** column on the Documents page shows:

| Status | What it means |
|:-------|:-------------|
| **Unrouted** | No routing rule matched; document is waiting for an admin to assign it |
| **Queued** | Document has been placed in an approval queue |
| **In Approval** | An approver is actively reviewing the document |
| **Approved** | All approval steps passed |
| **Rejected** | An approver rejected the document |

---

## 5. Responding to "Changes Requested" Feedback

When an approver clicks **Request Changes**, the workflow pauses and the document status shows **Changes Requested** in the approval queue.

To respond:

1. Go to **Documents** and click the document.
2. Read the approver's comment on the document detail page.
3. Make the necessary changes to your source file.
4. Upload the revised file as a new document (re-upload is the current workflow — in-place revision will be added in a future release).
5. The new document will go through the same pipeline and routing.

---

## 6. Tracking Document History

On the document detail page (`/documents/:id`) you can see:

- **Document metadata**: title, author, type, page count, upload date
- **Processing status**: current pipeline stage and any error messages
- **Approval workflow**: the queue name, current step number out of total steps, and each step's action, comment, and timestamp

If you need a complete audit trail (who viewed or approved the document), ask your administrator to query the audit log.

---

## 7. Downloading Your Document

From the document detail page you can download:

- **Original** — your uploaded file
- **Formatted** — the DOCX file after formatting rules were applied (DOCX documents only)
- **Final** — the formatted document with cover sheet attached

---

## Common Issues

| Problem | Likely cause | What to do |
|:--------|:------------|:-----------|
| "Invalid file type" on upload | File is not PDF or DOCX | Convert or re-export the file |
| "File exceeds 50MB limit" | File is too large | Compress or split the document |
| Status stuck on `metadata_failed` | Corrupted or empty file | Re-export from the source application and re-upload |
| Status stuck on `formatting_failed` | Unsupported DOCX structure | Contact your administrator; a manual review may be needed |
| Approval Status shows "Unrouted" for a long time | No routing rule matches the document type | Contact your administrator |
