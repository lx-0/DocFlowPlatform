'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Prisma mock setup ────────────────────────────────────────────────────────

const mockRolePermissions = new Map();
let mockDbError = null;

const mockPrisma = {
  rolePermission: {
    findMany: async ({ where }) => {
      if (mockDbError) throw mockDbError;
      const roleId = where && where.roleId;
      const entries = Array.from(mockRolePermissions.values()).filter(
        (rp) => rp.roleId === roleId
      );
      return entries;
    },
  },
};

// Inject mock before requiring middleware
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
  delete require.cache[require.resolve('../middleware/rbac')];
});

// Helper: seed a role with a list of permission names
function seedRole(roleId, permissionNames) {
  for (const name of permissionNames) {
    const id = `${roleId}:${name}`;
    mockRolePermissions.set(id, {
      roleId,
      permissionId: id,
      permission: { id, name },
    });
  }
}

function clearMockData() {
  mockRolePermissions.clear();
  mockDbError = null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('requirePermission middleware', () => {
  let requirePermission;
  let invalidateRoleCache;

  before(() => {
    ({ requirePermission, invalidateRoleCache } = require('../middleware/rbac'));
  });

  beforeEach(() => {
    clearMockData();
    invalidateRoleCache(); // clear cache between tests
  });

  // Helper to call middleware and get result
  function callMiddleware(middleware, req) {
    return new Promise((resolve) => {
      const res = {
        statusCode: 200,
        body: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.body = data;
          resolve({ status: this.statusCode, body: data, next: false });
        },
      };
      const next = () => resolve({ status: 200, body: null, next: true });
      middleware(req, res, next);
    });
  }

  describe('allowed scenario', () => {
    it('calls next() when user has the required permission', async () => {
      seedRole('role-1', ['documents:read']);
      const req = { user: { role: 'user', roleId: 'role-1' } };
      const middleware = requirePermission('documents:read');
      const result = await callMiddleware(middleware, req);
      assert.equal(result.next, true);
    });
  });

  describe('denied scenario', () => {
    it('returns 403 when user lacks the required permission', async () => {
      seedRole('role-2', ['documents:read']);
      const req = { user: { role: 'user', roleId: 'role-2' } };
      const middleware = requirePermission('documents:write');
      const result = await callMiddleware(middleware, req);
      assert.equal(result.status, 403);
      assert.equal(result.body.error, 'Forbidden');
      assert.equal(result.body.required, 'documents:write');
    });

    it('returns 403 when user has no roleId', async () => {
      const req = { user: { role: 'user', roleId: null } };
      const middleware = requirePermission('documents:read');
      const result = await callMiddleware(middleware, req);
      assert.equal(result.status, 403);
      assert.equal(result.body.error, 'Forbidden');
    });

    it('returns 403 when role has no permissions at all', async () => {
      seedRole('role-empty', []);
      const req = { user: { role: 'user', roleId: 'role-empty' } };
      const middleware = requirePermission('documents:read');
      const result = await callMiddleware(middleware, req);
      assert.equal(result.status, 403);
    });
  });

  describe('missing-token scenario', () => {
    it('returns 403 when req.user is not set', async () => {
      const req = {};
      const middleware = requirePermission('documents:read');
      const result = await callMiddleware(middleware, req);
      assert.equal(result.status, 403);
      assert.equal(result.body.error, 'Forbidden');
    });
  });

  describe('superadmin bypass', () => {
    it('calls next() for admin users regardless of roleId', async () => {
      const req = { user: { role: 'admin', roleId: null } };
      const middleware = requirePermission('documents:write');
      const result = await callMiddleware(middleware, req);
      assert.equal(result.next, true);
    });

    it('calls next() for admin users without hitting the DB', async () => {
      mockDbError = new Error('Should not query DB');
      const req = { user: { role: 'admin', roleId: 'some-role' } };
      const middleware = requirePermission('admin:users');
      const result = await callMiddleware(middleware, req);
      assert.equal(result.next, true);
    });
  });

  describe('permission caching', () => {
    it('serves subsequent requests from cache', async () => {
      let dbCallCount = 0;
      const origFindMany = mockPrisma.rolePermission.findMany;
      mockPrisma.rolePermission.findMany = async (args) => {
        dbCallCount++;
        return origFindMany(args);
      };

      seedRole('role-cache', ['documents:read']);
      invalidateRoleCache('role-cache');
      const middleware = requirePermission('documents:read');
      const req = { user: { role: 'user', roleId: 'role-cache' } };

      await callMiddleware(middleware, req);
      await callMiddleware(middleware, req);

      assert.equal(dbCallCount, 1, 'DB should only be called once (second request served from cache)');

      // restore
      mockPrisma.rolePermission.findMany = origFindMany;
    });
  });
});
