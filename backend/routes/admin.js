'use strict';

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { authenticate } = require('../middleware/auth');
const { requirePermission, invalidateRoleCache } = require('../middleware/rbac');
const prisma = require('../src/db/client');
const { logEvent } = require('../services/auditLog');
const { getVolumeStats, getApprovalTimeStats, getRejectionRate, getBottleneckQueues, getBottleneckApprovers } = require('../services/analytics');
const { encrypt, getSmtpConfig, getTemplate, readFileTemplate, EVENT_TYPES, DEFAULT_SUBJECTS } = require('../services/emailConfig');

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

// ─── Analytics (/api/admin/analytics) ────────────────────────────────────────

router.get('/analytics/volume', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const data = await getVolumeStats({ from, to });
    res.json(data);
  } catch (err) {
    console.error('[Admin] GET /analytics/volume error:', err);
    res.status(500).json({ error: 'Failed to fetch volume stats' });
  }
});

router.get('/analytics/approval-time', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const data = await getApprovalTimeStats({ from, to });
    res.json(data);
  } catch (err) {
    console.error('[Admin] GET /analytics/approval-time error:', err);
    res.status(500).json({ error: 'Failed to fetch approval time stats' });
  }
});

router.get('/analytics/rejection-rate', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const data = await getRejectionRate({ from, to });
    res.json(data);
  } catch (err) {
    console.error('[Admin] GET /analytics/rejection-rate error:', err);
    res.status(500).json({ error: 'Failed to fetch rejection rate stats' });
  }
});

router.get('/analytics/bottlenecks', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const from = req.query.from ? new Date(req.query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(req.query.to) : new Date();
    const thresholdHours = parseFloat(process.env.ANALYTICS_BOTTLENECK_THRESHOLD_HOURS) || 48;
    const thresholdMs = thresholdHours * 60 * 60 * 1000;

    const [queues, approvers] = await Promise.all([
      getBottleneckQueues({ from, to, threshold: thresholdMs }),
      getBottleneckApprovers({ from, to, threshold: thresholdMs }),
    ]);

    res.json({ thresholdHours, queues, approvers });
  } catch (err) {
    console.error('[Admin] GET /analytics/bottlenecks error:', err);
    res.status(500).json({ error: 'Failed to fetch bottleneck data' });
  }
});

router.get('/analytics/export', authenticate, requirePermission('admin:users'), async (req, res) => {
  const { format, from, to } = req.query;

  if (!format || !['csv', 'pdf'].includes(format)) {
    return res.status(400).json({ error: 'format must be "csv" or "pdf"' });
  }

  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const toDate = to ? new Date(to) : new Date();
  const fromStr = fromDate.toISOString().slice(0, 10);
  const toStr = toDate.toISOString().slice(0, 10);
  const filename = `docflow-report-${fromStr}-${toStr}.${format}`;

  try {
    const [volumeRows, approvalTimeRows, rejectionRateRows] = await Promise.all([
      getVolumeStats({ from: fromDate, to: toDate }),
      getApprovalTimeStats({ from: fromDate, to: toDate }),
      getRejectionRate({ from: fromDate, to: toDate }),
    ]);

    // Build a combined map keyed by date
    const dateSet = new Set([
      ...volumeRows.map(r => r.date),
      ...approvalTimeRows.map(r => r.date),
      ...rejectionRateRows.map(r => r.date),
    ]);
    const approvalMap = new Map(approvalTimeRows.map(r => [r.date, r.avgApprovalTimeMs]));
    const rejectionMap = new Map(rejectionRateRows.map(r => [r.date, r.rejectionRate]));
    const volumeMap = new Map(volumeRows.map(r => [r.date, r]));

    const rows = [...dateSet].sort().map(date => {
      const v = volumeMap.get(date) || { submitted: 0, approved: 0, rejected: 0 };
      const avgMs = approvalMap.get(date);
      const rej = rejectionMap.get(date);
      return {
        date,
        submitted: v.submitted,
        approved: v.approved,
        rejected: v.rejected,
        avgApprovalDays: avgMs != null ? (avgMs / 86400000).toFixed(2) : '',
        rejectionRatePct: rej != null ? (rej * 100).toFixed(1) : '',
      };
    });

    if (format === 'csv') {
      const header = 'Date,Submitted,Approved,Rejected,AvgApprovalDays,RejectionRate%\n';
      const body = rows.map(r =>
        `${r.date},${r.submitted},${r.approved},${r.rejected},${r.avgApprovalDays},${r.rejectionRatePct}`
      ).join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(header + body);
    }

    // PDF
    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Title
    doc.fontSize(20).font('Helvetica-Bold').text('DocFlow Analytics Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica').text(`Date range: ${fromStr} to ${toStr}`, { align: 'center' });
    doc.moveDown(1.5);

    // Summary stats
    const totalSubmitted = rows.reduce((s, r) => s + r.submitted, 0);
    const totalApproved = rows.reduce((s, r) => s + r.approved, 0);
    const totalRejected = rows.reduce((s, r) => s + r.rejected, 0);
    const totalDecided = totalApproved + totalRejected;
    const overallRejRate = totalDecided > 0 ? ((totalRejected / totalDecided) * 100).toFixed(1) : 'N/A';
    const approvalTimeSamples = approvalTimeRows.filter(r => r.avgApprovalTimeMs != null);
    const overallAvgDays = approvalTimeSamples.length > 0
      ? (approvalTimeSamples.reduce((s, r) => s + r.avgApprovalTimeMs, 0) / approvalTimeSamples.length / 86400000).toFixed(2)
      : 'N/A';

    doc.fontSize(13).font('Helvetica-Bold').text('Summary');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Total Submitted:       ${totalSubmitted}`);
    doc.text(`Total Approved:        ${totalApproved}`);
    doc.text(`Total Rejected:        ${totalRejected}`);
    doc.text(`Overall Rejection Rate: ${overallRejRate}%`);
    doc.text(`Avg Approval Time:     ${overallAvgDays} days`);
    doc.moveDown(1.5);

    // Daily breakdown table
    doc.fontSize(13).font('Helvetica-Bold').text('Daily Breakdown');
    doc.moveDown(0.5);

    const colWidths = [80, 65, 65, 65, 100, 100];
    const headers = ['Date', 'Submitted', 'Approved', 'Rejected', 'Avg Approval (days)', 'Rejection Rate %'];
    const startX = 50;
    let y = doc.y;

    // Table header
    doc.fontSize(9).font('Helvetica-Bold');
    let x = startX;
    headers.forEach((h, i) => {
      doc.text(h, x, y, { width: colWidths[i], lineBreak: false });
      x += colWidths[i];
    });
    y += 16;
    doc.moveTo(startX, y).lineTo(startX + colWidths.reduce((a, b) => a + b, 0), y).stroke();
    y += 4;

    // Table rows
    doc.font('Helvetica').fontSize(9);
    for (const r of rows) {
      if (y > doc.page.height - 80) {
        doc.addPage();
        y = 50;
      }
      x = startX;
      const cells = [r.date, r.submitted, r.approved, r.rejected, r.avgApprovalDays || 'N/A', r.rejectionRatePct ? `${r.rejectionRatePct}%` : 'N/A'];
      cells.forEach((cell, i) => {
        doc.text(String(cell), x, y, { width: colWidths[i], lineBreak: false });
        x += colWidths[i];
      });
      y += 14;
    }

    doc.end();
  } catch (err) {
    console.error('[Admin] GET /analytics/export error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to generate export' });
    }
  }
});

// ─── Escalations dashboard (/api/admin/escalations) ──────────────────────────

// GET /api/admin/escalations — list currently escalated approval steps
router.get('/escalations', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const steps = await prisma.approvalStep.findMany({
      where: {
        escalatedAt: { not: null },
        action: null, // step not yet acted upon
      },
      include: {
        workflow: {
          include: {
            document: {
              include: {
                metadata: true,
                uploadedBy: { select: { id: true, email: true } },
              },
            },
          },
        },
      },
      orderBy: { escalatedAt: 'desc' },
    });

    const result = steps.map(step => ({
      stepId: step.id,
      workflowId: step.workflowId,
      stepNumber: step.stepNumber,
      escalatedAt: step.escalatedAt,
      startedAt: step.startedAt,
      backupApproverUserId: step.assignedToUserId,
      document: {
        id: step.workflow.document.id,
        title: step.workflow.document?.metadata?.title || step.workflow.document.originalFilename,
        uploadedBy: step.workflow.document.uploadedBy,
        routingStatus: step.workflow.document.routingStatus,
      },
      workflowStatus: step.workflow.status,
      queueName: step.workflow.queueName,
    }));

    res.json(result);
  } catch (err) {
    console.error('[Admin] GET /escalations error:', err);
    res.status(500).json({ error: 'Failed to fetch escalated documents' });
  }
});

// ─── System Settings (/api/admin/settings) ───────────────────────────────────

function buildSettingsResponse(map) {
  return {
    documentRetentionDays: map.documentRetentionDays != null ? parseInt(map.documentRetentionDays, 10) : 365,
    auditLogRetentionDays: map.auditLogRetentionDays != null ? parseInt(map.auditLogRetentionDays, 10) : 90,
    lastPurgeAt: map.lastPurgeAt || null,
    lastPurgeDocumentsArchived: map.lastPurgeDocumentsArchived != null ? parseInt(map.lastPurgeDocumentsArchived, 10) : null,
    lastPurgeLogsDeleted: map.lastPurgeLogsDeleted != null ? parseInt(map.lastPurgeLogsDeleted, 10) : null,
    // SMTP settings — smtpPass is masked; never returned in plaintext
    smtpHost: map['smtp.host'] || '',
    smtpPort: map['smtp.port'] ? parseInt(map['smtp.port'], 10) : null,
    smtpUser: map['smtp.user'] || '',
    smtpPass: map['smtp.pass'] ? '*****' : '',
    smtpFromAddress: map['smtp.fromAddress'] || '',
    smtpFromName: map['smtp.fromName'] || '',
  };
}

router.get('/settings', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const rows = await prisma.systemConfig.findMany();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json(buildSettingsResponse(map));
  } catch (err) {
    console.error('[Admin] GET /settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

router.patch('/settings', authenticate, requirePermission('admin:users'), async (req, res) => {
  const {
    documentRetentionDays,
    auditLogRetentionDays,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    smtpFromAddress,
    smtpFromName,
  } = req.body;

  const updates = [];
  const smtpChanged = [];

  if (documentRetentionDays !== undefined) {
    const val = parseInt(documentRetentionDays, 10);
    if (isNaN(val) || val < 0) {
      return res.status(400).json({ error: 'documentRetentionDays must be a non-negative integer' });
    }
    updates.push({ key: 'documentRetentionDays', value: String(val) });
  }

  if (auditLogRetentionDays !== undefined) {
    const val = parseInt(auditLogRetentionDays, 10);
    if (isNaN(val) || val < 1) {
      return res.status(400).json({ error: 'auditLogRetentionDays must be a positive integer' });
    }
    updates.push({ key: 'auditLogRetentionDays', value: String(val) });
  }

  if (smtpHost !== undefined) {
    updates.push({ key: 'smtp.host', value: String(smtpHost) });
    smtpChanged.push('smtpHost');
  }
  if (smtpPort !== undefined) {
    const port = parseInt(smtpPort, 10);
    if (isNaN(port) || port < 1 || port > 65535) {
      return res.status(400).json({ error: 'smtpPort must be a valid port number (1–65535)' });
    }
    updates.push({ key: 'smtp.port', value: String(port) });
    smtpChanged.push('smtpPort');
  }
  if (smtpUser !== undefined) {
    updates.push({ key: 'smtp.user', value: String(smtpUser) });
    smtpChanged.push('smtpUser');
  }
  // Only update smtpPass if a non-masked value is provided
  if (smtpPass !== undefined && smtpPass !== '*****') {
    updates.push({ key: 'smtp.pass', value: smtpPass ? encrypt(smtpPass) : '' });
    smtpChanged.push('smtpPass');
  }
  if (smtpFromAddress !== undefined) {
    updates.push({ key: 'smtp.fromAddress', value: String(smtpFromAddress) });
    smtpChanged.push('smtpFromAddress');
  }
  if (smtpFromName !== undefined) {
    updates.push({ key: 'smtp.fromName', value: String(smtpFromName) });
    smtpChanged.push('smtpFromName');
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid settings provided' });
  }

  try {
    await Promise.all(
      updates.map(({ key, value }) =>
        prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } })
      )
    );

    const auditMeta = Object.fromEntries(
      updates
        .filter(({ key }) => key !== 'smtp.pass') // never log encrypted pass
        .map(({ key, value }) => [key, value])
    );
    if (smtpChanged.length > 0) auditMeta['smtp_fields_changed'] = smtpChanged;

    logEvent({
      actorUserId: req.user.userId,
      action: smtpChanged.length > 0 ? 'system.smtp_config_changed' : 'system.config_changed',
      targetType: 'system_config',
      targetId: 'settings',
      metadata: auditMeta,
      ipAddress: req.ip || null,
    });

    const rows = await prisma.systemConfig.findMany();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    res.json(buildSettingsResponse(map));
  } catch (err) {
    console.error('[Admin] PATCH /settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ─── Test email (/api/admin/settings/test-email) ─────────────────────────────

router.post('/settings/test-email', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: { email: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const config = await getSmtpConfig();
    if (!config.host || !config.user || !config.pass) {
      return res.status(422).json({ error: 'SMTP is not configured. Please save SMTP settings first.' });
    }

    const fromStr = config.fromName
      ? `"${config.fromName}" <${config.fromAddress}>`
      : config.fromAddress;

    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      auth: { user: config.user, pass: config.pass },
    });

    await transporter.sendMail({
      from: fromStr,
      to: user.email,
      subject: 'DocFlow — SMTP Test Email',
      text: 'This is a test email from DocFlow to verify your SMTP configuration is working correctly.',
      html: `<p>This is a test email from <strong>DocFlow</strong> to verify your SMTP configuration is working correctly.</p>`,
    });

    res.json({ ok: true, sentTo: user.email });
  } catch (err) {
    console.error('[Admin] POST /settings/test-email error:', err);
    res.status(500).json({ error: err.message || 'Failed to send test email' });
  }
});

// ─── Notification templates (/api/admin/notification-templates) ───────────────

router.get('/notification-templates', authenticate, requirePermission('admin:users'), async (req, res) => {
  try {
    const templates = await Promise.all(
      EVENT_TYPES.map(async (eventType) => {
        const { subject, body, isCustomized } = await getTemplate(eventType);
        const fileHtml = body === null ? readFileTemplate(eventType).html : null;
        return {
          eventType,
          subject,
          body: body !== null ? body : fileHtml,
          isCustomized,
        };
      })
    );
    res.json(templates);
  } catch (err) {
    console.error('[Admin] GET /notification-templates error:', err);
    res.status(500).json({ error: 'Failed to fetch notification templates' });
  }
});

router.patch('/notification-templates/:eventType', authenticate, requirePermission('admin:users'), async (req, res) => {
  const { eventType } = req.params;
  if (!EVENT_TYPES.includes(eventType)) {
    return res.status(400).json({ error: `Invalid eventType. Must be one of: ${EVENT_TYPES.join(', ')}` });
  }

  const { subject, body } = req.body;
  if (subject === undefined && body === undefined) {
    return res.status(400).json({ error: 'At least one of subject or body is required' });
  }

  const updates = [];
  if (subject !== undefined) updates.push({ key: `template.${eventType}.subject`, value: String(subject) });
  if (body !== undefined) updates.push({ key: `template.${eventType}.body`, value: String(body) });

  try {
    await Promise.all(
      updates.map(({ key, value }) =>
        prisma.systemConfig.upsert({ where: { key }, update: { value }, create: { key, value } })
      )
    );

    const { subject: updatedSubject, body: updatedBody } = await getTemplate(eventType);
    const fileHtml = updatedBody === null ? readFileTemplate(eventType).html : null;

    res.json({
      eventType,
      subject: updatedSubject,
      body: updatedBody !== null ? updatedBody : fileHtml,
      isCustomized: true,
    });
  } catch (err) {
    console.error('[Admin] PATCH /notification-templates/:eventType error:', err);
    res.status(500).json({ error: 'Failed to update notification template' });
  }
});

module.exports = router;
