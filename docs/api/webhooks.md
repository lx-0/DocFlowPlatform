# Webhook Integration Guide

DocFlow can push document lifecycle events to your own HTTP endpoints in real time. This guide covers how to register a webhook, the payload schema for each event, delivery semantics, retry behaviour, and how to verify request signatures.

---

## Prerequisites

- A DocFlow user account with an API key (see [API Key Management](api-key-management.md))
- An HTTPS endpoint reachable from the DocFlow server (HTTP is accepted in development/test environments only)

---

## Concepts

A **webhook** is a registered URL that DocFlow will POST to whenever one or more subscribed events occur. Each webhook has:

- A **URL** — your endpoint
- An **event subscription list** — which event types trigger delivery
- A **secret** — used to sign requests so you can verify they came from DocFlow

---

## Event Types

| Event | When it fires |
|:------|:-------------|
| `document.submitted` | A document enters the approval queue |
| `document.approved` | An approver approves a document |
| `document.rejected` | An approver rejects a document |
| `document.assigned` | A document is assigned to a new user |
| `document.escalated` | An overdue document is escalated to a backup approver |

---

## Registering a Webhook

```
POST /api/webhooks
Authorization: ApiKey <your-api-key>
Content-Type: application/json
```

**Request body:**

```json
{
  "url": "https://your-server.example.com/hooks/docflow",
  "events": ["document.submitted", "document.approved"],
  "secret": "your-signing-secret-at-least-16-chars"
}
```

| Field | Type | Required | Notes |
|:------|:-----|:---------|:------|
| `url` | string | Yes | Must be a valid URL. HTTPS required in production. |
| `events` | string[] | Yes | Non-empty array of valid event type strings. |
| `secret` | string | Yes | Minimum 16 characters. Used to sign each delivery. |

**Response `201 Created`:**

```json
{
  "id": "wh_01J...",
  "url": "https://your-server.example.com/hooks/docflow",
  "events": ["document.submitted", "document.approved"],
  "active": true,
  "createdAt": "2026-03-16T10:00:00.000Z"
}
```

> **Security note:** The `secret` you supply is never returned in API responses. Store it securely — you will need it to verify incoming signatures.

---

## Listing Webhooks

```
GET /api/webhooks
Authorization: ApiKey <your-api-key>
```

Returns an array of your registered webhooks (ordered newest first), without the `secret` field.

---

## Deleting a Webhook

```
DELETE /api/webhooks/:id
Authorization: ApiKey <your-api-key>
```

Returns `204 No Content` on success. Returns `404` if the webhook does not exist or belongs to a different user.

---

## Payload Schema

Every delivery is an HTTP POST with `Content-Type: application/json` and the following body:

```json
{
  "event": "document.submitted",
  "timestamp": "2026-03-16T10:05:23.456Z",
  "data": {
    "document": { ... }
  }
}
```

| Field | Type | Description |
|:------|:-----|:------------|
| `event` | string | The event type that triggered this delivery |
| `timestamp` | string (ISO 8601) | UTC timestamp of when the event was fired |
| `data.document` | object | The document object in the same shape as the public REST API response |

---

## Signature Verification

Every request includes an `X-DocFlow-Signature` header:

```
X-DocFlow-Signature: sha256=<hex-digest>
```

The digest is an HMAC-SHA256 of the raw JSON request body, keyed with your webhook secret.

**Verification example (Node.js):**

```js
const crypto = require('crypto');

function isValidSignature(rawBody, secret, headerValue) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  // Use timingSafeEqual to prevent timing attacks
  const a = Buffer.from(expected);
  const b = Buffer.from(headerValue);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Always verify the signature before processing a delivery. Reject requests with a missing or invalid signature with `401 Unauthorized`.

---

## Delivery Semantics

- Deliveries are **asynchronous** — they do not block the DocFlow request that triggers the event.
- DocFlow delivers to all **active** webhooks belonging to the document owner that subscribe to the fired event.
- In **production**, only HTTPS URLs receive deliveries. HTTP URLs are silently skipped.
- In **development/test** (`NODE_ENV` ≠ `production`), HTTP URLs are also accepted.

---

## Retry Behaviour

If your endpoint returns a non-2xx status code, or the request fails at the network level, DocFlow retries up to **3 attempts total**:

| Attempt | Delay before attempt |
|:--------|:---------------------|
| 1 (initial) | None |
| 2 | 1 second |
| 3 | 2 seconds |

After 3 failed attempts the delivery is abandoned. The failure is recorded in the delivery log (see below).

Your endpoint should respond within **10 seconds**; requests that exceed this timeout are treated as failures.

---

## Delivery Log

View the last 50 delivery attempts for a webhook:

```
GET /api/webhooks/:id/deliveries
Authorization: ApiKey <your-api-key>
```

**Response:**

```json
[
  {
    "id": "del_01J...",
    "event": "document.submitted",
    "statusCode": 200,
    "attemptCount": 1,
    "deliveredAt": "2026-03-16T10:05:23.789Z",
    "createdAt": "2026-03-16T10:05:23.456Z"
  }
]
```

| Field | Description |
|:------|:------------|
| `statusCode` | HTTP status your endpoint returned, or `null` for network-level failures |
| `attemptCount` | Total number of delivery attempts made |
| `deliveredAt` | Timestamp of the successful delivery, or `null` if all attempts failed |

---

## Best Practices

- **Respond quickly.** Return `200 OK` as soon as you receive the request and process the payload asynchronously. Slow endpoints risk timeout-triggered retries.
- **Verify the signature.** Always validate `X-DocFlow-Signature` before acting on a delivery.
- **Handle duplicates.** Retries can deliver the same event more than once. Use the `data.document.id` + `event` + `timestamp` combination to deduplicate if needed.
- **Use HTTPS.** HTTP endpoints are blocked in production.
