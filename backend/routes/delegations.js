'use strict';

/**
 * Delegation routes — /api/delegations
 *
 * Endpoints:
 *   POST   /api/delegations            — create a delegation (self or admin)
 *   GET    /api/delegations            — list delegations (admin: all; user: own)
 *   DELETE /api/delegations/:id        — revoke a delegation (admin or own delegation)
 */

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const prisma = require('../src/db/client');
const { createDelegation, revokeDelegation } = require('../services/delegationService');
const { logEvent } = require('../services/auditLog');
const { sendDocumentAssigned } = require('../services/email');
const { notifyAssigned } = require('../services/inAppNotification');

// ─── POST /api/delegations ─────────────────────────────────────────────────────
// Create a delegation.  The authenticated user must have documents:approve
// permission (i.e. be an approver) or be an admin.
// Body: { delegateId, startDate, endDate }

router.post('/', authenticate, requirePermission('documents:approve'), async (req, res) => {
  const { delegateId, startDate, endDate } = req.body;

  if (!delegateId || !startDate || !endDate) {
    return res.status(400).json({ error: 'delegateId, startDate, and endDate are required' });
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return res.status(400).json({ error: 'startDate and endDate must be valid ISO date strings' });
  }

  try {
    const delegation = await createDelegation({
      delegatorId: req.user.id,
      delegateId,
      startDate: start,
      endDate: end,
    });

    // Log the delegation creation
    try {
      logEvent({
        actorUserId: req.user.id,
        action: 'delegation.created',
        targetType: 'approval_delegation',
        targetId: delegation.id,
        metadata: { delegateId, startDate: start, endDate: end },
        ipAddress: req.ip || null,
      });
    } catch {}

    // Email both parties — use document.assigned template for delegate, custom message for delegator
    setImmediate(async () => {
      try {
        await sendDocumentAssigned(delegation.delegate.email, {
          id: delegation.id,
          title: `Delegation of approval authority from ${delegation.delegator.email}`,
        }, delegateId);
      } catch (err) {
        console.error('[Delegations] Failed to email delegate:', err.message);
      }
      try {
        await notifyAssigned(delegateId, {
          id: delegation.id,
          title: `You have been delegated approval authority by ${delegation.delegator.email} (${startDate} – ${endDate})`,
        });
      } catch (err) {
        console.error('[Delegations] Failed to notify delegate in-app:', err.message);
      }
      // Notify delegator of confirmation
      try {
        await sendDocumentAssigned(delegation.delegator.email, {
          id: delegation.id,
          title: `Your approval authority is delegated to ${delegation.delegate.email} (${startDate} – ${endDate})`,
        }, req.user.id);
      } catch (err) {
        console.error('[Delegations] Failed to email delegator:', err.message);
      }
    });

    res.status(201).json(delegation);
  } catch (err) {
    const statusMap = {
      INVALID_DELEGATE: 400,
      INVALID_DATES: 400,
      NOT_FOUND: 404,
      INVALID_DELEGATE_ROLE: 422,
      CIRCULAR_DELEGATION: 422,
      DELEGATION_CONFLICT: 409,
    };
    const status = statusMap[err.code] || 500;
    if (status < 500) return res.status(status).json({ error: err.message });
    console.error('[Delegations] POST / error:', err);
    res.status(500).json({ error: 'Failed to create delegation' });
  }
});

// ─── GET /api/delegations ──────────────────────────────────────────────────────
// Admins see all delegations; regular users see only their own (as delegator or delegate).
// Query params: active=true limits to currently active (not revoked, within date range).

router.get('/', authenticate, async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const now = new Date();
    const { active } = req.query;

    const where = {};

    if (!isAdmin) {
      // Scope to delegations involving the current user
      where.OR = [
        { delegatorId: req.user.id },
        { delegateId: req.user.id },
      ];
    }

    if (active === 'true') {
      where.revokedAt = null;
      where.startDate = { lte: now };
      where.endDate = { gte: now };
    }

    const delegations = await prisma.approvalDelegation.findMany({
      where,
      include: {
        delegator: { select: { id: true, email: true } },
        delegate: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(delegations);
  } catch (err) {
    console.error('[Delegations] GET / error:', err);
    res.status(500).json({ error: 'Failed to list delegations' });
  }
});

// ─── DELETE /api/delegations/:id ──────────────────────────────────────────────
// Revoke a delegation.  Admins may revoke any delegation; owners may revoke their own.

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const delegation = await prisma.approvalDelegation.findUnique({
      where: { id: req.params.id },
    });
    if (!delegation) {
      return res.status(404).json({ error: 'Delegation not found' });
    }

    const isAdmin = req.user.role === 'admin';
    const isOwner = delegation.delegatorId === req.user.id;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const revoked = await revokeDelegation(req.params.id, req.user.id);

    try {
      logEvent({
        actorUserId: req.user.id,
        action: 'delegation.revoked',
        targetType: 'approval_delegation',
        targetId: req.params.id,
        metadata: { delegatorId: delegation.delegatorId, delegateId: delegation.delegateId },
        ipAddress: req.ip || null,
      });
    } catch {}

    res.json(revoked);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'ALREADY_REVOKED') return res.status(409).json({ error: err.message });
    console.error('[Delegations] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to revoke delegation' });
  }
});

module.exports = router;
