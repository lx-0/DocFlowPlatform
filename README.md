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
- **Authentication**: JWT-based (email + password; SSO in M4)
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

## Contributing

See [docs/contributing.md](docs/contributing.md) for contribution guidelines and the PR workflow.

---

_DocFlow Systems — Enterprise Documentation Standardization_
