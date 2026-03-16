# Architecture — Developer Reference

This document describes the system architecture of DocFlow Platform as of Milestone 4 (Enterprise Integration & Security). For a higher-level product overview see [`docs/architecture.md`](../architecture.md).

## System Overview

DocFlow Platform is a client-server web application composed of three tiers:

```
┌──────────────────────────────────────────────────┐
│                  Browser (SPA)                   │
│  React 18 + React Router v6                      │
│  Vite dev server  :5173                          │
│  /api/* → proxy → backend :3000                  │
└──────────────────────┬───────────────────────────┘
                       │  HTTP / JSON
┌──────────────────────▼───────────────────────────┐
│               Express API  :3000                 │
│                                                  │
│  routes/ → middleware/auth → middleware/rbac      │
│         → controllers/ → services/               │
│                                                  │
│  File storage: backend/uploads/                  │
│  Background jobs: inline (pipelineService)       │
└──────────────────────┬───────────────────────────┘
                       │  Prisma ORM
┌──────────────────────▼───────────────────────────┐
│           PostgreSQL database                    │
│  Users, Roles, Permissions, Documents,           │
│  RoutingRules, ApprovalWorkflows, AuditLogs      │
└──────────────────────────────────────────────────┘
```

## Key Directories

### `backend/`

| Path | Purpose |
|:-----|:--------|
| `src/index.js` | Entry point — loads `.env`, starts Express on `$PORT` (default 3000) |
| `src/app.js` | Express app setup — mounts middleware and route handlers |
| `src/db/client.js` | Prisma client singleton shared across the process |
| `routes/` | Route definitions — thin layer that maps HTTP verbs/paths to controllers |
| `controllers/` | Request handlers — parse input, call services, send responses |
| `middleware/auth.js` | JWT verification — attaches `req.user` |
| `middleware/rbac.js` | Permission enforcement — exports `requirePermission()` |
| `services/` | Business logic modules (see below) |
| `prisma/schema.prisma` | Database schema source of truth |
| `prisma/seed.js` | Seeds built-in roles and permissions |
| `prisma/migrations/` | Ordered migration history — never edit merged migrations |
| `__tests__/` | Test suite (Node built-in test runner) |
| `uploads/` | Uploaded document files (gitignored in production) |

**Route files:**

| File | Mounted at | Description |
|:-----|:-----------|:------------|
| `routes/health.js` | `GET /health` | Liveness probe |
| `routes/auth.js` | `/api/auth` | Register, login, LDAP, SSO callbacks |
| `routes/documents.js` | `/api/documents` | Upload, list, retrieve, download |
| `routes/approvals.js` | `/api/approvals` | Approval workflow actions |
| `routes/routingRules.js` | `/api/routing-rules` | Routing rule CRUD |
| `routes/admin.js` | `/api/admin` | User, role, permission management |

**Services:**

| Service | Responsibility |
|:--------|:---------------|
| `pipelineService.js` | Orchestrates the full document processing pipeline |
| `metadataExtractor.js` | Extracts metadata (title, author, page count, type) from uploaded files |
| `formatValidator.js` | Validates document formatting against configured rules |
| `docxFormatter.js` | Applies standard formatting to DOCX documents |
| `coverSheetGenerator.js` | Generates cover sheets from document metadata |
| `routingEngine.js` | Matches documents to routing rules and assigns approval queues |
| `workflowService.js` | Manages ApprovalWorkflow state transitions |
| `notificationService.js` | Sends email notifications via nodemailer |
| `ldapService.js` | LDAP/Active Directory authentication |
| `ssoService.js` | SAML 2.0 and OIDC authentication |

### `frontend/`

| Path | Purpose |
|:-----|:--------|
| `src/main.jsx` | React entry point — mounts `<App />` to `#root` |
| `src/App.jsx` | React Router setup — defines all client-side routes |
| `src/pages/` | Page components (one file per route) |
| `vite.config.js` | Dev-server config — proxies `/api/*` to `http://localhost:3000` |

**Client-side routes:**

| Path | Component | Access |
|:-----|:----------|:-------|
| `/` | — | Redirects to `/dashboard` |
| `/login` | `Login` | Public |
| `/dashboard` | `Dashboard` | Authenticated |
| `/documents` | `Documents` | Authenticated |
| `/documents/:id` | `DocumentDetail` | Authenticated |
| `/approvals` | `ApprovalQueue` | Authenticated |
| `/approvals/:workflowId` | `ApprovalReview` | Authenticated |
| `/admin/routing-rules` | `RoutingRulesAdmin` | Admin only |

## Data Flow: Document Upload → Audit Log

```
Client
  │
  │  POST /api/documents  (multipart/form-data)
  ▼
routes/documents.js
  │  authenticate  →  requirePermission('documents:write')
  ▼
controllers/documentController.js
  │  multer saves file to uploads/
  │
  ├─► metadataExtractor   — title, author, pageCount, docType
  │
  ├─► formatValidator     — produces ValidationReport record
  │
  ├─► docxFormatter       — applies standard formatting (DOCX only)
  │
  ├─► coverSheetGenerator — attaches cover sheet
  │
  ├─► prisma.document.create / update
  │
  └─► routingEngine       — matches RoutingRules → assigns queue
        │
        └─► workflowService  — creates ApprovalWorkflow + ApprovalSteps
              │
              └─► notificationService — emails assigned approvers
                    │
                    └─► [Approver acts] → workflowService.advance()
                          │
                          └─► prisma.auditLog.create  (every state change)
```

## Auth Layers

Every authenticated request passes through two middleware layers before reaching a controller:

```
Request
  │
  ▼
middleware/auth.js  (authenticate)
  │  jwt.verify(token, JWT_SECRET)
  │  prisma.user.findUnique()  ← resolves roleId
  │  attaches req.user = { userId, email, role, roleId }
  │
  ▼
middleware/rbac.js  (requirePermission)
  │  if req.user.role === 'admin' → bypass (superadmin)
  │  else: check rolePermissions cache (TTL 60s)
  │        cache miss → prisma.rolePermission.findMany()
  │  403 if permission absent
  │
  ▼
Controller
```

**Authentication methods** (all produce a JWT on success):

| Method | Handled by | Notes |
|:-------|:-----------|:------|
| Local (email + password) | `authController.js` | bcryptjs password hash |
| LDAP / Active Directory | `ldapService.js` | Disabled when `LDAP_URL` is unset |
| SAML 2.0 / OIDC | `ssoService.js` | Configured via env vars |

The JWT payload is `{ userId, email, role, roleId }` and expires after `JWT_EXPIRES_IN` (default `8h`). The frontend stores the token in `localStorage` and attaches it as `Authorization: Bearer <token>` on every API request.

See [`docs/dev/rbac.md`](rbac.md) for how to protect new routes with permissions.

## Database Schema Overview

The Prisma schema at `backend/prisma/schema.prisma` is the source of truth. Key model relationships:

```
User ──── roleId ────► Role ◄──── RolePermission ────► Permission

User ──► Document ──► DocumentMetadata
                  ──► ValidationReport
                  ──► RoutingRule (matched by routingEngine)
                  ──► ApprovalWorkflow ──► ApprovalStep[]
```

**Enums:**

| Enum | Values |
|:-----|:-------|
| `RoutingStatus` | `unrouted`, `queued`, `in_approval`, `approved`, `rejected` |
| `WorkflowStatus` | `pending`, `approved`, `rejected`, `changes_requested` |
| `StepAction` | `approved`, `rejected`, `changes_requested` |

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR to `main`:

| Job | Node | Steps |
|:----|:-----|:------|
| `backend` | 20 | `npm ci` → `npm test` |
| `frontend` | 20 | `npm ci` → `npm run lint` → `npm run build` → `npm test` |

Both jobs use npm dependency caching.
