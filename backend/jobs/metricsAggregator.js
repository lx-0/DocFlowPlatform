'use strict';

/**
 * Nightly metrics aggregation job (runs at 02:00 server time).
 *
 * Reads AuditLog and Document records from the past 24 hours and upserts:
 *   - DocumentMetric  – per-document lifecycle timestamps
 *   - ApproverMetric  – daily rollup per approver
 *   - QueueMetric     – daily rollup per routing queue
 *
 * Register this job at startup by calling `register()`.
 */

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../src/db/client');

// ─── Aggregation logic ────────────────────────────────────────────────────────

/**
 * Aggregate metrics for the window [windowStart, windowEnd).
 * Exported for testing — production callers use the cron schedule.
 *
 * @param {Date} windowStart
 * @param {Date} windowEnd
 */
async function aggregate(windowStart, windowEnd) {
  console.log(`[MetricsAggregator] Running for window ${windowStart.toISOString()} – ${windowEnd.toISOString()}`);

  await aggregateDocumentMetrics(windowStart, windowEnd);
  await aggregateApproverMetrics(windowStart, windowEnd);
  await aggregateQueueMetrics(windowStart, windowEnd);

  console.log('[MetricsAggregator] Done.');
}

// ─── Document metrics ─────────────────────────────────────────────────────────

async function aggregateDocumentMetrics(windowStart, windowEnd) {
  // Find documents created (submitted) in the window
  const documents = await prisma.document.findMany({
    where: { createdAt: { gte: windowStart, lt: windowEnd } },
    include: { approvalWorkflow: { include: { steps: true } } },
  });

  for (const doc of documents) {
    const wf = doc.approvalWorkflow;
    const submittedAt = doc.createdAt;

    // routedAt: when the document was first queued
    const routedAt = doc.routingStatus !== 'unrouted' ? doc.updatedAt : null;

    // firstReviewedAt: earliest actedAt across all steps
    const actedSteps = wf?.steps?.filter(s => s.actedAt) ?? [];
    const firstReviewedAt =
      actedSteps.length > 0
        ? actedSteps.reduce((min, s) => (s.actedAt < min ? s.actedAt : min), actedSteps[0].actedAt)
        : null;

    const approvedAt = wf?.status === 'approved' ? wf.updatedAt : null;
    const rejectedAt = wf?.status === 'rejected' ? wf.updatedAt : null;

    const processingTimeMs =
      approvedAt || rejectedAt
        ? ((approvedAt ?? rejectedAt).getTime() - submittedAt.getTime())
        : null;

    await prisma.documentMetric.upsert({
      where: { documentId: doc.id },
      create: {
        id: uuidv4(),
        documentId: doc.id,
        submittedAt,
        routedAt,
        firstReviewedAt,
        approvedAt,
        rejectedAt,
        processingTimeMs,
      },
      update: {
        routedAt,
        firstReviewedAt,
        approvedAt,
        rejectedAt,
        processingTimeMs,
      },
    });
  }
}

// ─── Approver metrics ─────────────────────────────────────────────────────────

async function aggregateApproverMetrics(windowStart, windowEnd) {
  // Look at approval steps acted on within the window
  const steps = await prisma.approvalStep.findMany({
    where: {
      actedAt: { gte: windowStart, lt: windowEnd },
      action: { not: null },
      assignedToUserId: { not: null },
    },
    include: { workflow: true },
  });

  // Group by (assignedToUserId, date)
  const byApproverDate = new Map();

  function key(userId, dt) {
    return `${userId}::${dt.toISOString().slice(0, 10)}`;
  }

  function ensure(userId, dt) {
    const k = key(userId, dt);
    if (!byApproverDate.has(k)) {
      byApproverDate.set(k, {
        approverId: userId,
        date: new Date(dt.toISOString().slice(0, 10) + 'T00:00:00.000Z'),
        assigned: 0,
        approved: 0,
        rejected: 0,
        responseTimes: [],
      });
    }
    return byApproverDate.get(k);
  }

  for (const step of steps) {
    const bucket = ensure(step.assignedToUserId, step.actedAt);
    bucket.assigned += 1;
    if (step.action === 'approved') bucket.approved += 1;
    if (step.action === 'rejected') bucket.rejected += 1;

    // Response time: from workflow creation to step action
    if (step.actedAt && step.workflow?.createdAt) {
      bucket.responseTimes.push(step.actedAt.getTime() - step.workflow.createdAt.getTime());
    }
  }

  for (const bucket of byApproverDate.values()) {
    const avgResponseTimeMs =
      bucket.responseTimes.length > 0
        ? Math.round(bucket.responseTimes.reduce((a, b) => a + b, 0) / bucket.responseTimes.length)
        : null;

    await prisma.approverMetric.upsert({
      where: { approverId_date: { approverId: bucket.approverId, date: bucket.date } },
      create: {
        id: uuidv4(),
        approverId: bucket.approverId,
        date: bucket.date,
        assigned: bucket.assigned,
        approved: bucket.approved,
        rejected: bucket.rejected,
        avgResponseTimeMs,
      },
      update: {
        assigned: bucket.assigned,
        approved: bucket.approved,
        rejected: bucket.rejected,
        avgResponseTimeMs,
      },
    });
  }
}

// ─── Queue metrics ────────────────────────────────────────────────────────────

async function aggregateQueueMetrics(windowStart, windowEnd) {
  // Documents routed in/out of queues within the window via AuditLog
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      createdAt: { gte: windowStart, lt: windowEnd },
      targetType: 'document',
      action: { in: ['document.routed', 'document.approved', 'document.rejected'] },
      metadata: { not: null },
    },
  });

  // Also look at workflows that completed in the window
  const workflows = await prisma.approvalWorkflow.findMany({
    where: {
      updatedAt: { gte: windowStart, lt: windowEnd },
      status: { in: ['approved', 'rejected'] },
    },
  });

  const byQueueDate = new Map();

  function dateStr(dt) {
    return dt.toISOString().slice(0, 10);
  }

  function key(queueId, dt) {
    return `${queueId}::${dateStr(dt)}`;
  }

  function ensure(queueId, dt) {
    const k = key(queueId, dt);
    if (!byQueueDate.has(k)) {
      byQueueDate.set(k, {
        queueId,
        date: new Date(dateStr(dt) + 'T00:00:00.000Z'),
        documentsIn: 0,
        documentsOut: 0,
        waitTimes: [],
      });
    }
    return byQueueDate.get(k);
  }

  // Count documents routed in
  for (const log of auditLogs) {
    if (log.action === 'document.routed' && log.metadata?.queueId) {
      ensure(log.metadata.queueId, log.createdAt).documentsIn += 1;
    }
  }

  // Count documents routed out (approved/rejected) and compute wait time
  for (const wf of workflows) {
    const queueId = wf.queueName;
    const bucket = ensure(queueId, wf.updatedAt);
    bucket.documentsOut += 1;

    // Wait time: from workflow creation to completion
    bucket.waitTimes.push(wf.updatedAt.getTime() - wf.createdAt.getTime());
  }

  for (const bucket of byQueueDate.values()) {
    const avgWaitTimeMs =
      bucket.waitTimes.length > 0
        ? Math.round(bucket.waitTimes.reduce((a, b) => a + b, 0) / bucket.waitTimes.length)
        : null;

    await prisma.queueMetric.upsert({
      where: { queueId_date: { queueId: bucket.queueId, date: bucket.date } },
      create: {
        id: uuidv4(),
        queueId: bucket.queueId,
        date: bucket.date,
        documentsIn: bucket.documentsIn,
        documentsOut: bucket.documentsOut,
        avgWaitTimeMs,
      },
      update: {
        documentsIn: bucket.documentsIn,
        documentsOut: bucket.documentsOut,
        avgWaitTimeMs,
      },
    });
  }
}

// ─── Scheduler registration ───────────────────────────────────────────────────

/**
 * Register the nightly metrics aggregation cron job.
 * Call once at application startup (src/index.js or app.js).
 */
function register() {
  // Run at 02:00 every night
  cron.schedule('0 2 * * *', async () => {
    const now = new Date();
    const windowEnd = new Date(now);
    windowEnd.setHours(0, 0, 0, 0); // midnight today (start of today)
    const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000); // 24h back

    try {
      await aggregate(windowStart, windowEnd);
    } catch (err) {
      console.error('[MetricsAggregator] Error during aggregation:', err);
    }
  });

  console.log('[MetricsAggregator] Nightly job registered (02:00 daily).');
}

module.exports = { register, aggregate };
