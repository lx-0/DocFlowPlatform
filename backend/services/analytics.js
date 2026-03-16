'use strict';

const prisma = require('../src/db/client');

/**
 * Returns daily document counts (submitted, approved, rejected) in a date range.
 *
 * @param {{ from: Date, to: Date }} params
 * @returns {Promise<Array<{ date: string, submitted: number, approved: number, rejected: number }>>}
 */
async function getVolumeStats({ from, to }) {
  const rows = await prisma.documentMetric.findMany({
    where: { submittedAt: { gte: from, lte: to } },
    select: { submittedAt: true, approvedAt: true, rejectedAt: true },
  });

  // Aggregate by calendar date (UTC)
  const byDate = new Map();

  function dateKey(dt) {
    return dt.toISOString().slice(0, 10);
  }

  function ensure(key) {
    if (!byDate.has(key)) byDate.set(key, { date: key, submitted: 0, approved: 0, rejected: 0 });
    return byDate.get(key);
  }

  for (const row of rows) {
    ensure(dateKey(row.submittedAt)).submitted += 1;
    if (row.approvedAt) ensure(dateKey(row.approvedAt)).approved += 1;
    if (row.rejectedAt) ensure(dateKey(row.rejectedAt)).rejected += 1;
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Returns average approval time (in ms) per day in a date range.
 *
 * @param {{ from: Date, to: Date }} params
 * @returns {Promise<Array<{ date: string, avgApprovalTimeMs: number | null }>>}
 */
async function getApprovalTimeStats({ from, to }) {
  const rows = await prisma.documentMetric.findMany({
    where: {
      submittedAt: { gte: from, lte: to },
      approvedAt: { not: null },
    },
    select: { submittedAt: true, approvedAt: true },
  });

  // Group by submission date, compute average time to approval
  const byDate = new Map();

  function dateKey(dt) {
    return dt.toISOString().slice(0, 10);
  }

  for (const row of rows) {
    const key = dateKey(row.submittedAt);
    if (!byDate.has(key)) byDate.set(key, { sum: 0, count: 0 });
    const bucket = byDate.get(key);
    bucket.sum += row.approvedAt.getTime() - row.submittedAt.getTime();
    bucket.count += 1;
  }

  return [...byDate.entries()]
    .map(([date, { sum, count }]) => ({ date, avgApprovalTimeMs: count > 0 ? Math.round(sum / count) : null }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Returns the rejection rate (rejectedCount / totalDecided) per day in a date range.
 *
 * @param {{ from: Date, to: Date }} params
 * @returns {Promise<Array<{ date: string, rejectionRate: number | null }>>}
 */
async function getRejectionRate({ from, to }) {
  const rows = await prisma.documentMetric.findMany({
    where: {
      submittedAt: { gte: from, lte: to },
      OR: [{ approvedAt: { not: null } }, { rejectedAt: { not: null } }],
    },
    select: { submittedAt: true, approvedAt: true, rejectedAt: true },
  });

  const byDate = new Map();

  function dateKey(dt) {
    return dt.toISOString().slice(0, 10);
  }

  function ensure(key) {
    if (!byDate.has(key)) byDate.set(key, { approved: 0, rejected: 0 });
    return byDate.get(key);
  }

  for (const row of rows) {
    const key = dateKey(row.submittedAt);
    if (row.approvedAt) ensure(key).approved += 1;
    if (row.rejectedAt) ensure(key).rejected += 1;
  }

  return [...byDate.entries()]
    .map(([date, { approved, rejected }]) => {
      const total = approved + rejected;
      return { date, rejectionRate: total > 0 ? rejected / total : null };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Returns routing queues whose average wait time exceeds the given threshold.
 *
 * @param {{ from: Date, to: Date, threshold: number }} params - threshold in ms
 * @returns {Promise<Array<{ queueId: string, name: string, avgWaitTimeMs: number, documentCount: number }>>}
 */
async function getBottleneckQueues({ from, to, threshold }) {
  const rows = await prisma.queueMetric.findMany({
    where: {
      date: { gte: from, lte: to },
      avgWaitTimeMs: { not: null },
    },
    select: { queueId: true, avgWaitTimeMs: true, documentsIn: true },
  });

  // Average across days per queue
  const byQueue = new Map();
  for (const row of rows) {
    if (!byQueue.has(row.queueId)) byQueue.set(row.queueId, { sum: 0, count: 0, documentCount: 0 });
    const bucket = byQueue.get(row.queueId);
    if (row.avgWaitTimeMs != null) {
      bucket.sum += row.avgWaitTimeMs;
      bucket.count += 1;
    }
    bucket.documentCount += row.documentsIn;
  }

  return [...byQueue.entries()]
    .map(([queueId, { sum, count, documentCount }]) => ({
      queueId,
      name: queueId,
      avgWaitTimeMs: count > 0 ? Math.round(sum / count) : 0,
      documentCount,
    }))
    .filter(r => r.avgWaitTimeMs > threshold)
    .sort((a, b) => b.avgWaitTimeMs - a.avgWaitTimeMs);
}

/**
 * Returns approvers whose average response time exceeds the given threshold.
 *
 * @param {{ from: Date, to: Date, threshold: number }} params - threshold in ms
 * @returns {Promise<Array<{ approverId: string, name: string, avgResponseTimeMs: number, documentCount: number }>>}
 */
async function getBottleneckApprovers({ from, to, threshold }) {
  const rows = await prisma.approverMetric.findMany({
    where: {
      date: { gte: from, lte: to },
      avgResponseTimeMs: { not: null },
    },
    select: { approverId: true, avgResponseTimeMs: true, assigned: true },
  });

  // Average across days per approver
  const byApprover = new Map();
  for (const row of rows) {
    if (!byApprover.has(row.approverId)) byApprover.set(row.approverId, { sum: 0, count: 0, documentCount: 0 });
    const bucket = byApprover.get(row.approverId);
    if (row.avgResponseTimeMs != null) {
      bucket.sum += row.avgResponseTimeMs;
      bucket.count += 1;
    }
    bucket.documentCount += row.assigned;
  }

  const bottlenecks = [...byApprover.entries()]
    .map(([approverId, { sum, count, documentCount }]) => ({
      approverId,
      avgResponseTimeMs: count > 0 ? Math.round(sum / count) : 0,
      documentCount,
    }))
    .filter(r => r.avgResponseTimeMs > threshold)
    .sort((a, b) => b.avgResponseTimeMs - a.avgResponseTimeMs);

  if (bottlenecks.length === 0) return [];

  // Resolve approver names from User table
  const approverIds = bottlenecks.map(b => b.approverId);
  const users = await prisma.user.findMany({
    where: { id: { in: approverIds } },
    select: { id: true, email: true },
  });
  const userMap = new Map(users.map(u => [u.id, u.email]));

  return bottlenecks.map(b => ({
    ...b,
    name: userMap.get(b.approverId) || b.approverId,
  }));
}

module.exports = { getVolumeStats, getApprovalTimeStats, getRejectionRate, getBottleneckQueues, getBottleneckApprovers };
