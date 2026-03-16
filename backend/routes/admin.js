'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission, invalidateRoleCache } = require('../middleware/rbac');
const prisma = require('../src/db/client');

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

module.exports = router;
