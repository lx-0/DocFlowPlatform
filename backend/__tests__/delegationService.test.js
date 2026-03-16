'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockUsers = new Map();
const mockDelegations = new Map();
const mockRolePerms = new Map();

let _idCounter = 1;
function nextId() { return `id-${_idCounter++}`; }

function buildDelegation(data) {
  return {
    id: data.id ?? nextId(),
    delegatorId: data.delegatorId,
    delegateId: data.delegateId,
    startDate: data.startDate,
    endDate: data.endDate,
    revokedAt: data.revokedAt ?? null,
    revokedById: data.revokedById ?? null,
    createdAt: new Date(),
  };
}

function matchesWhere(delegation, where) {
  if (where.delegatorId && delegation.delegatorId !== where.delegatorId) return false;
  if (where.delegateId && delegation.delegateId !== where.delegateId) return false;
  if (where.revokedAt === null && delegation.revokedAt !== null) return false;
  if (where.startDate?.lte && delegation.startDate > where.startDate.lte) return false;
  if (where.endDate?.gte && delegation.endDate < where.endDate.gte) return false;
  if (where.startDate?.lt && !(delegation.startDate < where.startDate.lt)) return false;
  if (where.endDate?.gt && !(delegation.endDate > where.endDate.gt)) return false;
  return true;
}

function withRelations(delegation, include) {
  if (!include) return delegation;
  const result = { ...delegation };
  if (include.delegator) {
    const u = mockUsers.get(delegation.delegatorId);
    result.delegator = u ? { id: u.id, email: u.email } : null;
  }
  if (include.delegate) {
    const u = mockUsers.get(delegation.delegateId);
    result.delegate = u ? { id: u.id, email: u.email, role: u.role } : null;
  }
  return result;
}

const mockPrisma = {
  approvalDelegation: {
    findFirst: async ({ where, include, select }) => {
      for (const d of mockDelegations.values()) {
        if (matchesWhere(d, where)) {
          return select ? Object.fromEntries(Object.keys(select).map(k => [k, d[k]])) : withRelations(d, include);
        }
      }
      return null;
    },
    findUnique: async ({ where, include }) => {
      const d = mockDelegations.get(where.id);
      if (!d) return null;
      return withRelations(d, include);
    },
    create: async ({ data, include }) => {
      const d = buildDelegation(data);
      mockDelegations.set(d.id, d);
      return withRelations(d, include);
    },
    update: async ({ where, data, include }) => {
      const d = mockDelegations.get(where.id);
      if (!d) throw Object.assign(new Error('not found'), { code: 'P2025' });
      const updated = { ...d, ...data };
      mockDelegations.set(where.id, updated);
      return withRelations(updated, include);
    },
  },

  user: {
    findUnique: async ({ where, select }) => {
      const u = mockUsers.get(where.id) ?? [...mockUsers.values()].find(u => u.email === where.email);
      if (!u) return null;
      return select ? Object.fromEntries(Object.keys(select).filter(k => k in u).map(k => [k, u[k]])) : u;
    },
  },

  rolePermission: {
    findMany: async ({ where }) => {
      return mockRolePerms.get(where.roleId) ?? [];
    },
  },
};

// Stub auditLog to avoid DB writes
const mockAuditLog = { logEvent: () => {} };

before(() => {
  require.cache[require.resolve('../src/db/client')] = {
    id: require.resolve('../src/db/client'),
    filename: require.resolve('../src/db/client'),
    loaded: true,
    exports: mockPrisma,
  };
  require.cache[require.resolve('../services/auditLog')] = {
    id: require.resolve('../services/auditLog'),
    filename: require.resolve('../services/auditLog'),
    loaded: true,
    exports: mockAuditLog,
  };
});

after(() => {
  delete require.cache[require.resolve('../src/db/client')];
  delete require.cache[require.resolve('../services/auditLog')];
  delete require.cache[require.resolve('../services/delegationService')];
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DelegationService', () => {
  let createDelegation, getActiveDelegationForApprover, revokeDelegation;

  before(() => {
    ({ createDelegation, getActiveDelegationForApprover, revokeDelegation } = require('../services/delegationService'));
  });

  beforeEach(() => {
    mockUsers.clear();
    mockDelegations.clear();
    mockRolePerms.clear();
    _idCounter = 1;

    // Seed two approver users
    mockUsers.set('user-a', { id: 'user-a', email: 'a@example.com', role: 'approver', roleId: null });
    mockUsers.set('user-b', { id: 'user-b', email: 'b@example.com', role: 'approver', roleId: null });
    mockUsers.set('user-admin', { id: 'user-admin', email: 'admin@example.com', role: 'admin', roleId: null });
    mockUsers.set('user-viewer', { id: 'user-viewer', email: 'viewer@example.com', role: 'viewer', roleId: null });
  });

  // ─── createDelegation ────────────────────────────────────────────────────

  describe('createDelegation', () => {
    it('creates a valid delegation', async () => {
      const start = new Date('2026-03-20');
      const end = new Date('2026-03-27');
      const delegation = await createDelegation({
        delegatorId: 'user-a',
        delegateId: 'user-b',
        startDate: start,
        endDate: end,
      });
      assert.equal(delegation.delegatorId, 'user-a');
      assert.equal(delegation.delegateId, 'user-b');
      assert.equal(delegation.revokedAt, null);
    });

    it('rejects self-delegation', async () => {
      await assert.rejects(
        () => createDelegation({ delegatorId: 'user-a', delegateId: 'user-a', startDate: new Date('2026-03-20'), endDate: new Date('2026-03-27') }),
        err => { assert.equal(err.code, 'INVALID_DELEGATE'); return true; }
      );
    });

    it('rejects invalid date range (start >= end)', async () => {
      await assert.rejects(
        () => createDelegation({ delegatorId: 'user-a', delegateId: 'user-b', startDate: new Date('2026-03-27'), endDate: new Date('2026-03-20') }),
        err => { assert.equal(err.code, 'INVALID_DATES'); return true; }
      );
    });

    it('rejects delegation to a viewer (insufficient role)', async () => {
      await assert.rejects(
        () => createDelegation({ delegatorId: 'user-a', delegateId: 'user-viewer', startDate: new Date('2026-03-20'), endDate: new Date('2026-03-27') }),
        err => { assert.equal(err.code, 'INVALID_DELEGATE_ROLE'); return true; }
      );
    });

    it('accepts delegation to admin role', async () => {
      const delegation = await createDelegation({
        delegatorId: 'user-a',
        delegateId: 'user-admin',
        startDate: new Date('2026-03-20'),
        endDate: new Date('2026-03-27'),
      });
      assert.equal(delegation.delegateId, 'user-admin');
    });

    it('detects direct circular delegation', async () => {
      // B already has an active delegation to A
      const now = new Date();
      const activeDelegation = buildDelegation({
        delegatorId: 'user-b',
        delegateId: 'user-a',
        startDate: new Date(now.getTime() - 1000),
        endDate: new Date(now.getTime() + 86400000),
      });
      mockDelegations.set(activeDelegation.id, activeDelegation);

      // Now A tries to delegate to B — should fail (A → B, but B → A already exists)
      await assert.rejects(
        () => createDelegation({ delegatorId: 'user-a', delegateId: 'user-b', startDate: new Date('2026-03-20'), endDate: new Date('2026-03-27') }),
        err => { assert.equal(err.code, 'CIRCULAR_DELEGATION'); return true; }
      );
    });

    it('rejects overlapping delegation for same delegator', async () => {
      const start = new Date('2026-03-20');
      const end = new Date('2026-03-27');
      // Create initial delegation
      await createDelegation({ delegatorId: 'user-a', delegateId: 'user-b', startDate: start, endDate: end });

      // Overlapping range
      await assert.rejects(
        () => createDelegation({ delegatorId: 'user-a', delegateId: 'user-b', startDate: new Date('2026-03-22'), endDate: new Date('2026-03-29') }),
        err => { assert.equal(err.code, 'DELEGATION_CONFLICT'); return true; }
      );
    });

    it('rejects if delegate user not found', async () => {
      await assert.rejects(
        () => createDelegation({ delegatorId: 'user-a', delegateId: 'nonexistent', startDate: new Date('2026-03-20'), endDate: new Date('2026-03-27') }),
        err => { assert.equal(err.code, 'NOT_FOUND'); return true; }
      );
    });
  });

  // ─── getActiveDelegationForApprover ──────────────────────────────────────

  describe('getActiveDelegationForApprover', () => {
    it('returns null when no active delegation', async () => {
      const result = await getActiveDelegationForApprover('user-a');
      assert.equal(result, null);
    });

    it('returns active delegation within date range', async () => {
      const now = new Date();
      const d = buildDelegation({
        delegatorId: 'user-a',
        delegateId: 'user-b',
        startDate: new Date(now.getTime() - 86400000),
        endDate: new Date(now.getTime() + 86400000),
      });
      mockDelegations.set(d.id, d);

      const result = await getActiveDelegationForApprover('user-a');
      assert.ok(result);
      assert.equal(result.delegateId, 'user-b');
    });

    it('does not return a revoked delegation', async () => {
      const now = new Date();
      const d = buildDelegation({
        delegatorId: 'user-a',
        delegateId: 'user-b',
        startDate: new Date(now.getTime() - 86400000),
        endDate: new Date(now.getTime() + 86400000),
        revokedAt: now,
      });
      mockDelegations.set(d.id, d);

      const result = await getActiveDelegationForApprover('user-a');
      assert.equal(result, null);
    });

    it('does not return an expired delegation', async () => {
      const now = new Date();
      const d = buildDelegation({
        delegatorId: 'user-a',
        delegateId: 'user-b',
        startDate: new Date(now.getTime() - 2 * 86400000),
        endDate: new Date(now.getTime() - 86400000),
      });
      mockDelegations.set(d.id, d);

      const result = await getActiveDelegationForApprover('user-a');
      assert.equal(result, null);
    });
  });

  // ─── revokeDelegation ────────────────────────────────────────────────────

  describe('revokeDelegation', () => {
    it('revokes an existing delegation', async () => {
      const d = buildDelegation({
        delegatorId: 'user-a',
        delegateId: 'user-b',
        startDate: new Date('2026-03-20'),
        endDate: new Date('2026-03-27'),
      });
      mockDelegations.set(d.id, d);

      const revoked = await revokeDelegation(d.id, 'user-admin');
      assert.ok(revoked.revokedAt);
      assert.equal(revoked.revokedById, 'user-admin');
    });

    it('throws NOT_FOUND for missing delegation', async () => {
      await assert.rejects(
        () => revokeDelegation('nonexistent', 'user-admin'),
        err => { assert.equal(err.code, 'NOT_FOUND'); return true; }
      );
    });

    it('throws ALREADY_REVOKED for already-revoked delegation', async () => {
      const d = buildDelegation({
        delegatorId: 'user-a',
        delegateId: 'user-b',
        startDate: new Date('2026-03-20'),
        endDate: new Date('2026-03-27'),
        revokedAt: new Date(),
      });
      mockDelegations.set(d.id, d);

      await assert.rejects(
        () => revokeDelegation(d.id, 'user-admin'),
        err => { assert.equal(err.code, 'ALREADY_REVOKED'); return true; }
      );
    });
  });
});
