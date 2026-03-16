'use strict';

const prisma = require('../src/db/client');

// In-memory permission cache: roleId -> { permissions: Set<string>, expiresAt: number }
const permissionCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

async function getPermissionsForRole(roleId) {
  const now = Date.now();
  const cached = permissionCache.get(roleId);
  if (cached && cached.expiresAt > now) {
    return cached.permissions;
  }

  const rolePermissions = await prisma.rolePermission.findMany({
    where: { roleId },
    include: { permission: true },
  });

  const permissions = new Set(rolePermissions.map((rp) => rp.permission.name));
  permissionCache.set(roleId, { permissions, expiresAt: now + CACHE_TTL_MS });
  return permissions;
}

function invalidateRoleCache(roleId) {
  if (roleId) {
    permissionCache.delete(roleId);
  } else {
    permissionCache.clear();
  }
}

function requirePermission(permissionName) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(403).json({ error: 'Forbidden', required: permissionName });
    }

    // Superadmin bypass
    if (req.user.role === 'admin') {
      return next();
    }

    const { roleId } = req.user;
    if (!roleId) {
      return res.status(403).json({ error: 'Forbidden', required: permissionName });
    }

    try {
      const permissions = await getPermissionsForRole(roleId);
      if (permissions.has(permissionName)) {
        return next();
      }
      return res.status(403).json({ error: 'Forbidden', required: permissionName });
    } catch (err) {
      console.error('[RBAC] Permission lookup error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

module.exports = { requirePermission, invalidateRoleCache };
