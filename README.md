# DocFlow Platform

[![CI](https://github.com/lx-0/DocFlowPlatform/actions/workflows/ci.yml/badge.svg)](https://github.com/lx-0/DocFlowPlatform/actions/workflows/ci.yml)

An internal documentation workflow platform that automates formatting, routing, and approval processes for recurring enterprise paperwork.

## Overview

DocFlow Platform ensures consistent formatting conventions (including proper cover sheets) and eliminates document chaos by providing:

- **Document Ingestion & Formatting** — Upload PDF/DOCX files and apply standard formatting rules automatically
- **Cover Sheet Generation** — Auto-generate cover sheets from document metadata
- **Routing & Approval Workflows** — Route documents to the correct approvers with multi-step approval chains
- **Enterprise Integration** — SSO/LDAP, RBAC, and full audit trail
- **Analytics & Reporting** — Dashboard for processing volumes, approval times, and bottleneck detection

## Tech Stack

- **Backend**: Node.js / Express
- **Database**: PostgreSQL with Prisma ORM
- **Frontend**: React
- **Authentication**: JWT-based (local email/password, LDAP/Active Directory, SAML 2.0/OIDC SSO)
- **CI**: GitHub Actions

## Getting Started

### Prerequisites

- Node.js >= 18
- PostgreSQL >= 14

### Backend setup

```bash
cd backend
npm install
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET
npm run db:generate
npm run db:migrate:dev
npm run dev
```

Server runs at `http://localhost:3000`. See [`backend/README.md`](backend/README.md) for full details.

### Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Dev server runs at `http://localhost:5173` and proxies `/api/*` to the backend. See [`frontend/README.md`](frontend/README.md) for full details.

## Project Structure

```
docflow-platform/
├── backend/        # Node.js/Express API
├── frontend/       # React application
├── docs/           # Project documentation
└── .github/        # GitHub Actions workflows
```

## Milestones

| # | Milestone | Status |
|:--|:----------|:-------|
| M1 | Foundation & Infrastructure | active |
| M2 | Document Ingestion & Formatting Engine | planned |
| M3 | Routing & Approval Workflow | planned |
| M4 | Enterprise Integration & Security | planned |
| M5 | Analytics & Reporting | planned |

## Documentation

| Document | Description |
|:---------|:------------|
| [docs/architecture.md](docs/architecture.md) | System design, component relationships, and data flow |
| [docs/api-reference.md](docs/api-reference.md) | Full REST API reference |
| [docs/contributing.md](docs/contributing.md) | Contribution guide and PR workflow |
| [docs/admin/rbac.md](docs/admin/rbac.md) | RBAC admin guide — managing users, roles, and permissions |
| [docs/admin/sso.md](docs/admin/sso.md) | SSO setup guide — SAML 2.0 and OIDC configuration |
| [docs/admin/ldap.md](docs/admin/ldap.md) | LDAP/Active Directory integration guide |
| [docs/admin/auth-modes.md](docs/admin/auth-modes.md) | Auth mode reference — `local`, `ldap`, and `sso` frontend modes |
| [docs/dev/rbac.md](docs/dev/rbac.md) | RBAC developer reference — middleware usage and permission model |
| [docs/admin/audit-logs.md](docs/admin/audit-logs.md) | Audit log admin guide — events captured, access, and compliance reporting |
| [docs/api/rest-api.md](docs/api/rest-api.md) | Public REST API reference — external integration endpoints (`/api/v1/`) |
| [docs/api/api-key-management.md](docs/api/api-key-management.md) | API key management — generating, listing, and revoking keys |

## API Integration

External systems can submit documents, poll status, and download results using the public REST API secured by API keys.

| Resource | Description |
|:---------|:------------|
| [docs/api/rest-api.md](docs/api/rest-api.md) | Endpoint reference, request/response examples, rate limiting, error codes, and end-to-end integration walkthrough |
| [docs/api/api-key-management.md](docs/api/api-key-management.md) | How admins generate, list, and revoke API keys; security best practices |

**Quick start:**

1. An admin generates an API key at `/admin/api-keys`.
2. Include the key as `Authorization: ApiKey <key>` on all requests.
3. `POST /api/v1/documents` to submit a file, poll `GET /api/v1/documents/:id` for status, then `GET /api/v1/documents/:id/download` once complete.

## Contributing

See [docs/contributing.md](docs/contributing.md) for contribution guidelines and the PR workflow.

---

_DocFlow Systems — Enterprise Documentation Standardization_
