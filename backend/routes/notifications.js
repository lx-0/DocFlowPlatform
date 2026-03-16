'use strict';

/**
 * In-app notification endpoints (authenticated, user-scoped).
 *
 * GET    /api/notifications              — list user notifications (unread first, max 50)
 *                                          supports ?unreadOnly=true
 * GET    /api/notifications/unread-count — { count } for badge display
 * PATCH  /api/notifications/:id/read    — mark single notification read
 * POST   /api/notifications/read-all    — mark all notifications read
 * GET    /api/notifications/preferences — get user notification preferences
 * PATCH  /api/notifications/preferences — bulk update notification preferences
 */

const express = require('express');
const { authenticate } = require('../middleware/auth');
const prisma = require('../src/db/client');
const { getUserPreferences, updateUserPreferences } = require('../services/notificationPreferences');

const router = express.Router();
router.use(authenticate);

// ─── GET /api/notifications ───────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const userId = req.user.userId;
  const unreadOnly = req.query.unreadOnly === 'true';

  try {
    const where = { userId, ...(unreadOnly ? { readAt: null } : {}) };

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: [
        { readAt: 'asc' },   // unread (null) sorts first in asc
        { createdAt: 'desc' },
      ],
      take: 50,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        linkUrl: true,
        readAt: true,
        createdAt: true,
      },
    });

    return res.json(notifications);
  } catch (err) {
    console.error('[Notifications] GET / error:', err);
    return res.status(500).json({ error: 'Failed to list notifications.' });
  }
});

// ─── GET /api/notifications/preferences ──────────────────────────────────────
router.get('/preferences', async (req, res) => {
  try {
    const prefs = await getUserPreferences(req.user.userId);
    return res.json(prefs);
  } catch (err) {
    console.error('[Notifications] GET /preferences error:', err);
    return res.status(500).json({ error: 'Failed to get notification preferences.' });
  }
});

// ─── PATCH /api/notifications/preferences ────────────────────────────────────
router.patch('/preferences', async (req, res) => {
  const updates = req.body;
  if (!Array.isArray(updates)) {
    return res.status(400).json({ error: 'Expected an array of preference updates.' });
  }
  const valid = updates.every(
    u =>
      typeof u.eventType === 'string' &&
      typeof u.emailEnabled === 'boolean' &&
      typeof u.inAppEnabled === 'boolean',
  );
  if (!valid) {
    return res.status(400).json({ error: 'Each entry must have eventType (string), emailEnabled (boolean), inAppEnabled (boolean).' });
  }
  try {
    await updateUserPreferences(req.user.userId, req.user.role, updates);
    const prefs = await getUserPreferences(req.user.userId);
    return res.json(prefs);
  } catch (err) {
    console.error('[Notifications] PATCH /preferences error:', err);
    return res.status(500).json({ error: 'Failed to update notification preferences.' });
  }
});

// ─── GET /api/notifications/unread-count ─────────────────────────────────────
// Must be registered before /:id routes to avoid parameter collision
router.get('/unread-count', async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.userId, readAt: null },
    });
    return res.json({ count });
  } catch (err) {
    console.error('[Notifications] GET /unread-count error:', err);
    return res.status(500).json({ error: 'Failed to get unread count.' });
  }
});

// ─── POST /api/notifications/read-all ────────────────────────────────────────
router.post('/read-all', async (req, res) => {
  try {
    const now = new Date();
    await prisma.notification.updateMany({
      where: { userId: req.user.userId, readAt: null },
      data: { readAt: now },
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error('[Notifications] POST /read-all error:', err);
    return res.status(500).json({ error: 'Failed to mark all notifications read.' });
  }
});

// ─── PATCH /api/notifications/:id/read ───────────────────────────────────────
router.patch('/:id/read', async (req, res) => {
  try {
    const notification = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found.' });
    }
    const updated = await prisma.notification.update({
      where: { id: req.params.id },
      data: { readAt: notification.readAt ?? new Date() },
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        linkUrl: true,
        readAt: true,
        createdAt: true,
      },
    });
    return res.json(updated);
  } catch (err) {
    console.error('[Notifications] PATCH /:id/read error:', err);
    return res.status(500).json({ error: 'Failed to mark notification read.' });
  }
});

module.exports = router;
