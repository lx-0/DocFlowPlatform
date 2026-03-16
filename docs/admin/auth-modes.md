# Authentication Modes

DocFlow supports three authentication modes that control how the frontend presents the login experience and which backend authentication method is used.

The mode is configured via the `VITE_AUTH_MODE` environment variable in the frontend.

> **Status:** Backend support for `ldap` and `sso` modes is fully implemented. Frontend integration for these modes (DOCA-35) is in progress. This document describes the intended behavior of all modes.

---

## Modes

| `VITE_AUTH_MODE` | Description |
|---|---|
| `local` | Default. Email and password login against the DocFlow local user database. |
| `ldap` | Email and password submitted to the LDAP backend (`POST /api/auth/ldap/login`). Users are authenticated against the configured LDAP/AD directory. |
| `sso` | Redirects users to the configured Identity Provider (SAML 2.0 or OIDC) via `GET /api/auth/sso/login`. |

---

## Configuration

Set `VITE_AUTH_MODE` in `frontend/.env` (or `frontend/.env.local` for local overrides):

```env
VITE_AUTH_MODE=local    # or ldap, or sso
```

The variable is read at build time by Vite. After changing it, restart the dev server or rebuild:

```bash
# Development
npm run dev

# Production
npm run build
```

---

## Mode Details

### `local` (default)

The login form submits credentials to `POST /api/auth/login`. Users must have a local DocFlow account created by an admin. Suitable for small deployments or development environments.

No additional backend configuration is required.

### `ldap`

The login form submits the user's email and password to `POST /api/auth/ldap/login`. The backend authenticates against the configured LDAP directory and auto-provisions the user on first login.

**Backend prerequisites:**

- Configure LDAP environment variables in `backend/.env`. See [ldap.md](ldap.md) for full setup instructions.
- `LDAP_URL` must be set. If it is not, the backend returns `501` and login fails.

### `sso`

The login page shows a "Sign in with SSO" button instead of a username/password form. Clicking it redirects to `GET /api/auth/sso/login`, which redirects to the Identity Provider. After successful authentication, the IdP posts back to DocFlow and the user receives a JWT.

**Backend prerequisites:**

- Configure SSO environment variables in `backend/.env`. See [sso.md](sso.md) for full setup instructions.
- `SSO_PROVIDER` must be set to `saml` or `oidc`.

---

## Switching Auth Modes

1. Update `VITE_AUTH_MODE` in `frontend/.env`.
2. Ensure the corresponding backend variables are configured in `backend/.env`.
3. Restart the backend (`npm run dev` in `backend/`).
4. Restart or rebuild the frontend.

You can run only one auth mode at a time. The backend endpoints for all modes remain active regardless of the frontend setting, so switching modes does not invalidate existing sessions or tokens.

---

## Security Considerations

- **`local` mode**: Passwords are hashed with bcrypt. Suitable for internal/dev use.
- **`ldap` mode**: Credentials are transmitted from the frontend to the DocFlow backend over your internal network. Use HTTPS in production and `ldaps://` for the backend-to-LDAP connection.
- **`sso` mode**: No credentials pass through DocFlow. All credential handling is delegated to the IdP. Recommended for production enterprise deployments.
