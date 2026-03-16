# RBAC Admin Guide

This guide covers user and role management for DocFlow Platform administrators.

## Prerequisites

You must be logged in as a user with the `admin` role (the built-in superadmin) or a custom role that has both the `admin:users` and `admin:roles` permissions.

## Admin Pages

> **Note:** The `/admin/users` and `/admin/roles` frontend pages are implemented as part of the RBAC Admin UI (DOCA-32). Until that work ships, all administration must be performed via the REST API described below.

### User Management — `/admin/users`

This page lists all registered users and allows you to change their assigned role.

**What you can do:**
- View all users (email, current role, role assignment)
- Change any user's role by selecting a new role from the dropdown

### Role Management — `/admin/roles`

This page lists all roles with their associated permissions and allows you to create or edit custom roles.

**What you can do:**
- View built-in and custom roles with their permission sets
- Create a new custom role with a name, optional description, and a set of permissions
- Edit the name or description of an existing role

## Built-in Roles

These roles are seeded automatically when you run `npm run db:seed` (see [`backend/prisma/seed.js`](../../backend/prisma/seed.js)).

| Role | Description | Permissions |
|:-----|:------------|:-----------|
| `admin` | Full system access (superadmin) | `documents:read`, `documents:write`, `documents:approve`, `admin:users`, `admin:roles` |
| `approver` | Can review and approve documents | `documents:read`, `documents:approve` |
| `submitter` | Can upload and submit documents | `documents:read`, `documents:write` |
| `viewer` | Read-only access to documents | `documents:read` |

**Important:** A user with the `admin` role bypasses all permission checks entirely. This is the superadmin bypass — assigning the `admin` role grants unrestricted access regardless of what permissions are attached to that role in the database.

## Permission Reference

| Permission | What it protects |
|:-----------|:----------------|
| `documents:read` | View and download documents |
| `documents:write` | Upload and create new documents |
| `documents:approve` | Approve or reject documents in approval workflows |
| `admin:users` | View user list; change user role assignments |
| `admin:roles` | View, create, and edit roles |

## Assigning a Role to a User (API)

Until the admin UI is available, use the REST API directly:

```bash
# List users (find the user id)
curl -H "Authorization: Bearer <token>" /api/admin/users

# Assign a role
curl -X PATCH /api/admin/users/<userId>/role \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"roleId": "<roleId>"}'
```

To find role IDs:

```bash
curl -H "Authorization: Bearer <token>" /api/admin/roles
```

## Notes on Existing Users

When the database is seeded, any existing user with no `roleId` assigned is automatically updated to the `submitter` role. This ensures backward compatibility with accounts created before RBAC was introduced.
