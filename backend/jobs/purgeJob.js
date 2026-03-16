'use strict';

/**
 * Nightly document and audit log purge job (runs at 03:00 server time).
 *
 * - Soft-deletes documents whose routingStatus is `approved` or `rejected` and
 *   whose createdAt is older than `documentRetentionDays` (sets deletedAt).
 *   Set documentRetentionDays = 0 to disable document purging.
 * - Hard-deletes AuditLog records older than `auditLogRetentionDays`.
 * - Logs a summary AuditLog entry when done.
 *
 * Register this job at startup by calling `register()`.
 * Export `runPurge(now?)` for testing.
 */

const cron = require('node-cron');
const prisma = require('../src/db/client');
const { logEvent } = require('../services/auditLog');

const DEFAULT_DOCUMENT_RETENTION_DAYS = 365;
const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 90;

async function getRetentionSettings() {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: ['documentRetentionDays', 'auditLogRetentionDays'] } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    documentRetentionDays:
      map.documentRetentionDays != null
        ? parseInt(map.documentRetentionDays, 10)
        : DEFAULT_DOCUMENT_RETENTION_DAYS,
    auditLogRetentionDays:
      map.auditLogRetentionDays != null
        ? parseInt(map.auditLogRetentionDays, 10)
        : DEFAULT_AUDIT_LOG_RETENTION_DAYS,
  };
}

/**
 * Run the purge for the given reference time.
 * Exported so tests can call it with a mocked date.
 *
 * @param {Date} [now] - Reference time (defaults to Date.now())
 */
async function runPurge(now = new Date()) {
  console.log(`[PurgeJob] Starting purge run at ${now.toISOString()}`);

  const { documentRetentionDays, auditLogRetentionDays } = await getRetentionSettings();

  // ── Soft-delete eligible documents ──────────────────────────────────────────
  let documentsArchived = 0;

  if (documentRetentionDays > 0) {
    const docCutoff = new Date(now.getTime() - documentRetentionDays * 24 * 60 * 60 * 1000);
    const result = await prisma.document.updateMany({
      where: {
        routingStatus: { in: ['approved', 'rejected'] },
        createdAt: { lt: docCutoff },
        deletedAt: null,
      },
      data: { deletedAt: now },
    });
    documentsArchived = result.count;
    console.log(`[PurgeJob] Soft-deleted ${documentsArchived} document(s) older than ${documentRetentionDays} days`);
  } else {
    console.log('[PurgeJob] Document purging disabled (documentRetentionDays = 0)');
  }

  // ── Hard-delete old audit logs ───────────────────────────────────────────────
  const logCutoff = new Date(now.getTime() - auditLogRetentionDays * 24 * 60 * 60 * 1000);
  const deleted = await prisma.auditLog.deleteMany({
    where: { createdAt: { lt: logCutoff } },
  });
  const logsDeleted = deleted.count;
  console.log(`[PurgeJob] Hard-deleted ${logsDeleted} audit log record(s) older than ${auditLogRetentionDays} days`);

  // ── Persist purge stats in SystemConfig ─────────────────────────────────────
  await Promise.all([
    prisma.systemConfig.upsert({
      where: { key: 'lastPurgeAt' },
      update: { value: now.toISOString() },
      create: { key: 'lastPurgeAt', value: now.toISOString() },
    }),
    prisma.systemConfig.upsert({
      where: { key: 'lastPurgeDocumentsArchived' },
      update: { value: String(documentsArchived) },
      create: { key: 'lastPurgeDocumentsArchived', value: String(documentsArchived) },
    }),
    prisma.systemConfig.upsert({
      where: { key: 'lastPurgeLogsDeleted' },
      update: { value: String(logsDeleted) },
      create: { key: 'lastPurgeLogsDeleted', value: String(logsDeleted) },
    }),
  ]);

  // ── Log summary audit event ──────────────────────────────────────────────────
  logEvent({
    actorUserId: null,
    action: 'system.purge_run',
    targetType: 'system',
    targetId: 'purge',
    metadata: { documentsArchived, logsDeleted },
  });

  console.log(`[PurgeJob] Done. archived=${documentsArchived}, logsDeleted=${logsDeleted}`);
  return { documentsArchived, logsDeleted };
}

function register() {
  // Run at 03:00 every night
  cron.schedule('0 3 * * *', async () => {
    try {
      await runPurge(new Date());
    } catch (err) {
      console.error('[PurgeJob] Error during purge run:', err);
    }
  });
  console.log('[PurgeJob] Scheduled nightly purge at 03:00');
}

module.exports = { register, runPurge };
