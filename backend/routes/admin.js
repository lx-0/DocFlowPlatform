'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission, invalidateRoleCache } = require('../middleware/rbac');
const prisma = require('../src/db/client');
const { logEvent } = require('../services/auditLog');

// All admin routes require authentication first

// ─── User Management (/api/admin/users) ──────────────────────────────────────

router.get('/users', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true, roleId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(users);
  } catch (err) {
    console.error('[Admin] GET /users error:', err);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

router.patch('/users/:id/role', authenticate, requirePermission('admin:users'), async (req, res) => {
  const { roleId } = req.body;
  if (!roleId) {
    return res.status(400).json({ error: 'roleId is required' });
  }
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { roleId },
      select: { id: true, email: true, role: true, roleId: true },
    });
    invalidateRoleCache(roleId);
    try {
      logEvent({ actorUserId: req.user.userId, action: 'user.role_changed', targetType: 'user', targetId: req.params.id, metadata: { newRoleId: roleId }, ipAddress: req.ip || null });
    } catch {}
    res.json(user);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'User not found' });
    console.error('[Admin] PATCH /users/:id/role error:', err);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

// ─── Role Management (/api/admin/roles) ──────────────────────────────────────

router.get('/roles', authenticate, requirePermission('admin:roles'), async (req, res) => {
  try {
    const roles = await prisma.role.findMany({
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(roles);
  } catch (err) {
    console.error('[Admin] GET /roles error:', err);
    res.status(500).json({ error: 'Failed to list roles' });
  }
});

router.post('/roles', authenticate, requirePermission('admin:roles'), async (req, res) => {
  const { name, description, permissionIds } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const role = await prisma.role.create({
      data: {
        name,
        description,
        permissions: permissionIds
          ? { create: permissionIds.map((permissionId) => ({ permissionId })) }
          : undefined,
      },
      include: { permissions: { include: { permission: true } } },
    });
    res.status(201).json(role);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Role name already exists' });
    console.error('[Admin] POST /roles error:', err);
    res.status(500).json({ error: 'Failed to create role' });
  }
});

router.patch('/roles/:id', authenticate, requirePermission('admin:roles'), async (req, res) => {
  const { name, description } = req.body;
  try {
    const role = await prisma.role.update({
      where: { id: req.params.id },
      data: { name, description },
    });
    invalidateRoleCache(req.params.id);
    res.json(role);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Role not found' });
    console.error('[Admin] PATCH /roles/:id error:', err);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

// ─── Audit Logs (/api/admin/audit-logs) ──────────────────────────────────────

router.get('/audit-logs', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const { actorUserId, action, from, to, page = '1', limit = '50' } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where = {};
    if (actorUserId) where.actorUserId = actorUserId;
    if (action) where.action = action;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ logs, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('[Admin] GET /audit-logs error:', err);
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

module.exports = router;
