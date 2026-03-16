'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const prisma = require('../src/db/client');
const { actOnStep } = require('../services/workflowService');
const { logEvent } = require('../services/auditLog');
const { getLatestVersion } = require('../services/documentVersionService');

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

// GET /api/approvals/:workflowId — full workflow detail with steps and current version
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
    // Attach current version info so approvers know which version they're acting on
    try {
      const latestVersion = await getLatestVersion(workflow.documentId);
      if (latestVersion) workflow.currentVersion = latestVersion;
    } catch {}
    res.json(workflow);
  } catch (err) {
    console.error('[Approvals] GET /:workflowId error:', err);
    res.status(500).json({ error: 'Failed to fetch workflow' });
  }
});

// POST /api/approvals/bulk-act — bulk approve or reject multiple workflows
// Body: { workflowIds: string[], action: 'approved'|'rejected', comment: string }
router.post('/bulk-act', authenticate, requirePermission('documents:approve'), async (req, res) => {
  const { workflowIds, action, comment } = req.body;
  const validActions = ['approved', 'rejected'];

  if (!Array.isArray(workflowIds) || workflowIds.length === 0) {
    return res.status(400).json({ error: 'workflowIds must be a non-empty array' });
  }
  if (workflowIds.length > 50) {
    return res.status(400).json({ error: 'Bulk operations are limited to 50 documents per request' });
  }
  if (!validActions.includes(action)) {
    return res.status(400).json({ error: 'action must be "approved" or "rejected"' });
  }
  if (!comment || typeof comment !== 'string' || !comment.trim()) {
    return res.status(400).json({ error: 'comment is required for bulk actions' });
  }

  // Load admin-configured document types excluded from bulk approval
  let excludedTypes = [];
  try {
    const config = await prisma.systemConfig.findUnique({ where: { key: 'bulk_approval_excluded_types' } });
    if (config && config.value) excludedTypes = JSON.parse(config.value);
  } catch {}

  const results = [];
  for (const workflowId of workflowIds) {
    try {
      const wf = await prisma.approvalWorkflow.findUnique({
        where: { id: workflowId },
        include: { document: { include: { metadata: true } } },
      });
      if (!wf) {
        results.push({ workflowId, success: false, error: 'Workflow not found' });
        continue;
      }

      const docType = wf.document?.metadata?.documentType;
      if (docType && excludedTypes.includes(docType)) {
        results.push({ workflowId, success: false, error: `Document type "${docType}" is not eligible for bulk approval` });
        continue;
      }

      const workflow = await actOnStep(workflowId, wf.currentStep, req.user.id, action, comment);

      // Individual audit log entry per document (not a shared bulk entry)
      try {
        const auditMeta = { stepNumber: wf.currentStep, comment, documentId: wf.documentId, bulk: true };
        try {
          const latestVersion = await getLatestVersion(wf.documentId);
          if (latestVersion) auditMeta.versionId = latestVersion.id;
        } catch {}
        logEvent({
          actorUserId: req.user.id || req.user.userId || null,
          action: `document.${action}`,
          targetType: 'approval_workflow',
          targetId: workflowId,
          metadata: auditMeta,
          ipAddress: req.ip || null,
        });
      } catch {}

      results.push({ workflowId, success: true });
    } catch (err) {
      let error = 'Failed to process action';
      if (err.code === 'NOT_FOUND') error = err.message;
      else if (err.code === 'INVALID_STATE') error = err.message;
      else if (err.code === 'INVALID_STEP') error = err.message;
      results.push({ workflowId, success: false, error });
    }
  }

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  res.json({ results, succeeded, failed });
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
      const auditAction = `document.${action}`;
      const auditMeta = { stepNumber, comment: comment ?? null, documentId: workflow.documentId };
      try {
        const latestVersion = await getLatestVersion(workflow.documentId);
        if (latestVersion) auditMeta.versionId = latestVersion.id;
      } catch {}
      logEvent({ actorUserId: req.user.id || req.user.userId || null, action: auditAction, targetType: 'approval_workflow', targetId: req.params.workflowId, metadata: auditMeta, ipAddress: req.ip || null });
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
