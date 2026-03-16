'use strict';

/**
 * Webhook management endpoints (authenticated, user-scoped).
 *
 * POST   /api/webhooks               — register a webhook
 * GET    /api/webhooks               — list user webhooks
 * DELETE /api/webhooks/:id           — remove a webhook
 * GET    /api/webhooks/:id/deliveries — list last 50 delivery attempts
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { authenticate } = require('../middleware/auth');
const prisma = require('../src/db/client');

const router = express.Router();
router.use(authenticate);

const VALID_EVENTS = [
  'document.submitted',
  'document.approved',
  'document.rejected',
  'document.assigned',
  'document.escalated',
];

// ─── POST /api/webhooks ───────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { url, events, secret } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required.' });
  }
  try {
    new URL(url); // validate URL format
  } catch {
    return res.status(400).json({ error: 'url must be a valid URL.' });
  }
  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({ error: 'events must be a non-empty array.' });
  }
  const invalidEvents = events.filter((e) => !VALID_EVENTS.includes(e));
  if (invalidEvents.length > 0) {
    return res.status(400).json({
      error: `Unknown event types: ${invalidEvents.join(', ')}. Valid types: ${VALID_EVENTS.join(', ')}`,
    });
  }
  if (!secret || typeof secret !== 'string' || secret.length < 16) {
    return res.status(400).json({ error: 'secret must be at least 16 characters.' });
  }

  try {
    const webhook = await prisma.webhook.create({
      data: {
        id: uuidv4(),
        userId: req.user.userId,
        url,
        events,
        secret,
        active: true,
      },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        createdAt: true,
      },
    });
    return res.status(201).json(webhook);
  } catch (err) {
    console.error('[Webhooks] POST error:', err);
    return res.status(500).json({ error: 'Failed to create webhook.' });
  }
});

// ─── GET /api/webhooks ────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { userId: req.user.userId },
      select: {
        id: true,
        url: true,
        events: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(webhooks);
  } catch (err) {
    console.error('[Webhooks] GET error:', err);
    return res.status(500).json({ error: 'Failed to list webhooks.' });
  }
});

// ─── DELETE /api/webhooks/:id ─────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const webhook = await prisma.webhook.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found.' });
    }
    await prisma.webhook.delete({ where: { id: req.params.id } });
    return res.status(204).send();
  } catch (err) {
    console.error('[Webhooks] DELETE error:', err);
    return res.status(500).json({ error: 'Failed to delete webhook.' });
  }
});

// ─── GET /api/webhooks/:id/deliveries ─────────────────────────────────────────
router.get('/:id/deliveries', async (req, res) => {
  try {
    const webhook = await prisma.webhook.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found.' });
    }
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhookId: req.params.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        event: true,
        statusCode: true,
        attemptCount: true,
        deliveredAt: true,
        createdAt: true,
      },
    });
    return res.json(deliveries);
  } catch (err) {
    console.error('[Webhooks] GET deliveries error:', err);
    return res.status(500).json({ error: 'Failed to list deliveries.' });
  }
});

module.exports = router;
