'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockRules = [];
const mockDocuments = new Map();

const mockPrisma = {
  routingRule: {
    findMany: async ({ where, orderBy } = {}) => {
      let rules = mockRules.filter(r => (where?.isActive === undefined || r.isActive === where.isActive));
      if (orderBy?.priority === 'asc') {
        rules = [...rules].sort((a, b) => a.priority - b.priority);
      }
      return rules;
    },
  },
  document: {
    update: async ({ where, data }) => {
      const existing = mockDocuments.get(where.id) || { id: where.id };
      const updated = { ...existing, ...data };
      mockDocuments.set(where.id, updated);
      return updated;
    },
  },
};

before(() => {
  require.cache[require.resolve('../src/db/client')] = {
    id: require.resolve('../src/db/client'),
    filename: require.resolve('../src/db/client'),
    loaded: true,
    exports: mockPrisma,
  };
});

after(() => {
  delete require.cache[require.resolve('../src/db/client')];
  delete require.cache[require.resolve('../services/routingEngine')];
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RoutingEngine', () => {
  let routeDocument;

  before(() => {
    ({ routeDocument } = require('../services/routingEngine'));
  });

  beforeEach(() => {
    mockRules.length = 0;
    mockDocuments.clear();
  });

  describe('match on documentType', () => {
    it('assigns queue when documentType matches', async () => {
      mockRules.push({ id: 'r1', documentType: 'PDF', departmentTag: null, priority: 1, targetQueue: 'legal-queue', isActive: true });

      const result = await routeDocument('doc-1', { documentType: 'PDF', departmentTag: null });

      assert.equal(result.routingQueueId, 'legal-queue');
      assert.equal(result.routingStatus, 'queued');
      assert.equal(mockDocuments.get('doc-1').routingQueueId, 'legal-queue');
      assert.equal(mockDocuments.get('doc-1').routingStatus, 'queued');
    });

    it('does not match when documentType differs', async () => {
      mockRules.push({ id: 'r1', documentType: 'PDF', departmentTag: null, priority: 1, targetQueue: 'legal-queue', isActive: true });

      const result = await routeDocument('doc-2', { documentType: 'DOCX', departmentTag: null });

      assert.equal(result.routingStatus, 'unrouted');
      assert.equal(result.routingQueueId, null);
    });
  });

  describe('match on departmentTag', () => {
    it('assigns queue when departmentTag matches', async () => {
      mockRules.push({ id: 'r1', documentType: null, departmentTag: 'hr', priority: 1, targetQueue: 'hr-queue', isActive: true });

      const result = await routeDocument('doc-3', { documentType: 'PDF', departmentTag: 'hr' });

      assert.equal(result.routingQueueId, 'hr-queue');
      assert.equal(result.routingStatus, 'queued');
    });

    it('does not match when departmentTag differs', async () => {
      mockRules.push({ id: 'r1', documentType: null, departmentTag: 'hr', priority: 1, targetQueue: 'hr-queue', isActive: true });

      const result = await routeDocument('doc-4', { documentType: 'PDF', departmentTag: 'finance' });

      assert.equal(result.routingStatus, 'unrouted');
    });
  });

  describe('match requiring both documentType and departmentTag', () => {
    it('matches only when both conditions satisfied', async () => {
      mockRules.push({ id: 'r1', documentType: 'PDF', departmentTag: 'legal', priority: 1, targetQueue: 'legal-pdf-queue', isActive: true });

      const result = await routeDocument('doc-5', { documentType: 'PDF', departmentTag: 'legal' });

      assert.equal(result.routingQueueId, 'legal-pdf-queue');
      assert.equal(result.routingStatus, 'queued');
    });

    it('does not match when only documentType satisfies', async () => {
      mockRules.push({ id: 'r1', documentType: 'PDF', departmentTag: 'legal', priority: 1, targetQueue: 'legal-pdf-queue', isActive: true });

      const result = await routeDocument('doc-6', { documentType: 'PDF', departmentTag: 'hr' });

      assert.equal(result.routingStatus, 'unrouted');
    });

    it('does not match when only departmentTag satisfies', async () => {
      mockRules.push({ id: 'r1', documentType: 'PDF', departmentTag: 'legal', priority: 1, targetQueue: 'legal-pdf-queue', isActive: true });

      const result = await routeDocument('doc-7', { documentType: 'DOCX', departmentTag: 'legal' });

      assert.equal(result.routingStatus, 'unrouted');
    });
  });

  describe('no-match fallback', () => {
    it('sets routingStatus=unrouted when no rules exist', async () => {
      const result = await routeDocument('doc-8', { documentType: 'PDF', departmentTag: null });

      assert.equal(result.routingStatus, 'unrouted');
      assert.equal(result.routingQueueId, null);
      assert.equal(mockDocuments.get('doc-8').routingStatus, 'unrouted');
      assert.equal(mockDocuments.get('doc-8').routingQueueId, null);
    });

    it('sets routingStatus=unrouted when no rule matches', async () => {
      mockRules.push({ id: 'r1', documentType: 'DOCX', departmentTag: null, priority: 1, targetQueue: 'docx-queue', isActive: true });

      const result = await routeDocument('doc-9', { documentType: 'PDF', departmentTag: null });

      assert.equal(result.routingStatus, 'unrouted');
    });

    it('ignores inactive rules', async () => {
      mockRules.push({ id: 'r1', documentType: 'PDF', departmentTag: null, priority: 1, targetQueue: 'legal-queue', isActive: false });

      const result = await routeDocument('doc-10', { documentType: 'PDF', departmentTag: null });

      assert.equal(result.routingStatus, 'unrouted');
    });
  });

  describe('priority ordering', () => {
    it('first matching rule by priority wins', async () => {
      mockRules.push({ id: 'r2', documentType: null, departmentTag: null, priority: 2, targetQueue: 'low-priority-queue', isActive: true });
      mockRules.push({ id: 'r1', documentType: null, departmentTag: null, priority: 1, targetQueue: 'high-priority-queue', isActive: true });

      const result = await routeDocument('doc-11', { documentType: 'PDF', departmentTag: null });

      assert.equal(result.routingQueueId, 'high-priority-queue');
      assert.equal(result.routingStatus, 'queued');
    });

    it('falls through to lower priority rule when higher priority does not match', async () => {
      mockRules.push({ id: 'r1', documentType: 'DOCX', departmentTag: null, priority: 1, targetQueue: 'docx-queue', isActive: true });
      mockRules.push({ id: 'r2', documentType: 'PDF', departmentTag: null, priority: 2, targetQueue: 'pdf-queue', isActive: true });

      const result = await routeDocument('doc-12', { documentType: 'PDF', departmentTag: null });

      assert.equal(result.routingQueueId, 'pdf-queue');
      assert.equal(result.routingStatus, 'queued');
    });
  });

  describe('wildcard rules (null conditions)', () => {
    it('rule with no conditions matches any document', async () => {
      mockRules.push({ id: 'r1', documentType: null, departmentTag: null, priority: 10, targetQueue: 'catch-all', isActive: true });

      const result = await routeDocument('doc-13', { documentType: 'DOCX', departmentTag: 'finance' });

      assert.equal(result.routingQueueId, 'catch-all');
      assert.equal(result.routingStatus, 'queued');
    });
  });
});
