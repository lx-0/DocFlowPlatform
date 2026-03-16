'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Prisma mock ───────────────────────────────────────────────────────────────

/** In-memory data stores */
let mockDocumentMetrics = [];
let mockQueueMetrics = [];

const mockPrisma = {
  documentMetric: {
    findMany: async ({ where, select }) => {
      let rows = [...mockDocumentMetrics];

      if (where?.submittedAt?.gte) rows = rows.filter(r => r.submittedAt >= where.submittedAt.gte);
      if (where?.submittedAt?.lte) rows = rows.filter(r => r.submittedAt <= where.submittedAt.lte);

      if (where?.approvedAt?.not === null) rows = rows.filter(r => r.approvedAt !== null);
      if (where?.OR) {
        rows = rows.filter(r =>
          where.OR.some(cond => {
            if (cond.approvedAt?.not === null) return r.approvedAt !== null;
            if (cond.rejectedAt?.not === null) return r.rejectedAt !== null;
            return false;
          })
        );
      }

      if (!select) return rows;
      return rows.map(row => {
        const out = {};
        for (const key of Object.keys(select)) out[key] = row[key];
        return out;
      });
    },
  },

  queueMetric: {
    findMany: async ({ where, select }) => {
      let rows = [...mockQueueMetrics];

      if (where?.date?.gte) rows = rows.filter(r => r.date >= where.date.gte);
      if (where?.date?.lte) rows = rows.filter(r => r.date <= where.date.lte);
      if (where?.avgWaitTimeMs?.not === null) rows = rows.filter(r => r.avgWaitTimeMs !== null);
      if (where?.avgWaitTimeMs?.gt !== undefined) rows = rows.filter(r => r.avgWaitTimeMs > where.avgWaitTimeMs.gt);

      if (!select) return rows;
      return rows.map(row => {
        const out = {};
        for (const key of Object.keys(select)) out[key] = row[key];
        return out;
      });
    },
  },
};

// ─── Inject mock into require.cache before loading service ────────────────────

before(() => {
  const clientPath = require.resolve('../src/db/client');
  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: mockPrisma,
  };
});

after(() => {
  delete require.cache[require.resolve('../src/db/client')];
  delete require.cache[require.resolve('../services/analytics')];
});

// Lazy-load the service after mock is in place
function loadService() {
  delete require.cache[require.resolve('../services/analytics')];
  return require('../services/analytics');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function d(dateStr) {
  return new Date(dateStr);
}

// ─── getVolumeStats ───────────────────────────────────────────────────────────

describe('getVolumeStats', () => {
  beforeEach(() => {
    mockDocumentMetrics = [];
  });

  it('returns daily counts for submitted, approved, and rejected documents', async () => {
    const { getVolumeStats } = loadService();
    mockDocumentMetrics = [
      { submittedAt: d('2024-01-10T10:00:00Z'), approvedAt: d('2024-01-11T10:00:00Z'), rejectedAt: null },
      { submittedAt: d('2024-01-10T11:00:00Z'), approvedAt: null, rejectedAt: d('2024-01-12T09:00:00Z') },
      { submittedAt: d('2024-01-11T08:00:00Z'), approvedAt: d('2024-01-11T15:00:00Z'), rejectedAt: null },
    ];

    const result = await getVolumeStats({ from: d('2024-01-10T00:00:00Z'), to: d('2024-01-12T23:59:59Z') });

    assert.ok(Array.isArray(result));

    const jan10 = result.find(r => r.date === '2024-01-10');
    const jan11 = result.find(r => r.date === '2024-01-11');
    const jan12 = result.find(r => r.date === '2024-01-12');

    assert.equal(jan10.submitted, 2);
    assert.equal(jan11.submitted, 1);
    assert.equal(jan11.approved, 2); // doc1 approved on Jan 11, doc3 approved on Jan 11
    assert.equal(jan12.rejected, 1); // doc2 rejected on Jan 12
  });

  it('returns empty array when no documents exist in range', async () => {
    const { getVolumeStats } = loadService();
    mockDocumentMetrics = [];
    const result = await getVolumeStats({ from: d('2024-01-01T00:00:00Z'), to: d('2024-01-31T23:59:59Z') });
    assert.deepEqual(result, []);
  });

  it('returns sorted results by date', async () => {
    const { getVolumeStats } = loadService();
    mockDocumentMetrics = [
      { submittedAt: d('2024-01-15T10:00:00Z'), approvedAt: null, rejectedAt: null },
      { submittedAt: d('2024-01-10T10:00:00Z'), approvedAt: null, rejectedAt: null },
      { submittedAt: d('2024-01-12T10:00:00Z'), approvedAt: null, rejectedAt: null },
    ];

    const result = await getVolumeStats({ from: d('2024-01-01T00:00:00Z'), to: d('2024-01-31T23:59:59Z') });

    assert.equal(result[0].date, '2024-01-10');
    assert.equal(result[1].date, '2024-01-12');
    assert.equal(result[2].date, '2024-01-15');
  });

  it('counts a single document once per day correctly', async () => {
    const { getVolumeStats } = loadService();
    mockDocumentMetrics = [
      { submittedAt: d('2024-02-01T09:00:00Z'), approvedAt: d('2024-02-01T17:00:00Z'), rejectedAt: null },
    ];

    const result = await getVolumeStats({ from: d('2024-02-01T00:00:00Z'), to: d('2024-02-01T23:59:59Z') });

    assert.equal(result.length, 1);
    assert.equal(result[0].date, '2024-02-01');
    assert.equal(result[0].submitted, 1);
    assert.equal(result[0].approved, 1);
    assert.equal(result[0].rejected, 0);
  });
});

// ─── getApprovalTimeStats ─────────────────────────────────────────────────────

describe('getApprovalTimeStats', () => {
  beforeEach(() => {
    mockDocumentMetrics = [];
  });

  it('returns average approval time per day', async () => {
    const { getApprovalTimeStats } = loadService();
    const MS_HOUR = 60 * 60 * 1000;
    mockDocumentMetrics = [
      { submittedAt: d('2024-03-05T08:00:00Z'), approvedAt: d('2024-03-05T10:00:00Z'), rejectedAt: null }, // 2h
      { submittedAt: d('2024-03-05T09:00:00Z'), approvedAt: d('2024-03-05T13:00:00Z'), rejectedAt: null }, // 4h
      { submittedAt: d('2024-03-06T10:00:00Z'), approvedAt: d('2024-03-06T14:00:00Z'), rejectedAt: null }, // 4h
    ];

    const result = await getApprovalTimeStats({ from: d('2024-03-05T00:00:00Z'), to: d('2024-03-06T23:59:59Z') });

    const mar5 = result.find(r => r.date === '2024-03-05');
    const mar6 = result.find(r => r.date === '2024-03-06');

    // Mar 5 average: (2h + 4h) / 2 = 3h
    assert.equal(mar5.avgApprovalTimeMs, 3 * MS_HOUR);
    // Mar 6 average: 4h
    assert.equal(mar6.avgApprovalTimeMs, 4 * MS_HOUR);
  });

  it('returns empty array when no approved documents exist', async () => {
    const { getApprovalTimeStats } = loadService();
    mockDocumentMetrics = [
      { submittedAt: d('2024-03-01T10:00:00Z'), approvedAt: null, rejectedAt: null },
    ];

    const result = await getApprovalTimeStats({ from: d('2024-03-01T00:00:00Z'), to: d('2024-03-31T23:59:59Z') });
    assert.deepEqual(result, []);
  });

  it('returns sorted results by date', async () => {
    const { getApprovalTimeStats } = loadService();
    mockDocumentMetrics = [
      { submittedAt: d('2024-04-10T08:00:00Z'), approvedAt: d('2024-04-10T10:00:00Z'), rejectedAt: null },
      { submittedAt: d('2024-04-05T08:00:00Z'), approvedAt: d('2024-04-05T10:00:00Z'), rejectedAt: null },
    ];

    const result = await getApprovalTimeStats({ from: d('2024-04-01T00:00:00Z'), to: d('2024-04-30T23:59:59Z') });

    assert.equal(result[0].date, '2024-04-05');
    assert.equal(result[1].date, '2024-04-10');
  });
});

// ─── getRejectionRate ─────────────────────────────────────────────────────────

describe('getRejectionRate', () => {
  beforeEach(() => {
    mockDocumentMetrics = [];
  });

  it('calculates correct rejection rate per day', async () => {
    const { getRejectionRate } = loadService();
    mockDocumentMetrics = [
      { submittedAt: d('2024-05-01T10:00:00Z'), approvedAt: d('2024-05-02T10:00:00Z'), rejectedAt: null },
      { submittedAt: d('2024-05-01T11:00:00Z'), approvedAt: null, rejectedAt: d('2024-05-02T10:00:00Z') },
      { submittedAt: d('2024-05-01T12:00:00Z'), approvedAt: null, rejectedAt: d('2024-05-02T10:00:00Z') },
    ];

    const result = await getRejectionRate({ from: d('2024-05-01T00:00:00Z'), to: d('2024-05-31T23:59:59Z') });

    const may1 = result.find(r => r.date === '2024-05-01');
    // 2 rejected out of 3 decided = 2/3
    assert.ok(Math.abs(may1.rejectionRate - 2 / 3) < 0.0001);
  });

  it('returns rejectionRate of 0 when nothing is rejected', async () => {
    const { getRejectionRate } = loadService();
    mockDocumentMetrics = [
      { submittedAt: d('2024-06-01T10:00:00Z'), approvedAt: d('2024-06-02T10:00:00Z'), rejectedAt: null },
      { submittedAt: d('2024-06-01T11:00:00Z'), approvedAt: d('2024-06-02T11:00:00Z'), rejectedAt: null },
    ];

    const result = await getRejectionRate({ from: d('2024-06-01T00:00:00Z'), to: d('2024-06-30T23:59:59Z') });

    const jun1 = result.find(r => r.date === '2024-06-01');
    assert.equal(jun1.rejectionRate, 0);
  });

  it('returns null rejectionRate when no decided documents exist', async () => {
    const { getRejectionRate } = loadService();
    // no approvedAt or rejectedAt
    mockDocumentMetrics = [];
    const result = await getRejectionRate({ from: d('2024-07-01T00:00:00Z'), to: d('2024-07-31T23:59:59Z') });
    assert.deepEqual(result, []);
  });

  it('returns rejection rate of 1.0 when all are rejected', async () => {
    const { getRejectionRate } = loadService();
    mockDocumentMetrics = [
      { submittedAt: d('2024-08-01T10:00:00Z'), approvedAt: null, rejectedAt: d('2024-08-02T10:00:00Z') },
      { submittedAt: d('2024-08-01T11:00:00Z'), approvedAt: null, rejectedAt: d('2024-08-02T11:00:00Z') },
    ];

    const result = await getRejectionRate({ from: d('2024-08-01T00:00:00Z'), to: d('2024-08-31T23:59:59Z') });
    const aug1 = result.find(r => r.date === '2024-08-01');
    assert.equal(aug1.rejectionRate, 1.0);
  });
});

// ─── getBottleneckQueues ──────────────────────────────────────────────────────

describe('getBottleneckQueues', () => {
  beforeEach(() => {
    mockQueueMetrics = [];
  });

  it('returns queues above the threshold sorted by avgWaitTimeMs descending', async () => {
    const { getBottleneckQueues } = loadService();
    mockQueueMetrics = [
      { queueId: 'queue-A', date: d('2024-09-01'), avgWaitTimeMs: 5000 },
      { queueId: 'queue-B', date: d('2024-09-01'), avgWaitTimeMs: 1000 },
      { queueId: 'queue-C', date: d('2024-09-02'), avgWaitTimeMs: 8000 },
    ];

    const result = await getBottleneckQueues({
      from: d('2024-09-01'),
      to: d('2024-09-30'),
      threshold: 2000,
    });

    // queue-B (1000) is below threshold; queue-A and queue-C remain
    assert.equal(result.length, 2);
    assert.equal(result[0].queueId, 'queue-C'); // highest first
    assert.equal(result[0].avgWaitTimeMs, 8000);
    assert.equal(result[1].queueId, 'queue-A');
    assert.equal(result[1].avgWaitTimeMs, 5000);
  });

  it('averages across multiple days for the same queue', async () => {
    const { getBottleneckQueues } = loadService();
    mockQueueMetrics = [
      { queueId: 'queue-X', date: d('2024-10-01'), avgWaitTimeMs: 4000 },
      { queueId: 'queue-X', date: d('2024-10-02'), avgWaitTimeMs: 6000 },
    ];

    const result = await getBottleneckQueues({
      from: d('2024-10-01'),
      to: d('2024-10-31'),
      threshold: 2000,
    });

    assert.equal(result.length, 1);
    assert.equal(result[0].queueId, 'queue-X');
    assert.equal(result[0].avgWaitTimeMs, 5000); // (4000 + 6000) / 2
  });

  it('returns empty array when no queues exceed the threshold', async () => {
    const { getBottleneckQueues } = loadService();
    mockQueueMetrics = [
      { queueId: 'queue-Y', date: d('2024-11-01'), avgWaitTimeMs: 100 },
    ];

    const result = await getBottleneckQueues({
      from: d('2024-11-01'),
      to: d('2024-11-30'),
      threshold: 5000,
    });

    assert.deepEqual(result, []);
  });

  it('returns empty array when no queue metrics exist', async () => {
    const { getBottleneckQueues } = loadService();
    mockQueueMetrics = [];

    const result = await getBottleneckQueues({
      from: d('2024-12-01'),
      to: d('2024-12-31'),
      threshold: 1000,
    });

    assert.deepEqual(result, []);
  });
});
