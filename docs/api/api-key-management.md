# API Key Management

API keys allow external systems to authenticate with the DocFlow public REST API without using user credentials. Only administrators can create and revoke API keys.

---

## Overview

- API keys are scoped to a specific admin user account.
- Each key is only shown in plaintext **once** at creation — DocFlow stores only a hash.
- Keys can be revoked at any time from the admin panel.
- All key management actions are recorded in the [audit log](../admin/audit-logs.md).

---

## Admin Panel

API key management is available at `/admin/api-keys` in the DocFlow web interface. You must be logged in as a user with the `admin` role to access this page.

### Generate a new key

1. Navigate to **Admin → API Keys**.
2. Click **Generate New Key**.
3. Enter a descriptive label (e.g. `ERP Integration - Production`).
4. Click **Create**.
5. Copy the displayed key immediately — it will not be shown again.

> **Important:** Store the key securely (e.g. in a secrets manager). If you lose the plaintext key, you must revoke it and generate a new one.

### List existing keys

The API Keys page shows all keys associated with your account:

| Column | Description |
|:-------|:------------|
| Label | The name you assigned when creating the key |
| Created | Date the key was generated |
| Last Used | Most recent authenticated request using this key |
| Status | Active or Revoked |

Plaintext key values are never displayed after initial creation.

### Revoke a key

1. Navigate to **Admin → API Keys**.
2. Find the key you want to revoke.
3. Click **Revoke**.
4. Confirm the action.

Revoked keys are rejected immediately. Any in-flight requests using the key will receive `401 Unauthorized` responses.

---

## Admin API Endpoints

API key management can also be performed programmatically using the internal admin API (JWT-authenticated, not the public `/api/v1/` API).

### `POST /api/admin/api-keys`

Generate a new API key for the authenticated admin user.

**Request**

```
POST /api/admin/api-keys
Authorization: Bearer <jwt>
Content-Type: application/json
```

```json
{
  "label": "ERP Integration - Production"
}
```

| Field | Type | Required | Description |
|:------|:-----|:---------|:------------|
| `label` | string | Yes | Human-readable name for the key |

**Response `201 Created`**

```json
{
  "id": "ck_a1b2c3d4-...",
  "label": "ERP Integration - Production",
  "key": "dfk_prod_abc123xyz...",
  "createdAt": "2026-03-16T12:00:00.000Z"
}
```

> The `key` field contains the plaintext API key. This is the only time it is returned. Store it securely immediately.

**Error responses**

| Status | Condition |
|:-------|:----------|
| `400 Bad Request` | Missing `label` |
| `401 Unauthorized` | Missing or invalid JWT |
| `403 Forbidden` | Authenticated user does not have `admin` role |

---

### `GET /api/admin/api-keys`

List all API keys for the authenticated admin user.

**Request**

```
GET /api/admin/api-keys
Authorization: Bearer <jwt>
```

**Response `200 OK`**

```json
[
  {
    "id": "ck_a1b2c3d4-...",
    "label": "ERP Integration - Production",
    "lastUsedAt": "2026-03-15T09:42:00.000Z",
    "createdAt": "2026-03-01T08:00:00.000Z",
    "revokedAt": null
  },
  {
    "id": "ck_e5f6a7b8-...",
    "label": "HR System - Staging",
    "lastUsedAt": null,
    "createdAt": "2026-02-15T14:00:00.000Z",
    "revokedAt": "2026-03-10T11:30:00.000Z"
  }
]
```

Plaintext key values are never included in list responses.

**Error responses**

| Status | Condition |
|:-------|:----------|
| `401 Unauthorized` | Missing or invalid JWT |
| `403 Forbidden` | Authenticated user does not have `admin` role |

---

### `DELETE /api/admin/api-keys/:id`

Revoke an API key immediately.

**Request**

```
DELETE /api/admin/api-keys/:id
Authorization: Bearer <jwt>
```

| Path parameter | Description |
|:---------------|:------------|
| `id` | ID of the API key to revoke |

**Response `204 No Content`**

No response body.

**Error responses**

| Status | Condition |
|:-------|:----------|
| `401 Unauthorized` | Missing or invalid JWT |
| `403 Forbidden` | Authenticated user does not have `admin` role |
| `404 Not Found` | Key not found or not owned by this user |

---

## Security Best Practices

**Protect your keys**

- Store API keys in a secrets manager (e.g. AWS Secrets Manager, HashiCorp Vault, GitHub Actions Secrets).
- Never commit keys to source control — even in private repositories.
- Never log keys or include them in error messages.
- Prefer environment variables over config files for injecting keys at runtime.

**Use descriptive labels**

Label each key with its purpose and environment, e.g. `ERP Integration - Production` or `CI Pipeline - Staging`. This makes it easy to identify and revoke a key if it is compromised.

**Rotate keys regularly**

1. Generate a new key with the same label.
2. Update your integration to use the new key.
3. Verify requests are flowing correctly using the new key.
4. Revoke the old key.

**Revoke promptly on suspected compromise**

If you suspect a key has been exposed, revoke it immediately from the admin panel. Any system using the revoked key will receive `401 Unauthorized` responses until you deploy a replacement.

**Least privilege**

API keys are tied to a user account. Use a dedicated service account with the minimum permissions required for the integration, rather than attaching keys to personal admin accounts.

---

## Related

- [Public REST API Reference](rest-api.md) — using API keys to call the `/api/v1/` endpoints
- [RBAC Admin Guide](../admin/rbac.md) — managing roles and permissions
- [Audit Logs](../admin/audit-logs.md) — tracking API key usage and admin actions
