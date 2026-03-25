# Getting Started — Developer Guide

This guide covers everything you need to get DocFlow Platform running locally, run tests, and validate CI checks before pushing.

## Prerequisites

| Requirement | Minimum version |
|:------------|:----------------|
| Node.js     | 18              |
| npm         | 9               |
| PostgreSQL  | 14              |
| Git         | any recent      |

## Clone the Repository

```bash
git clone https://github.com/lx-0/DocFlowPlatform.git
cd DocFlowPlatform
```

## Backend Setup

### 1. Install dependencies

```bash
cd backend
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

| Variable | Description | Example |
|:---------|:------------|:--------|
| `PORT` | API server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/docflow` |
| `JWT_SECRET` | Secret used to sign JWTs — use a long random string | `change-me-to-something-random` |
| `JWT_EXPIRES_IN` | Token lifetime | `8h` |

**Optional: LDAP / Active Directory**

Leave `LDAP_URL` unset to disable LDAP. To enable it:

| Variable | Description |
|:---------|:------------|
| `LDAP_URL` | LDAP server URL, e.g. `ldap://ad.corp.com` |
| `LDAP_BASE_DN` | Base DN for searches, e.g. `DC=corp,DC=com` |
| `LDAP_BIND_DN` | Service account DN |
| `LDAP_BIND_PASSWORD` | Service account password |
| `LDAP_USER_FILTER` | Filter template, e.g. `(mail={email})` |
| `LDAP_ROLE_ATTRIBUTE` | AD attribute holding group membership, e.g. `memberOf` |
| `LDAP_ROLE_MAP` | JSON map of AD group DNs → DocFlow roles |

### 3. Generate the Prisma client

```bash
npm run db:generate
```

This must be run after a fresh clone or after changing `prisma/schema.prisma`.

### 4. Run database migrations

```bash
npm run db:migrate:dev
```

Creates all tables in your PostgreSQL database and applies any pending migrations.

### 5. Seed default roles and permissions

```bash
npm run db:seed
```

Creates the four built-in roles (`admin`, `approver`, `submitter`, `viewer`) with their default permission sets. Safe to re-run — the seed uses upsert logic.

### 6. Start the development server

```bash
npm run dev
```

The API server starts at **http://localhost:3000**. It uses `nodemon` and restarts automatically on file changes.

## Frontend Setup

In a separate terminal:

```bash
cd frontend
npm install
npm run dev
```

The React dev server starts at **http://localhost:5173**. All `/api/*` requests are automatically proxied to the backend on port 3000 (configured in `frontend/vite.config.js`).

## Running Tests

### Backend

```bash
cd backend
npm test
```

Runs the test suite using Node's built-in test runner against files in `backend/__tests__/`.

### Frontend

```bash
cd frontend
npm run lint     # ESLint
npm run build    # verify production build succeeds
npm test         # run tests
```

## Running CI Checks Locally

The GitHub Actions CI pipeline (`.github/workflows/ci.yml`) runs the following jobs on every push and PR to `main`. Run these before pushing to catch failures early:

**Backend:**
```bash
cd backend
npm ci
npm audit --audit-level=high
npm test
```

**Frontend:**
```bash
cd frontend
npm ci
npm audit --audit-level=high
npm run lint
npm run build
npm test
```

`npm ci` installs from the lockfile exactly as CI does. Use it instead of `npm install` to validate lockfile integrity.

## Dependency Security Scanning

All dependency vulnerabilities are scanned automatically on every PR via `npm audit --audit-level=high`. Builds fail on any **high** or **critical** severity finding.

**Dependabot** is enabled (`.github/dependabot.yml`) and opens automated PRs weekly for outdated packages in both `backend/` and `frontend/`.

### Running an audit locally

```bash
# Backend
cd backend && npm audit --audit-level=high

# Frontend
cd frontend && npm audit --audit-level=high
```

### Known accepted findings

| Package | Severity | Advisory | Reason | Resolution |
|:--------|:---------|:---------|:-------|:-----------|
| `hono` / `@hono/node-server` (via `@prisma/dev`) | High | GHSA-wc8c-qw6v-h7f6 and related | Bundled only inside **Prisma Studio** (a dev tool). Not present in the deployed runtime. | Track upstream Prisma fix or adopt `audit-ci` allowlisting. |

> The backend CI audit step runs with `continue-on-error: true` until the Prisma tooling finding is resolved. All other high/critical vulnerabilities must be fixed before merging.

### Adding a new dependency

1. Install with `npm install <package>`.
2. Run `npm audit --audit-level=high` — fix or triage any new findings before committing.
3. Commit both `package.json` and `package-lock.json`.

## Useful Database Commands

| Command | Description |
|:--------|:------------|
| `npm run db:generate` | Regenerate Prisma client after schema changes |
| `npm run db:migrate:dev` | Apply pending migrations (dev) |
| `npm run db:migrate` | Apply migrations (production / staging) |
| `npm run db:seed` | Seed default roles and permissions |
| `npm run db:studio` | Open Prisma Studio visual database browser |

## Next Steps

- [Architecture overview](architecture.md) — system diagram, key directories, and data flow
- [Contributing guide](contributing.md) — how to add routes, pages, and submit PRs
- [RBAC developer reference](rbac.md) — how to protect routes with permissions
