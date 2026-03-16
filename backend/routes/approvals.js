'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const prisma = require('../src/db/client');
const { actOnStep } = require('../services/workflowService');
const { logEvent } = require('../services/auditLog');

// GET /api/approvals — list workflows where any step is assigned to current user,
// or (if no steps assigned) all pending workflows visible to the user's queue access.
router.get('/', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const workflows = await prisma.approvalWorkflow.findMany({
      where: {
        status: 'pending',
        steps: {
          some: {
            OR: [
              { assignedToUserId: userId },
              { assignedToUserId: null },
            ],
          },
        },
      },
      include: {
        steps: true,
        document: {
          include: {
            metadata: true,
            uploadedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(workflows);
  } catch (err) {
    console.error('[Approvals] GET / error:', err);
    res.status(500).json({ error: 'Failed to list approval workflows' });
  }
});

// GET /api/approvals/:workflowId — full workflow detail with steps
router.get('/:workflowId', authenticate, async (req, res) => {
  try {
    const workflow = await prisma.approvalWorkflow.findUnique({
      where: { id: req.params.workflowId },
      include: {
        steps: { orderBy: { stepNumber: 'asc' } },
        document: {
          include: {
            metadata: true,
            uploadedBy: { select: { id: true, name: true, email: true } },
          },
        },
      },
    });
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    res.json(workflow);
  } catch (err) {
    console.error('[Approvals] GET /:workflowId error:', err);
    res.status(500).json({ error: 'Failed to fetch workflow' });
  }
});

// POST /api/approvals/:workflowId/act — submit approver decision
// Body: { stepNumber, action, comment }
router.post('/:workflowId/act', authenticate, requirePermission('documents:approve'), async (req, res) => {
  const { stepNumber, action, comment } = req.body;
  const validActions = ['approved', 'rejected', 'changes_requested'];

  if (typeof stepNumber !== 'number' || !validActions.includes(action)) {
    return res.status(400).json({ error: 'stepNumber (number) and action (approved|rejected|changes_requested) are required' });
  }

  try {
    const workflow = await actOnStep(
      req.params.workflowId,
      stepNumber,
      req.user.id,
      action,
      comment ?? null
    );
    try {
      const auditAction = `document.${action}`; // document.approved | document.rejected | document.changes_requested
      logEvent({ actorUserId: req.user.userId || null, action: auditAction, targetType: 'approval_workflow', targetId: req.params.workflowId, metadata: { stepNumber, comment: comment ?? null, documentId: workflow.documentId }, ipAddress: req.ip || null });
    } catch {}
    res.json(workflow);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'INVALID_STATE') return res.status(409).json({ error: err.message });
    if (err.code === 'INVALID_STEP') return res.status(400).json({ error: err.message });
    console.error('[Approvals] POST /:workflowId/act error:', err);
    res.status(500).json({ error: 'Failed to process approval action' });
  }
});

module.exports = router;
