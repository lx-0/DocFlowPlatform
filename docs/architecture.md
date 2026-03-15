# DocFlow Platform — Architecture

## Overview

DocFlow Platform is a client-server web application that automates document formatting, routing, and approval for enterprise workflows. It is structured as:

- a **React** single-page application (SPA) served by Vite
- a **Node.js / Express** REST API
- a **PostgreSQL** database accessed via the Prisma ORM

```
┌─────────────────────────────────┐
│         Browser (SPA)           │
│  React + React Router v6        │
│  Vite dev server :5173          │
│  /api/* → proxy → :3000         │
└──────────────┬──────────────────┘
               │ HTTP / JSON
┌──────────────▼──────────────────┐
│      Express API  :3000          │
│  routes → controllers           │
│  JWT middleware                 │
└──────────────┬──────────────────┘
               │ Prisma ORM
┌──────────────▼──────────────────┐
│     PostgreSQL database          │
└─────────────────────────────────┘
```

## Component Map

### Frontend (`frontend/`)

| File | Role |
|:-----|:-----|
| `src/main.jsx` | React entry point — mounts `<App />` to `#root` |
| `src/App.jsx` | React Router setup — defines all client-side routes |
| `src/pages/Login.jsx` | Email/password login form; stores JWT in `localStorage` |
| `src/pages/Dashboard.jsx` | Authenticated dashboard stub; sidebar + stats layout |
| `vite.config.js` | Dev-server config; proxies `/api/*` to `http://localhost:3000` |

**Client-side routes:**

| Path | Component | Notes |
|:-----|:----------|:------|
| `/` | — | Redirects to `/dashboard` |
| `/login` | `Login` | Public |
| `/dashboard` | `Dashboard` | Requires valid token in `localStorage` |

### Backend (`backend/`)

| File | Role |
|:-----|:-----|
| `src/index.js` | Loads env vars, starts Express server |
| `src/app.js` | Configures middleware, mounts route handlers |
| `routes/health.js` | `GET /health` |
| `routes/auth.js` | `POST /api/auth/register`, `POST /api/auth/login` |
| `controllers/authController.js` | Registration and login business logic |
| `controllers/healthController.js` | Health check response |
| `middleware/auth.js` | JWT verification; attaches `req.user` |
| `src/db/client.js` | Prisma singleton — shared across the process |
| `prisma/schema.prisma` | Database schema source of truth |

### Database

Current schema (Milestone 1):

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String
  role         String   @default("user")
  createdAt    DateTime @default(now())

  @@map("users")
}
```

## Authentication Flow

```
Client                         Backend                       Database
  │                               │                              │
  │  POST /api/auth/register      │                              │
  │  { email, password }          │                              │
  │──────────────────────────────>│                              │
  │                               │  bcryptjs.hash(password)     │
  │                               │  prisma.user.create()        │
  │                               │─────────────────────────────>│
  │  201 { message }              │                              │
  │<──────────────────────────────│                              │
  │                               │                              │
  │  POST /api/auth/login         │                              │
  │  { email, password }          │                              │
  │──────────────────────────────>│                              │
  │                               │  prisma.user.findUnique()    │
  │                               │─────────────────────────────>│
  │                               │  bcryptjs.compare()          │
  │                               │  jwt.sign({ userId, email,   │
  │                               │    role }, secret, 8h)       │
  │  200 { token }                │                              │
  │<──────────────────────────────│                              │
  │                               │                              │
  │  GET /api/* (protected)       │                              │
  │  Authorization: Bearer <jwt>  │                              │
  │──────────────────────────────>│                              │
  │                               │  jwt.verify() → req.user     │
  │  200 ...                      │                              │
  │<──────────────────────────────│                              │
```

The JWT payload contains `{ userId, email, role }` and expires after **8 hours**. The token is stored in `localStorage` on the client.

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request to `main`:

| Job | Steps |
|:----|:------|
| `backend` | `npm ci` → `npm test --if-present` |
| `frontend` | `npm ci` → `npm run lint` → `npm run build` → `npm test --if-present` |

Both jobs use Node 20 with npm dependency caching.

## Milestones

| # | Milestone | Status | Key deliverables |
|:--|:----------|:-------|:-----------------|
| M1 | Foundation & Infrastructure | **active** | Repo, auth, DB schema, CI |
| M2 | Document Ingestion & Formatting Engine | planned | Upload, PDF/DOCX parse, format rules |
| M3 | Routing & Approval Workflow | planned | Multi-step approval chains |
| M4 | Enterprise Integration & Security | planned | SSO/LDAP, RBAC hardening |
| M5 | Analytics & Reporting | planned | Processing dashboard, bottleneck detection |
