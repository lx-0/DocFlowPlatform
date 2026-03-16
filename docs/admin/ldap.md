# LDAP / Active Directory Integration Guide

DocFlow supports authenticating users against an LDAP directory, including Microsoft Active Directory and OpenLDAP. LDAP authentication is disabled by default; setting `LDAP_URL` enables it.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LDAP_URL` | Yes | LDAP server URL. Setting this enables LDAP. Examples: `ldap://ad.corp.com`, `ldaps://ad.corp.com:636` |
| `LDAP_BASE_DN` | Yes | Base DN for the user search scope. Example: `DC=corp,DC=com` |
| `LDAP_BIND_DN` | Yes | Distinguished name of the service account used for the initial directory search. |
| `LDAP_BIND_PASSWORD` | Yes | Password for the service account. |
| `LDAP_USER_FILTER` | No | Search filter template. Default: `(mail={email})`. Use `{email}` as the placeholder. |
| `LDAP_ROLE_ATTRIBUTE` | No | LDAP attribute that carries group membership or role information. Example: `memberOf` |
| `LDAP_ROLE_MAP` | No | JSON object mapping LDAP group DNs to DocFlow role names. |

Add these to `backend/.env` (see `backend/.env.example`).

---

## Basic Setup

### 1. Create a Service Account

Create a dedicated service account in your directory with read-only access to user objects. This account is used only for searching the directory — it never authenticates end users.

### 2. Set Environment Variables

Minimal configuration (email/password authentication without role mapping):

```env
LDAP_URL=ldap://ad.corp.com
LDAP_BASE_DN=DC=corp,DC=com
LDAP_BIND_DN=CN=svc-docflow,OU=ServiceAccounts,DC=corp,DC=com
LDAP_BIND_PASSWORD=service-account-password
```

Full configuration with group-to-role mapping:

```env
LDAP_URL=ldap://ad.corp.com
LDAP_BASE_DN=DC=corp,DC=com
LDAP_BIND_DN=CN=svc-docflow,OU=ServiceAccounts,DC=corp,DC=com
LDAP_BIND_PASSWORD=service-account-password
LDAP_USER_FILTER=(mail={email})
LDAP_ROLE_ATTRIBUTE=memberOf
LDAP_ROLE_MAP={"CN=DocAdmins,DC=corp,DC=com":"admin","CN=DocApprovers,DC=corp,DC=com":"approver"}
```

### 3. Use TLS (Recommended for Production)

Switch to `ldaps://` for encrypted connections:

```env
LDAP_URL=ldaps://ad.corp.com:636
```

---

## Group-to-Role Mapping

`LDAP_ROLE_MAP` is a JSON string that maps LDAP group DNs to DocFlow role names.

```env
LDAP_ROLE_MAP={"CN=DocAdmins,DC=corp,DC=com":"admin","CN=DocApprovers,DC=corp,DC=com":"approver","CN=DocUsers,DC=corp,DC=com":"submitter"}
```

**How it works:**

1. DocFlow reads the attribute named by `LDAP_ROLE_ATTRIBUTE` from the user's directory entry (typically `memberOf` in Active Directory).
2. It looks up the first value of that attribute in the `LDAP_ROLE_MAP`.
3. The matching DocFlow role is assigned to the user on login.
4. If the attribute is absent or does not match any key in the map, the user is provisioned with the `submitter` role.
5. On subsequent logins, the role is updated if the group membership has changed.

**Valid DocFlow roles:** `admin`, `approver`, `reviewer`, `submitter`. See [docs/admin/rbac.md](rbac.md) for role definitions.

---

## Authentication Flow

```
POST /api/auth/ldap/login
Body: { "email": "user@corp.com", "password": "..." }

1. Service account binds to LDAP
2. Directory search for user by email (using LDAP_USER_FILTER)
3. Short-lived client binds as the user to verify credentials
4. Group attribute read and mapped to DocFlow role
5. User provisioned/updated in DocFlow database
Response: { "token": "<JWT>" }
```

The returned JWT is a standard DocFlow bearer token. Include it as `Authorization: Bearer <token>` on API calls.

---

## Customizing the User Search Filter

The default filter `(mail={email})` searches by the `mail` attribute. To match a different attribute:

```env
# Search by sAMAccountName (common in Active Directory when users log in with username)
LDAP_USER_FILTER=(sAMAccountName={email})

# Search by userPrincipalName
LDAP_USER_FILTER=(userPrincipalName={email})
```

Special characters in the email are automatically stripped before the filter is applied.

---

## Troubleshooting Common LDAP Bind Failures

### `LDAP is not configured` (HTTP 501)

`LDAP_URL` is not set. Add it to your `.env` and restart the server.

### `Invalid email or password` (HTTP 401) — user exists in directory

**Possible causes:**

- The user's LDAP password is expired or locked. Check account status in your directory.
- `LDAP_USER_FILTER` does not match the user's attributes. Verify the filter by running a manual search:
  ```bash
  ldapsearch -H ldap://ad.corp.com -D "CN=svc-docflow,OU=ServiceAccounts,DC=corp,DC=com" \
    -w <password> -b "DC=corp,DC=com" "(mail=user@corp.com)"
  ```
- The user DN returned by the search cannot bind (e.g. account has restricted bind access).

### `Invalid email or password` (HTTP 401) — user not in directory

- Confirm the user exists under `LDAP_BASE_DN`.
- Check that `LDAP_USER_FILTER` matches the right attribute. AD often uses `userPrincipalName` rather than `mail`.

### Service account bind failure (server returns 500)

- Verify `LDAP_BIND_DN` and `LDAP_BIND_PASSWORD` by testing with `ldapsearch` (see above).
- For `ldaps://`, ensure the server certificate is trusted by the Node.js process. Set `NODE_EXTRA_CA_CERTS` to the CA certificate path if using a private CA.

### Connection refused / timeout

- Confirm the LDAP server is reachable from the DocFlow backend host on the configured port (389 for LDAP, 636 for LDAPS).
- Check firewall rules between the backend and the LDAP server.
- The server-side LDAP client is reused across requests. A network interruption will null the cached client and a new connection is established on the next login attempt.

### Roles not mapping correctly

- Confirm `LDAP_ROLE_ATTRIBUTE` matches the actual attribute name returned by the directory.
- Confirm `LDAP_ROLE_MAP` is valid JSON. A parse error silently falls back to an empty map. Test with:
  ```bash
  node -e "JSON.parse(process.env.LDAP_ROLE_MAP)"
  ```
- The map key must be the full group DN exactly as returned by the directory (case-sensitive).

---

## Disabling LDAP

Unset or remove `LDAP_URL` from your environment. The `POST /api/auth/ldap/login` endpoint will return `501 Not Implemented`.
