# Integration Quickstart

This guide walks you through your first DocFlow integration end-to-end: get an API key, submit a document, poll for completion, and download the result.

It assumes you have access to a running DocFlow instance and an admin account.

**Full API reference:** [Public REST API Reference](rest-api.md)

---

## Step 1 — Get an API key

Only administrators can generate API keys.

1. Sign in to DocFlow as an admin.
2. Go to **Admin → API Keys** (`/admin/api-keys`).
3. Click **Generate New Key** and enter a label (e.g. `My Integration - Dev`).
4. Copy the key — it is shown **only once**. Store it in a secrets manager or environment variable.

Keys use the prefix `dfk_` and are passed in the `Authorization` header:

```
Authorization: ApiKey dfk_prod_abc123xyz
```

> See [API Key Management](api-key-management.md) for rotation, revocation, and security best practices.

---

## Step 2 — Submit a document

Send a `multipart/form-data` request with the file in the `file` field. Accepted types: PDF, DOCX (max 50 MB).

**curl**

```bash
curl -X POST https://docflow.example.com/api/v1/documents \
  -H "Authorization: ApiKey dfk_prod_abc123xyz" \
  -F "file=@invoice-q1.pdf"
```

**Python**

```python
import requests

API_KEY = "dfk_prod_abc123xyz"
BASE_URL = "https://docflow.example.com/api/v1"

with open("invoice-q1.pdf", "rb") as f:
    resp = requests.post(
        f"{BASE_URL}/documents",
        headers={"Authorization": f"ApiKey {API_KEY}"},
        files={"file": ("invoice-q1.pdf", f, "application/pdf")},
    )

resp.raise_for_status()
doc = resp.json()
print(f"Submitted: {doc['id']} — status: {doc['status']}")
```

**Response `201 Created`**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "originalFilename": "invoice-q1.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 204800,
  "status": "uploaded",
  "submittedAt": "2026-03-16T12:00:00.000Z"
}
```

Save the `id` — you'll need it to poll for status and download the result.

---

## Step 3 — Poll for completion

Processing is asynchronous. Poll `GET /api/v1/documents/:id` until `status` reaches `cover_sheet_applied` (success) or a `*_failed` value (error).

**curl**

```bash
curl https://docflow.example.com/api/v1/documents/a1b2c3d4-... \
  -H "Authorization: ApiKey dfk_prod_abc123xyz"
```

**Python (polling loop)**

```python
import time

doc_id = doc["id"]

while True:
    resp = requests.get(
        f"{BASE_URL}/documents/{doc_id}",
        headers={"Authorization": f"ApiKey {API_KEY}"},
    )
    resp.raise_for_status()
    data = resp.json()
    status = data["status"]
    print(f"Status: {status}")

    if status == "cover_sheet_applied":
        print("Processing complete.")
        break
    if status.endswith("_failed"):
        raise RuntimeError(f"Processing failed: {data.get('errorMessage', status)}")

    time.sleep(3)
```

**Status progression**

| Status | Meaning |
|:-------|:--------|
| `uploaded` | Received, pipeline starting |
| `extracting_metadata` → `validated` → `formatted` | Intermediate stages |
| `cover_sheet_applied` | **Done — ready to download** |
| `*_failed` | Error — check `errorMessage` |

> **Rate limit:** 100 requests/minute per API key. Polling every 3–5 seconds is safe for typical document sizes.

---

## Step 4 — Download the processed document

Once status is `cover_sheet_applied`, download the result:

**curl**

```bash
curl -OJ https://docflow.example.com/api/v1/documents/a1b2c3d4-.../download \
  -H "Authorization: ApiKey dfk_prod_abc123xyz"
```

**Python**

```python
resp = requests.get(
    f"{BASE_URL}/documents/{doc_id}/download",
    headers={"Authorization": f"ApiKey {API_KEY}"},
)
resp.raise_for_status()

# Extract filename from Content-Disposition header
filename = "processed-document.pdf"
cd = resp.headers.get("Content-Disposition", "")
if "filename=" in cd:
    filename = cd.split("filename=")[-1].strip('"')

with open(filename, "wb") as f:
    f.write(resp.content)

print(f"Downloaded: {filename}")
```

The response body is the processed document binary. `Content-Type` matches the original file format.

---

## Complete example

**bash**

```bash
#!/bin/bash
set -euo pipefail

API_KEY="dfk_prod_abc123xyz"
BASE="https://docflow.example.com/api/v1"
FILE="invoice-q1.pdf"

# 1. Submit
RESPONSE=$(curl -s -X POST "$BASE/documents" \
  -H "Authorization: ApiKey $API_KEY" \
  -F "file=@$FILE")

DOC_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Submitted: $DOC_ID"

# 2. Poll
while true; do
  STATUS=$(curl -s "$BASE/documents/$DOC_ID" \
    -H "Authorization: ApiKey $API_KEY" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  echo "Status: $STATUS"

  [[ "$STATUS" == "cover_sheet_applied" ]] && break
  [[ "$STATUS" == *"_failed" ]] && { echo "Processing failed."; exit 1; }
  sleep 3
done

# 3. Download
curl -s -OJ "$BASE/documents/$DOC_ID/download" \
  -H "Authorization: ApiKey $API_KEY"
echo "Download complete."
```

---

## Common errors

| Status | Cause | Fix |
|:-------|:------|:----|
| `401 Unauthorized` | Missing or invalid API key | Check the `Authorization: ApiKey <key>` header |
| `400 Bad Request` | Wrong file type or missing `file` field | Only PDF and DOCX are accepted; use `multipart/form-data` |
| `400 Bad Request` | File exceeds 50 MB | Split or compress the file |
| `404 Not Found` | Wrong document ID or key mismatch | Documents are only accessible to the API key that submitted them |
| `422 Unprocessable Entity` | Download attempted before processing complete | Wait for `cover_sheet_applied` status |
| `429 Too Many Requests` | Rate limit hit | Back off and retry after the `Retry-After` header value (seconds) |

---

## Coming soon: Webhooks

Webhook event delivery is in progress. Once available, DocFlow will push status change notifications to your endpoint, so you no longer need to poll. Watch the [API changelog](../releases/) for updates.

---

## Next steps

- [Full API Reference](rest-api.md) — all endpoints, parameters, and response schemas
- [API Key Management](api-key-management.md) — key rotation, revocation, and security
