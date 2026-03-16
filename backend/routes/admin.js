'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
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

// ─── API Key Management (/api/admin/api-keys) ─────────────────────────────────

// Generate a new API key — returns plaintext once, stores hash
router.post('/api-keys', authenticate, requirePermission('admin:users'), async (req, res) => {
  const { label } = req.body;
  if (!label || !label.trim()) {
    return res.status(400).json({ error: 'label is required' });
  }

  try {
    const rawKey = `dfk_${uuidv4().replace(/-/g, '')}`;
    const keyHash = await bcrypt.hash(rawKey, 12);

    const apiKey = await prisma.apiKey.create({
      data: {
        id: uuidv4(),
        userId: req.user.userId,
        keyHash,
        label: label.trim(),
      },
      select: { id: true, label: true, createdAt: true, userId: true },
    });

    try {
      logEvent({ actorUserId: req.user.userId, action: 'apikey.created', targetType: 'api_key', targetId: apiKey.id, ipAddress: req.ip || null });
    } catch {}

    res.status(201).json({ ...apiKey, key: rawKey });
  } catch (err) {
    console.error('[Admin] POST /api-keys error:', err);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// List all API keys — never returns plaintext key
router.get('/api-keys', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const keys = await prisma.apiKey.findMany({
      select: { id: true, label: true, userId: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(keys);
  } catch (err) {
    console.error('[Admin] GET /api-keys error:', err);
    res.status(500).json({ error: 'Failed to list API keys' });
  }
});

// Revoke an API key
router.delete('/api-keys/:id', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const key = await prisma.apiKey.findUnique({ where: { id: req.params.id } });
    if (!key) return res.status(404).json({ error: 'API key not found' });
    if (key.revokedAt) return res.status(409).json({ error: 'API key already revoked' });

    await prisma.apiKey.update({
      where: { id: req.params.id },
      data: { revokedAt: new Date() },
    });

    try {
      logEvent({ actorUserId: req.user.userId, action: 'apikey.revoked', targetType: 'api_key', targetId: req.params.id, ipAddress: req.ip || null });
    } catch {}

    res.status(204).end();
  } catch (err) {
    console.error('[Admin] DELETE /api-keys/:id error:', err);
    res.status(500).json({ error: 'Failed to revoke API key' });
  }
});

module.exports = router;
