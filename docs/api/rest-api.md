# DocFlow Public REST API

This guide is for external developers integrating their systems with DocFlow over the public REST API. It covers authentication, available endpoints, rate limiting, and error handling.

---

## Base URL

```
https://<your-docflow-host>/api/v1
```

All endpoints described in this document are versioned under `/api/v1/`. The version prefix ensures backwards-compatible changes can be made without breaking existing integrations.

---

## Authentication

All `/api/v1/` endpoints require an API key. API keys are issued by a DocFlow administrator through the admin panel.

Include the key in every request using the `Authorization` header:

```
Authorization: ApiKey <your-api-key>
```

**Example:**

```bash
curl -H "Authorization: ApiKey dfk_prod_abc123xyz" \
  https://docflow.example.com/api/v1/documents/a1b2c3d4-...
```

> **Note:** API keys are only issued to users with the `admin` role. See [API Key Management](api-key-management.md) for how admins generate and revoke keys.

---

## Rate Limiting

Requests are rate-limited per API key:

| Limit | Window |
|:------|:-------|
| 100 requests | 1 minute |

When the limit is exceeded, the server responds with:

**`429 Too Many Requests`**

```json
{
  "error": "Too many requests. Limit: 100 requests per minute."
}
```

The `Retry-After` header indicates how many seconds to wait before retrying.

---

## Endpoints

### `POST /api/v1/documents`

Submit a document for processing.

Documents are accepted as multipart form data. After submission the document enters the processing pipeline asynchronously — poll `GET /api/v1/documents/:id` to track progress.

**Accepted file types:** PDF, DOCX
**Maximum file size:** 50 MB

**Request**

```
POST /api/v1/documents
Authorization: ApiKey <key>
Content-Type: multipart/form-data
```

| Form field | Type | Required | Description |
|:-----------|:-----|:---------|:------------|
| `file` | file | Yes | The document to submit (PDF or DOCX) |

**Example (curl)**

```bash
curl -X POST https://docflow.example.com/api/v1/documents \
  -H "Authorization: ApiKey dfk_prod_abc123xyz" \
  -F "file=@invoice-q1.pdf"
```

**Example (Python)**

```python
import requests

API_KEY = "dfk_prod_abc123xyz"
BASE_URL = "https://docflow.example.com/api/v1"

with open("invoice-q1.pdf", "rb") as f:
    response = requests.post(
        f"{BASE_URL}/documents",
        headers={"Authorization": f"ApiKey {API_KEY}"},
        files={"file": ("invoice-q1.pdf", f, "application/pdf")},
    )

data = response.json()
document_id = data["id"]
print(f"Submitted document: {document_id}, status: {data['status']}")
```

**Response `201 Created`**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "originalFilename": "invoice-q1.pdf",
  "status": "uploaded",
  "createdAt": "2026-03-16T12:00:00.000Z"
}
```

**Error responses**

| Status | Condition |
|:-------|:----------|
| `400 Bad Request` | No file attached, invalid file type, or file exceeds 50 MB |
| `401 Unauthorized` | Missing or invalid API key |
| `429 Too Many Requests` | Rate limit exceeded |

---

### `GET /api/v1/documents/:id`

Get the current processing status and metadata for a document.

Poll this endpoint after submission to track the document through its processing pipeline.

**Request**

```
GET /api/v1/documents/:id
Authorization: ApiKey <key>
```

| Path parameter | Description |
|:---------------|:------------|
| `id` | UUID of the document returned by `POST /api/v1/documents` |

**Example (curl)**

```bash
curl https://docflow.example.com/api/v1/documents/a1b2c3d4-... \
  -H "Authorization: ApiKey dfk_prod_abc123xyz"
```

**Response `200 OK`**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "originalFilename": "invoice-q1.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 204800,
  "status": "cover_sheet_applied",
  "stage": "cover_sheet",
  "progress": 100,
  "routingStatus": "approved",
  "errors": [],
  "createdAt": "2026-03-16T12:00:00.000Z",
  "updatedAt": "2026-03-16T12:01:30.000Z"
}
```

**`status` field values**

The `status` field tracks the document through each pipeline stage:

| Status | Stage | Progress | Description |
|:-------|:------|:---------|:------------|
| `uploaded` | upload | 5% | Document received, pipeline starting |
| `extracting_metadata` | metadata_extraction | 20% | Extracting title, author, page count |
| `metadata_failed` | metadata_extraction | 20% | Metadata extraction error |
| `validating` | format_validation | 40% | Checking format rules |
| `validation_failed` | format_validation | 40% | Format validation error |
| `validated` | format_validation | 50% | Validation passed |
| `formatting` | formatting | 65% | Applying standard formatting |
| `formatting_failed` | formatting | 65% | Formatting error |
| `formatted` | formatting | 75% | Formatting complete |
| `applying_cover_sheet` | cover_sheet | 90% | Generating cover sheet |
| `cover_sheet_failed` | cover_sheet | 90% | Cover sheet generation error |
| `cover_sheet_applied` | cover_sheet | 100% | Processing complete |

**`routingStatus` field values**

Once a document completes processing it enters the approval workflow. The `routingStatus` field reflects workflow progress:

| Value | Description |
|:------|:------------|
| `unrouted` | Not yet assigned to an approval queue |
| `queued` | In an approval queue, waiting for review |
| `in_approval` | Currently under review |
| `approved` | Approved by all required approvers |
| `rejected` | Rejected during approval |

**Error responses**

| Status | Condition |
|:-------|:----------|
| `401 Unauthorized` | Missing or invalid API key |
| `404 Not Found` | Document not found or not owned by this API key's user |
| `429 Too Many Requests` | Rate limit exceeded |

---

### `GET /api/v1/documents/:id/download`

Download the processed document. Only available once the document has reached `cover_sheet_applied` status.

**Request**

```
GET /api/v1/documents/:id/download
Authorization: ApiKey <key>
```

| Path parameter | Description |
|:---------------|:------------|
| `id` | UUID of the document |

**Example (curl)**

```bash
curl -O -J https://docflow.example.com/api/v1/documents/a1b2c3d4-.../download \
  -H "Authorization: ApiKey dfk_prod_abc123xyz"
```

**Response `200 OK`**

The response body is the processed document binary.

```
Content-Type: application/pdf   (or application/vnd.openxmlformats-officedocument.wordprocessingml.document)
Content-Disposition: attachment; filename="<processed-filename>"
```

**Error responses**

| Status | Condition |
|:-------|:----------|
| `401 Unauthorized` | Missing or invalid API key |
| `404 Not Found` | Document not found |
| `422 Unprocessable Entity` | Document has not finished processing yet |
| `429 Too Many Requests` | Rate limit exceeded |

---

## Error Response Format

All error responses use the same JSON shape:

```json
{
  "error": "Human-readable description of the error."
}
```

**Standard error codes**

| HTTP Status | Meaning |
|:------------|:--------|
| `400 Bad Request` | Invalid request (missing fields, wrong type, file too large) |
| `401 Unauthorized` | API key missing, invalid, or revoked |
| `404 Not Found` | Resource does not exist or is not accessible |
| `422 Unprocessable Entity` | Request is valid but cannot be processed in current state |
| `429 Too Many Requests` | Rate limit exceeded — wait and retry |
| `500 Internal Server Error` | Unexpected server error |

---

## End-to-End Integration Example

The following example shows a complete integration flow: submit a document, poll until processing completes, then download the result.

**curl**

```bash
#!/bin/bash

API_KEY="dfk_prod_abc123xyz"
BASE="https://docflow.example.com/api/v1"

# 1. Submit
RESPONSE=$(curl -s -X POST "$BASE/documents" \
  -H "Authorization: ApiKey $API_KEY" \
  -F "file=@invoice-q1.pdf")

DOC_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Submitted: $DOC_ID"

# 2. Poll until done
while true; do
  STATUS=$(curl -s "$BASE/documents/$DOC_ID" \
    -H "Authorization: ApiKey $API_KEY" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['status'])")
  echo "Status: $STATUS"

  if [[ "$STATUS" == "cover_sheet_applied" ]]; then
    break
  elif [[ "$STATUS" == *"_failed" ]]; then
    echo "Processing failed"
    exit 1
  fi
  sleep 3
done

# 3. Download
curl -OJ "$BASE/documents/$DOC_ID/download" \
  -H "Authorization: ApiKey $API_KEY"
echo "Download complete"
```

**Python**

```python
import time
import requests

API_KEY = "dfk_prod_abc123xyz"
BASE_URL = "https://docflow.example.com/api/v1"
HEADERS = {"Authorization": f"ApiKey {API_KEY}"}

# 1. Submit
with open("invoice-q1.pdf", "rb") as f:
    resp = requests.post(
        f"{BASE_URL}/documents",
        headers=HEADERS,
        files={"file": ("invoice-q1.pdf", f, "application/pdf")},
    )
resp.raise_for_status()
doc_id = resp.json()["id"]
print(f"Submitted: {doc_id}")

# 2. Poll until processing completes
while True:
    resp = requests.get(f"{BASE_URL}/documents/{doc_id}", headers=HEADERS)
    resp.raise_for_status()
    data = resp.json()
    status = data["status"]
    print(f"Status: {status} ({data['progress']}%)")

    if status == "cover_sheet_applied":
        break
    if status.endswith("_failed"):
        raise RuntimeError(f"Processing failed at status: {status}")
    time.sleep(3)

# 3. Download
resp = requests.get(f"{BASE_URL}/documents/{doc_id}/download", headers=HEADERS)
resp.raise_for_status()

filename = "processed-document.pdf"
cd = resp.headers.get("Content-Disposition", "")
if "filename=" in cd:
    filename = cd.split("filename=")[-1].strip('"')

with open(filename, "wb") as f:
    f.write(resp.content)

print(f"Downloaded: {filename}")
```

---

## Related

- [API Key Management](api-key-management.md) — how admins create and revoke API keys
- [docs/api-reference.md](../api-reference.md) — internal REST API (JWT-authenticated, for the DocFlow web app)
