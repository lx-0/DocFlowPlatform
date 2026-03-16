# RBAC Developer Reference

This document explains how to use the Role-Based Access Control (RBAC) system when building or modifying backend routes in DocFlow Platform.

## Overview

The RBAC system is split across two middleware files:

- [`backend/middleware/auth.js`](../../backend/middleware/auth.js) — JWT authentication; attaches `req.user` to the request
- [`backend/middleware/rbac.js`](../../backend/middleware/rbac.js) — Permission enforcement; exports `requirePermission()`

The Prisma schema defining the `Role`, `Permission`, and `RolePermission` models lives in [`backend/prisma/schema.prisma`](../../backend/prisma/schema.prisma). Built-in roles and permissions are seeded from [`backend/prisma/seed.js`](../../backend/prisma/seed.js).

## Protecting a Route

Every protected route must first run `authenticate`, then `requirePermission`:

```js
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');

router.get(
  '/some-resource',
  authenticate,
  requirePermission('documents:read'),
  async (req, res) => {
    // req.user is guaranteed to exist and have permission
  }
);
```

`authenticate` verifies the JWT and attaches `req.user = { userId, email, role, roleId }`.
`requirePermission(name)` then checks whether the authenticated user holds the named permission.

**Always call `authenticate` before `requirePermission`.** `requirePermission` returns `403 Forbidden` immediately if `req.user` is not set.

## Permission Names

| Permission | What it protects |
|:-----------|:----------------|
| `documents:read` | Routes that list or return document data |
| `documents:write` | Routes that create or modify documents |
| `documents:approve` | Routes that advance approval workflows |
| `admin:users` | Routes that list users or change user role assignments |
| `admin:roles` | Routes that list, create, or update roles |

Use these exact string values as the argument to `requirePermission()`. Adding a new permission requires inserting a row in the `permissions` table (or updating `seed.js`) and assigning it to the relevant roles via `role_permissions`.

## Superadmin Bypass

Users whose JWT contains `role: 'admin'` skip all permission checks:

```js
// backend/middleware/rbac.js:41
if (req.user.role === 'admin') {
  return next();
}
```

This is the legacy `role` string field on the `users` table (distinct from the RBAC `roleId` foreign key). Assigning a user the built-in `admin` role via seeding sets this field. Do not rely on this bypass for new logic — prefer explicit permissions for clarity and auditability.

## Permission Caching

`requirePermission` uses an in-memory cache to avoid a database round-trip on every request:

- **Cache key:** `roleId`
- **Cached value:** `Set<permissionName>` for that role
- **TTL:** 60 seconds (`CACHE_TTL_MS = 60 * 1000`)

After the TTL expires, the next request for that role re-fetches from the database via `prisma.rolePermission.findMany`.

### Invalidating the Cache

When you modify a role's permissions at runtime, call `invalidateRoleCache`:

```js
const { invalidateRoleCache } = require('../middleware/rbac');

// Invalidate a specific role
invalidateRoleCache(roleId);

// Invalidate everything (e.g. after bulk permission changes)
invalidateRoleCache();
```

The admin routes in [`backend/routes/admin.js`](../../backend/routes/admin.js) already call this after role and user-role updates.

## Database Schema

```prisma
model Role {
  id          String           @id @default(uuid())
  name        String           @unique
  description String?
  users       User[]
  permissions RolePermission[]
}

model Permission {
  id          String           @id @default(uuid())
  name        String           @unique
  description String?
  roles       RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id])
  permission   Permission @relation(fields: [permissionId], references: [id])

  @@id([roleId, permissionId])
}
```

A `User` has an optional `roleId` FK pointing to `Role`. The legacy `role` string field is still present for the superadmin bypass but should not be used for new permission logic.

## Example: Adding a New Permission

1. Insert the permission in `seed.js`:

   ```js
   { name: 'reports:read', description: 'View analytics reports' }
   ```

2. Assign it to the relevant roles in `ROLES`:

   ```js
   { name: 'approver', permissions: ['documents:read', 'documents:approve', 'reports:read'] }
   ```

3. Re-run the seed: `npm run db:seed`

4. Use it in your route:

   ```js
   router.get('/reports', authenticate, requirePermission('reports:read'), handler);
   ```
