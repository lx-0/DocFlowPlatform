# Contributing Guide

This document covers the development workflow and the step-by-step checklists for common contribution patterns: adding a new API route, and adding a new frontend page.

For local setup instructions see [getting-started.md](getting-started.md). For architecture context see [architecture.md](architecture.md).

## Branch Workflow

- `main` is the stable branch. All work goes through pull requests — never commit directly to `main`.
- Branch naming convention:
  - `feat/<short-description>` — new features
  - `fix/<short-description>` — bug fixes
  - `docs/<short-description>` — documentation changes
  - `chore/<short-description>` — maintenance, dependency bumps, tooling
- Keep branches short-lived and focused on a single concern.

## Commit Messages

Use the imperative present tense with a type prefix:

```
feat: add CSV export endpoint for audit logs
fix: correct JWT expiry calculation in authController
docs: document LDAP role mapping in getting-started guide
chore: upgrade Prisma to v7.6
refactor: extract document metadata logic into service
test: add unit tests for routingEngine
```

Keep the subject line under 72 characters. Add a body if the change needs explanation.

## Pull Request Process

1. Create a branch from `main`.
2. Make atomic, well-described commits.
3. Run checks locally before pushing (see [getting-started.md — Running CI Checks Locally](getting-started.md#running-ci-checks-locally)).
4. Open a PR against `main` with:
   - A title that follows the commit message style above.
   - A body describing **what** changed and **why**.
   - Links to any related issues.
5. PRs require at least one approval before merge.
6. Squash or rebase to keep the main history clean — avoid merge commits.

---

## How to Add a New API Route

Follow this checklist to add a protected backend endpoint end-to-end.

### 1. Add the route handler

In the appropriate file under `backend/routes/` (or create a new one):

```js
// backend/routes/reports.js
const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const reportsController = require('../controllers/reportsController');

// GET /api/reports
router.get('/', authenticate, requirePermission('reports:read'), reportsController.list);

module.exports = router;
```

**Rules:**
- Always chain `authenticate` before `requirePermission`. See [docs/dev/rbac.md](rbac.md) for the full permission model.
- Choose the right permission (or add a new one — see the RBAC guide).

### 2. Mount the router in `app.js`

```js
// backend/src/app.js
const reportsRouter = require('../routes/reports');
app.use('/api/reports', reportsRouter);
```

### 3. Write the controller

```js
// backend/controllers/reportsController.js
const prisma = require('../db/client');

exports.list = async (req, res) => {
  try {
    const reports = await prisma.someModel.findMany({ where: { ... } });
    res.json(reports);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
```

Put business logic in a service (`backend/services/`) and call it from the controller — keep controllers thin.

### 4. Add an audit log entry (for state-changing operations)

For any write operation (create, update, delete, approval action), log it:

```js
await prisma.auditLog.create({
  data: {
    action: 'report.created',
    userId: req.user.userId,
    resourceId: newReport.id,
    metadata: { ... },
  },
});
```

### 5. Write tests

Add a test file under `backend/__tests__/` covering the happy path and key error cases:

```js
// backend/__tests__/reports.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
// ...
```

### 6. Update the API reference

- If this is an internal route: update [`docs/api-reference.md`](../api-reference.md).
- If this is a public (`/api/v1/`) route: update [`docs/api/rest-api.md`](../api/rest-api.md).

### Checklist summary

- [ ] Route file with `authenticate` + `requirePermission`
- [ ] Router mounted in `app.js`
- [ ] Controller (thin) + service (business logic)
- [ ] Audit log entry for writes
- [ ] Tests written
- [ ] API reference updated

---

## How to Add a New Frontend Page

### 1. Create the page component

```jsx
// frontend/src/pages/Reports.jsx
import { useEffect, useState } from 'react';

export default function Reports() {
  const [data, setData] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    fetch('/api/reports', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then(setData);
  }, []);

  return (
    <div>
      <h1>Reports</h1>
      {/* ... */}
    </div>
  );
}
```

### 2. Add a role guard

If the page should only be accessible to specific roles, redirect on mount:

```jsx
import { useNavigate } from 'react-router-dom';

export default function Reports() {
  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }
    // Optionally decode token to check role:
    // const { role } = JSON.parse(atob(token.split('.')[1]));
    // if (role !== 'admin') navigate('/dashboard');
  }, [navigate]);

  // ...
}
```

### 3. Register the route in `App.jsx`

```jsx
// frontend/src/App.jsx
import Reports from './pages/Reports';

// Inside <Routes>:
<Route path="/reports" element={<Reports />} />
```

### 4. Add a nav link

Add an entry to the sidebar or navigation component so users can reach the page.

### 5. Write tests

Add a test for the page component covering rendering and access control behavior.

### Checklist summary

- [ ] Page component created in `frontend/src/pages/`
- [ ] Role guard implemented (redirect to `/login` or `/dashboard` if unauthorised)
- [ ] Route registered in `App.jsx`
- [ ] Nav link added
- [ ] Tests written

---

## Database Migrations

When you change `backend/prisma/schema.prisma`:

```bash
cd backend
npm run db:migrate:dev
```

Commit both the schema change and the generated migration directory. **Never edit migration files after they have been merged to `main`.**

If your migration adds a new permission, update `prisma/seed.js` and re-seed:

```bash
npm run db:seed
```

## Code Style

- Follow existing patterns in each file — there is no dedicated formatter config beyond ESLint for the frontend.
- No unused imports or `console.log` statements in committed code (use `console.error` for error paths).
- Use descriptive variable and function names.
- Backend: CommonJS (`require` / `module.exports`). Frontend: ES modules (`import` / `export`).
