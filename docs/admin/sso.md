# SSO Setup Guide (SAML 2.0 / OIDC)

DocFlow supports enterprise Single Sign-On via **SAML 2.0** and **OpenID Connect (OIDC)**. SSO is disabled by default; setting `SSO_PROVIDER` enables it.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SSO_PROVIDER` | Yes | `saml` or `oidc`. Enables SSO when set. |
| `SSO_ENTRY_POINT` | Yes | IdP SSO URL (SAML) or authorization endpoint (OIDC). |
| `SSO_ISSUER` | Yes | SP entity ID (SAML) or OIDC issuer URL (used for discovery). |
| `SSO_CERT` | SAML only | IdP public certificate PEM. Required for SAML signature verification. |
| `SSO_CALLBACK_URL` | Yes | ACS URL (SAML) or redirect URI (OIDC). Must be registered with the IdP. |
| `SSO_CLIENT_ID` | OIDC only | OIDC client ID. |
| `SSO_CLIENT_SECRET` | OIDC only | OIDC client secret. |
| `SSO_ROLE_CLAIM` | No | Claim name in the IdP assertion/userinfo that carries the DocFlow role. |

Add these to `backend/.env` (see `backend/.env.example`).

---

## SAML 2.0 Setup

### 1. Register DocFlow as a Service Provider

In your IdP, create a new SAML application and configure:

- **ACS URL** (Assertion Consumer Service): `https://<your-domain>/api/auth/sso/callback`
- **Entity ID / Audience**: value you set for `SSO_ISSUER` (e.g. `https://docflow.corp.com`)
- **Name ID format**: email address

### 2. Retrieve the SP Metadata (optional)

Once `SSO_PROVIDER=saml` and the other vars are set, the backend exposes SP metadata at:

```
GET /api/auth/sso/metadata
```

Some IdPs accept this XML directly to configure the service provider. Download it with:

```bash
curl https://<your-domain>/api/auth/sso/metadata -o docflow-sp-metadata.xml
```

This endpoint returns `501` if SSO is not configured.

### 3. Set Environment Variables

```env
SSO_PROVIDER=saml
SSO_ENTRY_POINT=https://your-idp.example.com/sso/saml
SSO_ISSUER=https://docflow.corp.com
SSO_CERT=-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----
SSO_CALLBACK_URL=https://docflow.corp.com/api/auth/sso/callback
SSO_ROLE_CLAIM=role        # optional — name of the claim that carries the DocFlow role
```

### Provider-specific notes

**Okta**
- Create a SAML 2.0 app in the Okta admin console.
- Set Single sign on URL to `SSO_CALLBACK_URL`.
- Set Audience URI (SP Entity ID) to `SSO_ISSUER`.
- Download the IdP certificate from the app's Sign On tab and set it as `SSO_CERT`.

**Azure Active Directory**
- Register an Enterprise Application and choose "SAML" as the SSO method.
- Set Reply URL to `SSO_CALLBACK_URL` and Identifier to `SSO_ISSUER`.
- Download the Base64 certificate from the SAML Signing Certificate section and set it as `SSO_CERT`.
- Set `SSO_ENTRY_POINT` to the Login URL shown in the Set up section.

**Google Workspace**
- Create a custom SAML app in Admin console → Apps → Web and mobile apps.
- Set ACS URL to `SSO_CALLBACK_URL` and Entity ID to `SSO_ISSUER`.
- Download the IdP metadata and extract the certificate for `SSO_CERT`.

---

## OIDC Setup

### 1. Register DocFlow as an OIDC Client

Create an OIDC/OAuth 2.0 application in your IdP. Set:

- **Redirect URI**: `https://<your-domain>/api/auth/sso/callback`
- **Grant type**: Authorization Code
- **Scopes**: `openid email profile`

### 2. Set Environment Variables

```env
SSO_PROVIDER=oidc
SSO_ISSUER=https://your-idp.example.com          # used for OIDC discovery
SSO_CLIENT_ID=your-client-id
SSO_CLIENT_SECRET=your-client-secret
SSO_CALLBACK_URL=https://docflow.corp.com/api/auth/sso/callback
SSO_ROLE_CLAIM=docflow_role    # optional — custom claim in userinfo
```

The backend uses OIDC Discovery (`<SSO_ISSUER>/.well-known/openid-configuration`) to locate endpoints automatically, so `SSO_ENTRY_POINT` is not required for OIDC.

### Provider-specific notes

**Okta**
- Create an OIDC Web application.
- Set Sign-in redirect URI to `SSO_CALLBACK_URL`.
- Set `SSO_ISSUER` to the Okta domain (e.g. `https://corp.okta.com`).

**Azure AD**
- Register an app in Azure AD. Under Authentication, add a Web redirect URI.
- Set `SSO_ISSUER` to `https://login.microsoftonline.com/<tenant-id>/v2.0`.

**Google Workspace**
- Create OAuth 2.0 credentials in Google Cloud Console.
- Set `SSO_ISSUER` to `https://accounts.google.com`.

---

## Role Claim Mapping

When `SSO_ROLE_CLAIM` is set, DocFlow reads that claim from the SAML assertion (for SAML) or the userinfo endpoint (for OIDC) and maps it to a DocFlow role.

- The claim value must match an existing role name in DocFlow (e.g. `admin`, `approver`, `submitter`).
- If the claim is absent or does not match a known role, the user is provisioned with the `submitter` role by default.
- On subsequent logins, if the claim value changes, DocFlow updates the user's role automatically.

Example (SAML attribute statement):
```xml
<saml:Attribute Name="role">
  <saml:AttributeValue>approver</saml:AttributeValue>
</saml:Attribute>
```

With `SSO_ROLE_CLAIM=role`, DocFlow maps this user to the `approver` role.

---

## Authentication Flow

```
Browser → GET /api/auth/sso/login
       → Redirect to IdP
       → [User authenticates at IdP]
       → IdP posts to /api/auth/sso/callback
       → DocFlow provisions/updates user
       → Response: { "token": "<JWT>" }
```

The returned JWT is a standard DocFlow bearer token. Store it and include it as `Authorization: Bearer <token>` on subsequent API calls.

---

## Disabling SSO

Unset or remove `SSO_PROVIDER` from your environment. All SSO routes will return `501 Not Implemented`.
