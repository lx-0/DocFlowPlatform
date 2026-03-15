'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// ─── Prisma mock setup ────────────────────────────────────────────────────────

const mockRules = new Map();
let mockError = null;

const mockPrisma = {
  routingRule: {
    findMany: async ({ orderBy } = {}) => {
      if (mockError) throw mockError;
      const rules = Array.from(mockRules.values());
      if (orderBy && orderBy.priority) {
        rules.sort((a, b) =>
          orderBy.priority === 'asc' ? a.priority - b.priority : b.priority - a.priority
        );
      }
      return rules;
    },
    findUnique: async ({ where }) => {
      if (mockError) throw mockError;
      return mockRules.get(where.id) || null;
    },
    create: async ({ data }) => {
      if (mockError) throw mockError;
      const rule = { ...data, createdAt: new Date(), updatedAt: new Date() };
      mockRules.set(rule.id, rule);
      return rule;
    },
    update: async ({ where, data }) => {
      if (mockError) throw mockError;
      const existing = mockRules.get(where.id);
      if (!existing) throw new Error('Record not found');
      const updated = { ...existing, ...data, updatedAt: new Date() };
      mockRules.set(where.id, updated);
      return updated;
    },
  },
};

// Inject mock before requiring controller
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
  delete require.cache[require.resolve('../controllers/routingRulesController')];
});

// ─── Helper: fake req/res ─────────────────────────────────────────────────────

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('routingRulesController', () => {
  let controller;

  before(() => {
    controller = require('../controllers/routingRulesController');
  });

  describe('listRoutingRules', () => {
    before(() => {
      mockRules.clear();
      mockRules.set('r1', { id: 'r1', name: 'Rule A', priority: 2, targetQueue: 'legal', isActive: true });
      mockRules.set('r2', { id: 'r2', name: 'Rule B', priority: 1, targetQueue: 'hr', isActive: true });
    });

    it('returns rules ordered by priority ascending', async () => {
      const req = {};
      const res = makeRes();
      await controller.listRoutingRules(req, res);
      assert.equal(res._status, 200);
      assert.equal(res._body.length, 2);
      assert.equal(res._body[0].id, 'r2'); // priority 1 first
      assert.equal(res._body[1].id, 'r1'); // priority 2 second
    });
  });

  describe('createRoutingRule', () => {
    before(() => { mockRules.clear(); });

    it('creates a rule with valid fields', async () => {
      const req = {
        body: { name: 'Finance Rule', priority: 5, targetQueue: 'finance' },
      };
      const res = makeRes();
      await controller.createRoutingRule(req, res);
      assert.equal(res._status, 201);
      assert.equal(res._body.name, 'Finance Rule');
      assert.equal(res._body.priority, 5);
      assert.equal(res._body.targetQueue, 'finance');
      assert.equal(res._body.isActive, true);
      assert.equal(res._body.documentType, null);
      assert.equal(res._body.departmentTag, null);
    });

    it('creates a rule with optional fields', async () => {
      const req = {
        body: {
          name: 'HR Docs',
          priority: 1,
          targetQueue: 'hr',
          documentType: 'PDF',
          departmentTag: 'human-resources',
          isActive: false,
        },
      };
      const res = makeRes();
      await controller.createRoutingRule(req, res);
      assert.equal(res._status, 201);
      assert.equal(res._body.documentType, 'PDF');
      assert.equal(res._body.departmentTag, 'human-resources');
      assert.equal(res._body.isActive, false);
    });

    it('returns 400 when name is missing', async () => {
      const req = { body: { priority: 1, targetQueue: 'legal' } };
      const res = makeRes();
      await controller.createRoutingRule(req, res);
      assert.equal(res._status, 400);
      assert.ok(res._body.error);
    });

    it('returns 400 when priority is missing', async () => {
      const req = { body: { name: 'Test', targetQueue: 'legal' } };
      const res = makeRes();
      await controller.createRoutingRule(req, res);
      assert.equal(res._status, 400);
      assert.ok(res._body.error);
    });

    it('returns 400 when targetQueue is missing', async () => {
      const req = { body: { name: 'Test', priority: 1 } };
      const res = makeRes();
      await controller.createRoutingRule(req, res);
      assert.equal(res._status, 400);
      assert.ok(res._body.error);
    });

    it('returns 400 when priority is not a number', async () => {
      const req = { body: { name: 'Test', priority: 'bad', targetQueue: 'legal' } };
      const res = makeRes();
      await controller.createRoutingRule(req, res);
      assert.equal(res._status, 400);
      assert.ok(res._body.error);
    });
  });

  describe('updateRoutingRule', () => {
    before(() => {
      mockRules.clear();
      mockRules.set('rule-1', {
        id: 'rule-1',
        name: 'Old Name',
        priority: 3,
        targetQueue: 'legal',
        documentType: null,
        departmentTag: null,
        isActive: true,
      });
    });

    it('updates allowed fields', async () => {
      const req = { params: { id: 'rule-1' }, body: { name: 'New Name', priority: 10 } };
      const res = makeRes();
      await controller.updateRoutingRule(req, res);
      assert.equal(res._status, 200);
      assert.equal(res._body.name, 'New Name');
      assert.equal(res._body.priority, 10);
      assert.equal(res._body.targetQueue, 'legal'); // unchanged
    });

    it('returns 404 for non-existent rule', async () => {
      const req = { params: { id: 'does-not-exist' }, body: { name: 'X' } };
      const res = makeRes();
      await controller.updateRoutingRule(req, res);
      assert.equal(res._status, 404);
      assert.ok(res._body.error);
    });

    it('returns 400 when priority is not a number', async () => {
      const req = { params: { id: 'rule-1' }, body: { priority: 'bad' } };
      const res = makeRes();
      await controller.updateRoutingRule(req, res);
      assert.equal(res._status, 400);
      assert.ok(res._body.error);
    });
  });

  describe('deleteRoutingRule', () => {
    before(() => {
      mockRules.clear();
      mockRules.set('rule-del', {
        id: 'rule-del',
        name: 'To Delete',
        priority: 1,
        targetQueue: 'hr',
        isActive: true,
      });
    });

    it('soft-deletes by setting isActive to false', async () => {
      const req = { params: { id: 'rule-del' } };
      const res = makeRes();
      await controller.deleteRoutingRule(req, res);
      assert.equal(res._status, 200);
      assert.equal(res._body.isActive, false);
    });

    it('returns 404 for non-existent rule', async () => {
      const req = { params: { id: 'does-not-exist' } };
      const res = makeRes();
      await controller.deleteRoutingRule(req, res);
      assert.equal(res._status, 404);
      assert.ok(res._body.error);
    });
  });
});

// ─── requireAdmin middleware tests ────────────────────────────────────────────

describe('requireAdmin middleware', () => {
  let requireAdmin;

  before(() => {
    requireAdmin = require('../middleware/auth').requireAdmin;
  });

  it('calls next() for admin users', () => {
    const req = { user: { userId: 'u1', role: 'admin' } };
    const res = makeRes();
    let called = false;
    requireAdmin(req, res, () => { called = true; });
    assert.equal(called, true);
  });

  it('returns 403 for non-admin users', () => {
    const req = { user: { userId: 'u2', role: 'user' } };
    const res = makeRes();
    requireAdmin(req, res, () => {});
    assert.equal(res._status, 403);
    assert.ok(res._body.error);
  });

  it('returns 403 when user is missing', () => {
    const req = {};
    const res = makeRes();
    requireAdmin(req, res, () => {});
    assert.equal(res._status, 403);
    assert.ok(res._body.error);
  });
});
