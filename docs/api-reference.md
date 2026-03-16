# DocFlow API Reference

Base URL: `http://localhost:3000` (development)

All request and response bodies are JSON. Protected endpoints require a `Authorization: Bearer <token>` header.

---

## Health

### `GET /health`

Returns the API server status. No authentication required.

**Response `200 OK`**

```json
{ "status": "ok" }
```

---

## Authentication

### `POST /api/auth/register`

Register a new user account.

**Request body**

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `email` | string | Yes | Unique email address |
| `password` | string | Yes | Plain-text password (hashed server-side with bcryptjs) |

**Example request**

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{ "email": "alice@example.com", "password": "s3cr3t" }'
```

**Response `201 Created`**

```json
{ "message": "User registered successfully" }
```

**Error responses**

| Status | Condition |
|:-------|:----------|
| `400 Bad Request` | Missing or invalid fields |
| `409 Conflict` | Email already registered |

---

### `POST /api/auth/login`

Authenticate with email and password. Returns a signed JWT.

**Request body**

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `email` | string | Yes | Registered email address |
| `password` | string | Yes | Account password |

**Example request**

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "alice@example.com", "password": "s3cr3t" }'
```

**Response `200 OK`**

```json
{ "token": "<jwt>" }
```

The JWT payload contains:

```json
{
  "userId": "<uuid>",
  "email": "alice@example.com",
  "role": "user",
  "iat": 1710000000,
  "exp": 1710028800
}
```

Token lifetime: **8 hours** (configurable via `JWT_EXPIRES_IN` env var).

**Error responses**

| Status | Condition |
|:-------|:----------|
| `400 Bad Request` | Missing fields |
| `401 Unauthorized` | Invalid email or password |

---

## Using the JWT

Include the token in the `Authorization` header for all protected endpoints (added in future milestones):

```
Authorization: Bearer <token>
```

The `middleware/auth.js` middleware verifies the token and attaches the decoded payload to `req.user`.

---

## Admin — Audit Logs

### `GET /api/admin/audit-logs`

Returns a paginated list of audit log entries. Requires the `admin:audit` permission (the built-in `admin` role includes this).

See the full parameter and response documentation in the [Audit Log Admin Guide](admin/audit-logs.md#api-reference).

**Query parameters (summary)**

| Parameter | Type | Description |
|:----------|:-----|:------------|
| `action` | string | Filter by event type (e.g. `user.login`, `document.approved`) |
| `actorId` | UUID | Filter by actor user ID |
| `actorEmail` | string | Filter by actor email |
| `resourceId` | UUID | Filter by affected resource ID |
| `from` | ISO 8601 | Earliest event timestamp (inclusive) |
| `to` | ISO 8601 | Latest event timestamp (inclusive) |
| `page` | integer | Page number, 1-indexed (default: `1`) |
| `pageSize` | integer | Results per page, max 200 (default: `50`) |

**Example request**

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:3000/api/admin/audit-logs?action=document.approved&from=2026-03-01"
```

**Response `200 OK`**

```json
{
  "total": 42,
  "page": 1,
  "pageSize": 50,
  "entries": [
    {
      "id": "a1b2c3d4-...",
      "action": "document.approved",
      "actorId": "e5f6a7b8-...",
      "actorEmail": "carol@example.com",
      "resourceType": "document",
      "resourceId": "09ab1cd2-...",
      "metadata": { "documentTitle": "Q1 Expense Report", "workflowStep": 2 },
      "createdAt": "2026-03-15T14:32:01.000Z"
    }
  ]
}
```

**Error responses**

| Status | Condition |
|:-------|:----------|
| `401 Unauthorized` | Missing or invalid JWT |
| `403 Forbidden` | Lacks `admin:audit` permission |
| `400 Bad Request` | Invalid query parameter |

---

## Environment Variables (Backend)

| Variable | Default | Description |
|:---------|:--------|:------------|
| `PORT` | `3000` | HTTP listen port |
| `NODE_ENV` | `development` | Runtime environment |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `JWT_SECRET` | — | Secret used to sign JWTs — **must be changed in production** |
| `JWT_EXPIRES_IN` | `8h` | JWT expiry duration (e.g. `1h`, `8h`, `7d`) |
