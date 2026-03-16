# DocFlow Platform — Production Deployment Guide

This guide covers everything an enterprise IT team needs to self-host DocFlow Platform.

---

## System Requirements

### Software

| Component | Minimum Version | Notes |
|:----------|:----------------|:------|
| Node.js | 18.x LTS | `node --version` to verify |
| npm | 9.x | Included with Node.js 18+ |
| PostgreSQL | 14 | 15 or 16 recommended for new installs |

### Recommended Server Specs

| Load Profile | CPU | RAM | Disk |
|:-------------|:----|:----|:-----|
| Small (< 100 docs/day) | 2 vCPU | 4 GB | 50 GB SSD |
| Medium (100–1000 docs/day) | 4 vCPU | 8 GB | 200 GB SSD |
| Large (> 1000 docs/day) | 8 vCPU | 16 GB | 500 GB SSD |

Disk estimates include database and uploaded document storage. Scale the disk for your expected document volume.

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in the values below.

### Core (Required)

| Variable | Default | Description |
|:---------|:--------|:------------|
| `PORT` | `3000` | TCP port the API server listens on |
| `NODE_ENV` | `development` | Set to `production` for production deployments |
| `DATABASE_URL` | — | PostgreSQL connection string: `postgresql://USER:PASSWORD@HOST:PORT/DATABASE` |
| `JWT_SECRET` | — | Secret used to sign JWT tokens. Use a long random string (32+ chars). **Never reuse across environments.** |
| `JWT_EXPIRES_IN` | `8h` | JWT token lifetime. Shorten for higher-security environments (e.g., `4h`). |

### LDAP / Active Directory (Optional)

Leave `LDAP_URL` unset to disable LDAP. When unset, `POST /api/auth/ldap/login` returns `501 Not Implemented`.

| Variable | Example | Description |
|:---------|:--------|:------------|
| `LDAP_URL` | `ldap://ad.corp.com` | LDAP server URL. Use `ldaps://` for TLS (port 636). |
| `LDAP_BASE_DN` | `DC=corp,DC=com` | Base DN for user searches. |
| `LDAP_BIND_DN` | `CN=svc-docflow,OU=ServiceAccounts,DC=corp,DC=com` | Service account DN used to bind and search. |
| `LDAP_BIND_PASSWORD` | — | Password for the service account. |
| `LDAP_USER_FILTER` | `(mail={email})` | Search filter. `{email}` is replaced with the user's login email. |
| `LDAP_ROLE_ATTRIBUTE` | `memberOf` | AD attribute that contains group memberships. |
| `LDAP_ROLE_MAP` | `{"CN=DocAdmins,...":"admin"}` | JSON mapping from group DN to DocFlow role (`admin`, `approver`, `submitter`, `viewer`). |

### SSO — SAML 2.0 / OIDC (Optional)

Leave `SSO_PROVIDER` unset to disable SSO. When unset, SSO endpoints return `501 Not Implemented`.

| Variable | Values / Example | Description |
|:---------|:-----------------|:------------|
| `SSO_PROVIDER` | `saml` or `oidc` | Selects the SSO protocol. |
| `SSO_ENTRY_POINT` | `https://idp.corp.com/sso` | IdP SSO URL (SAML) or authorization endpoint (OIDC). |
| `SSO_ISSUER` | `https://docflow.corp.com` | SP Entity ID (SAML) or OIDC issuer URL. |
| `SSO_CALLBACK_URL` | `https://docflow.corp.com/api/auth/sso/callback` | ACS URL (SAML) or OIDC redirect URI. Must be registered with the IdP. |
| `SSO_CERT` | PEM string | **SAML only.** IdP public certificate (without `-----BEGIN CERTIFICATE-----` headers). |
| `SSO_CLIENT_ID` | — | **OIDC only.** Client ID from the IdP app registration. |
| `SSO_CLIENT_SECRET` | — | **OIDC only.** Client secret from the IdP app registration. |
| `SSO_ROLE_CLAIM` | `roles` | Claim name in the IdP assertion/userinfo response that carries the user's DocFlow role. |

See [docs/admin/sso.md](../admin/sso.md) for full SAML and OIDC setup walkthroughs.

### RBAC

RBAC is always enabled. Roles and permissions are seeded into the database during setup. No additional environment variables are required. See [docs/admin/rbac.md](../admin/rbac.md) for managing users and roles.

### File Storage

| Variable | Default | Description |
|:---------|:--------|:------------|
| `UPLOAD_DIR` | `backend/uploads/` | Absolute or relative path to the document storage directory. Must be writable by the Node.js process. |

For production, set an absolute path to a dedicated volume (e.g., `/var/docflow/uploads`). Ensure this directory is included in backups. See [backup-and-recovery.md](backup-and-recovery.md).

### Email / SMTP (Optional)

All four SMTP variables must be set together to enable email notifications. Email is skipped gracefully (with a console log) when these are unset.

| Variable | Example | Description |
|:---------|:--------|:------------|
| `SMTP_HOST` | `smtp.corp.com` | SMTP server hostname. |
| `SMTP_PORT` | `587` | SMTP port. Use `587` (STARTTLS) or `465` (TLS). |
| `SMTP_USER` | `docflow@corp.com` | SMTP authentication username. |
| `SMTP_PASS` | — | SMTP authentication password. |
| `EMAIL_FROM` | `noreply@docflow.corp.com` | "From" address in outgoing emails. |

---

## Step-by-Step Deployment

### 1. Clone the Repository

```bash
git clone https://github.com/your-org/DocFlowPlatform.git /opt/docflow
cd /opt/docflow
```

### 2. Install Backend Dependencies

```bash
cd backend
npm install --omit=dev
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env and fill in DATABASE_URL, JWT_SECRET, and any optional integrations
```

Ensure `NODE_ENV=production` is set.

### 4. Build the Frontend

```bash
cd ../frontend
npm install --omit=dev
npm run build
```

The production build is output to `frontend/dist/`. Configure your reverse proxy (see below) to serve these static files.

### 5. Generate the Prisma Client

```bash
cd ../backend
npm run db:generate
```

This must be run after any `npm install` or dependency update.

### 6. Apply Database Migrations

```bash
npm run db:migrate
```

This runs `prisma migrate deploy`, which applies all pending migrations to the database. Safe to run on every deploy — it is idempotent for already-applied migrations.

### 7. Seed Roles and Permissions

Run this once on initial deployment (and again after a fresh database restore):

```bash
npm run db:seed
```

Seeds the four built-in roles (`admin`, `approver`, `submitter`, `viewer`) and five permissions. Safe to run multiple times.

### 8. Start the Server

#### Option A — pm2 (recommended)

```bash
npm install -g pm2
pm2 start src/index.js --name docflow --env production
pm2 save
pm2 startup   # Follow the printed command to enable auto-start on boot
```

#### Option B — systemd

Create `/etc/systemd/system/docflow.service`:

```ini
[Unit]
Description=DocFlow Platform API
After=network.target postgresql.service

[Service]
Type=simple
User=docflow
WorkingDirectory=/opt/docflow/backend
EnvironmentFile=/opt/docflow/backend/.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable docflow
systemctl start docflow
```

---

## Reverse Proxy Setup (Nginx)

The following configuration handles HTTPS termination, static frontend serving, and API proxying.

```nginx
server {
    listen 80;
    server_name docflow.corp.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name docflow.corp.com;

    ssl_certificate     /etc/ssl/certs/docflow.crt;
    ssl_certificate_key /etc/ssl/private/docflow.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Serve frontend static files
    root /opt/docflow/frontend/dist;
    index index.html;

    # Frontend — serve SPA, fall back to index.html for client-side routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API — proxy to Node.js backend
    location /api/ {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # WebSocket support (if needed for future features)
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
    }

    # Health check — allow direct access without auth
    location /health {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

Reload Nginx after editing:

```bash
nginx -t && systemctl reload nginx
```

---

## File Storage Considerations

### Local Disk

The default configuration stores uploaded documents on local disk at `UPLOAD_DIR`. This is suitable for single-node deployments.

- Set `UPLOAD_DIR` to a dedicated volume (not the OS disk).
- Ensure the directory is writable by the Node.js process user.
- Include it in your backup plan (see [backup-and-recovery.md](backup-and-recovery.md)).

### S3-Compatible Object Storage

Native S3 support is not yet implemented. It is planned for a future milestone. Until then, for HA or multi-node deployments, mount a shared NFS volume at `UPLOAD_DIR` so all nodes read from the same storage.

---

## Health Check

DocFlow exposes a health endpoint that returns `200 OK` when the server is running:

```
GET /health
```

Response:

```json
{ "status": "ok" }
```

No authentication is required. Use this endpoint for:

- Load balancer health checks
- Uptime monitoring (e.g., `curl -f http://localhost:3000/health`)
- Readiness probes in container orchestration platforms

Example monitoring cron:

```bash
# Alert if health check fails (add to monitoring tool or crontab)
curl -f http://localhost:3000/health || echo "DocFlow health check failed"
```

---

## Upgrading

1. Pull the latest code: `git pull`
2. Install any new backend dependencies: `cd backend && npm install --omit=dev`
3. Regenerate the Prisma client: `npm run db:generate`
4. Apply new migrations: `npm run db:migrate`
5. Rebuild the frontend: `cd ../frontend && npm install --omit=dev && npm run build`
6. Restart the server: `pm2 restart docflow` or `systemctl restart docflow`

Always check the [CHANGELOG](../../CHANGELOG.md) and [release notes](../releases/) for breaking changes before upgrading.
