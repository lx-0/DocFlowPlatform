'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── In-memory mock stores ────────────────────────────────────────────────────

let mockDocuments = [];
let mockAuditLogs = [];
let mockSystemConfig = new Map();
let auditLogInserts = [];

const mockPrisma = {
  systemConfig: {
    findMany: async ({ where } = {}) => {
      let rows = [...mockSystemConfig.values()];
      if (where?.key?.in) {
        rows = rows.filter((r) => where.key.in.includes(r.key));
      }
      return rows;
    },
    upsert: async ({ where, update, create }) => {
      const existing = mockSystemConfig.get(where.key);
      if (existing) {
        existing.value = update.value;
        return existing;
      }
      const row = { key: create.key, value: create.value };
      mockSystemConfig.set(row.key, row);
      return row;
    },
  },

  document: {
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const doc of mockDocuments) {
        const statusMatch = where.routingStatus?.in?.includes(doc.routingStatus) ?? true;
        const createdBefore = where.createdAt?.lt ? doc.createdAt < where.createdAt.lt : true;
        const notDeleted = where.deletedAt === null ? doc.deletedAt === null : true;
        if (statusMatch && createdBefore && notDeleted) {
          doc.deletedAt = data.deletedAt;
          count++;
        }
      }
      return { count };
    },
  },

  auditLog: {
    deleteMany: async ({ where }) => {
      const before = mockAuditLogs.length;
      mockAuditLogs = mockAuditLogs.filter(
        (log) => !(where.createdAt?.lt && log.createdAt < where.createdAt.lt)
      );
      return { count: before - mockAuditLogs.length };
    },
    create: async ({ data }) => {
      auditLogInserts.push(data);
      return data;
    },
  },
};

// ─── Inject mock into require.cache before loading modules ────────────────────

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
  delete require.cache[require.resolve('../services/auditLog')];
  delete require.cache[require.resolve('../jobs/purgeJob')];
});

function loadPurgeJob() {
  delete require.cache[require.resolve('../services/auditLog')];
  delete require.cache[require.resolve('../jobs/purgeJob')];
  return require('../jobs/purgeJob');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(n, from = new Date()) {
  return new Date(from.getTime() - n * 24 * 60 * 60 * 1000);
}

function makeDoc({ routingStatus = 'approved', createdAt = daysAgo(400), deletedAt = null } = {}) {
  return { routingStatus, createdAt, deletedAt };
}

function makeLog({ createdAt = daysAgo(100) } = {}) {
  return { createdAt };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PurgeJob.runPurge', () => {
  beforeEach(() => {
    mockDocuments = [];
    mockAuditLogs = [];
    mockSystemConfig = new Map([
      ['documentRetentionDays', { key: 'documentRetentionDays', value: '365' }],
      ['auditLogRetentionDays', { key: 'auditLogRetentionDays', value: '90' }],
    ]);
    auditLogInserts = [];
  });

  it('soft-deletes approved documents older than retention period', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    mockDocuments = [
      makeDoc({ routingStatus: 'approved', createdAt: daysAgo(400, now) }),  // old → archived
      makeDoc({ routingStatus: 'approved', createdAt: daysAgo(200, now) }),  // recent → kept
    ];

    const { runPurge } = loadPurgeJob();
    const result = await runPurge(now);

    assert.equal(result.documentsArchived, 1);
    assert.equal(mockDocuments[0].deletedAt, now);
    assert.equal(mockDocuments[1].deletedAt, null);
  });

  it('soft-deletes rejected documents older than retention period', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    mockDocuments = [
      makeDoc({ routingStatus: 'rejected', createdAt: daysAgo(400, now) }),
      makeDoc({ routingStatus: 'rejected', createdAt: daysAgo(10, now) }),
    ];

    const { runPurge } = loadPurgeJob();
    const result = await runPurge(now);

    assert.equal(result.documentsArchived, 1);
  });

  it('does not soft-delete documents that are already deleted', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    const alreadyDeletedAt = daysAgo(10, now);
    mockDocuments = [
      makeDoc({ routingStatus: 'approved', createdAt: daysAgo(400, now), deletedAt: alreadyDeletedAt }),
    ];

    const { runPurge } = loadPurgeJob();
    const result = await runPurge(now);

    assert.equal(result.documentsArchived, 0);
    assert.equal(mockDocuments[0].deletedAt, alreadyDeletedAt);
  });

  it('does not archive documents that are not approved or rejected', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    mockDocuments = [
      makeDoc({ routingStatus: 'unrouted', createdAt: daysAgo(400, now) }),
      makeDoc({ routingStatus: 'queued', createdAt: daysAgo(400, now) }),
      makeDoc({ routingStatus: 'in_approval', createdAt: daysAgo(400, now) }),
    ];

    const { runPurge } = loadPurgeJob();
    const result = await runPurge(now);

    assert.equal(result.documentsArchived, 0);
    for (const doc of mockDocuments) {
      assert.equal(doc.deletedAt, null);
    }
  });

  it('disables document purging when documentRetentionDays is 0', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    mockSystemConfig.set('documentRetentionDays', { key: 'documentRetentionDays', value: '0' });
    mockDocuments = [
      makeDoc({ routingStatus: 'approved', createdAt: daysAgo(1000, now) }),
    ];

    const { runPurge } = loadPurgeJob();
    const result = await runPurge(now);

    assert.equal(result.documentsArchived, 0);
    assert.equal(mockDocuments[0].deletedAt, null);
  });

  it('hard-deletes audit logs older than retention period', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    mockAuditLogs = [
      makeLog({ createdAt: daysAgo(100, now) }),  // old → deleted
      makeLog({ createdAt: daysAgo(100, now) }),  // old → deleted
      makeLog({ createdAt: daysAgo(30, now) }),   // recent → kept
    ];

    const { runPurge } = loadPurgeJob();
    const result = await runPurge(now);

    assert.equal(result.logsDeleted, 2);
    assert.equal(mockAuditLogs.length, 1);
  });

  it('keeps audit logs within retention period', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    mockAuditLogs = [
      makeLog({ createdAt: daysAgo(10, now) }),
      makeLog({ createdAt: daysAgo(50, now) }),
      makeLog({ createdAt: daysAgo(89, now) }),
    ];

    const { runPurge } = loadPurgeJob();
    const result = await runPurge(now);

    assert.equal(result.logsDeleted, 0);
    assert.equal(mockAuditLogs.length, 3);
  });

  it('uses custom retention settings from SystemConfig', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    mockSystemConfig.set('documentRetentionDays', { key: 'documentRetentionDays', value: '30' });
    mockSystemConfig.set('auditLogRetentionDays', { key: 'auditLogRetentionDays', value: '7' });

    mockDocuments = [
      makeDoc({ routingStatus: 'approved', createdAt: daysAgo(40, now) }),  // archived (> 30d)
      makeDoc({ routingStatus: 'approved', createdAt: daysAgo(20, now) }),  // kept (< 30d)
    ];
    mockAuditLogs = [
      makeLog({ createdAt: daysAgo(10, now) }),  // deleted (> 7d)
      makeLog({ createdAt: daysAgo(3, now) }),   // kept (< 7d)
    ];

    const { runPurge } = loadPurgeJob();
    const result = await runPurge(now);

    assert.equal(result.documentsArchived, 1);
    assert.equal(result.logsDeleted, 1);
  });

  it('uses default retention when SystemConfig has no values', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    mockSystemConfig = new Map(); // empty — no config rows

    mockDocuments = [
      makeDoc({ routingStatus: 'approved', createdAt: daysAgo(366, now) }), // > 365d → archived
      makeDoc({ routingStatus: 'approved', createdAt: daysAgo(364, now) }), // < 365d → kept
    ];
    mockAuditLogs = [
      makeLog({ createdAt: daysAgo(91, now) }),  // > 90d → deleted
      makeLog({ createdAt: daysAgo(89, now) }),  // < 90d → kept
    ];

    const { runPurge } = loadPurgeJob();
    const result = await runPurge(now);

    assert.equal(result.documentsArchived, 1);
    assert.equal(result.logsDeleted, 1);
  });

  it('persists purge stats to SystemConfig', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    mockDocuments = [
      makeDoc({ routingStatus: 'approved', createdAt: daysAgo(400, now) }),
    ];
    mockAuditLogs = [
      makeLog({ createdAt: daysAgo(100, now) }),
    ];

    const { runPurge } = loadPurgeJob();
    await runPurge(now);

    assert.equal(mockSystemConfig.get('lastPurgeAt')?.value, now.toISOString());
    assert.equal(mockSystemConfig.get('lastPurgeDocumentsArchived')?.value, '1');
    assert.equal(mockSystemConfig.get('lastPurgeLogsDeleted')?.value, '1');
  });

  it('returns { documentsArchived, logsDeleted } counts', async () => {
    const now = new Date('2026-03-16T03:00:00Z');
    mockDocuments = [];
    mockAuditLogs = [];

    const { runPurge } = loadPurgeJob();
    const result = await runPurge(now);

    assert.ok('documentsArchived' in result);
    assert.ok('logsDeleted' in result);
    assert.equal(typeof result.documentsArchived, 'number');
    assert.equal(typeof result.logsDeleted, 'number');
  });
});
