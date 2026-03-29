'use strict';

/**
 * Tests for POST /api/approvals/bulk-act (DOCA-67).
 * Covers: validation, excluded types, per-document audit, partial failure isolation.
 *
 * Uses module-cache injection to avoid real DB / auth overhead.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// ─── Mock state ───────────────────────────────────────────────────────────────

let mockWorkflows = new Map();
let mockConfig = new Map();
let mockActOnStepCalls = [];
let mockLogEventCalls = [];
let mockActOnStepError = null; // set to throw for a workflowId

// ─── Mock: prisma client ──────────────────────────────────────────────────────

const prismaMock = {
  approvalWorkflow: {
    findUnique: async ({ where, include }) => {
      const wf = mockWorkflows.get(where.id);
      if (!wf) return null;
      if (include?.document) {
        return { ...wf, document: wf._document || null };
      }
      return { ...wf };
    },
  },
  systemConfig: {
    findUnique: async ({ where }) => {
      const val = mockConfig.get(where.key);
      if (val === undefined) return null;
      return { key: where.key, value: val };
    },
  },
};

// ─── Mock: workflowService ────────────────────────────────────────────────────

const workflowServiceMock = {
  actOnStep: async (workflowId, stepNumber, userId, action, comment) => {
    mockActOnStepCalls.push({ workflowId, stepNumber, userId, action, comment });
    if (mockActOnStepError && mockActOnStepError.workflowId === workflowId) {
      const err = new Error(mockActOnStepError.message);
      err.code = mockActOnStepError.code;
      throw err;
    }
    const wf = mockWorkflows.get(workflowId);
    return { ...wf, status: action === 'approved' ? 'approved' : 'rejected', documentId: wf.documentId };
  },
};

// ─── Mock: auditLog ───────────────────────────────────────────────────────────

const auditLogMock = {
  logEvent: (args) => { mockLogEventCalls.push(args); },
};

// ─── App builder ──────────────────────────────────────────────────────────────

function buildApp() {
  // Inject mocks before requiring the route
  require.cache[require.resolve('../src/db/client')] = {
    id: require.resolve('../src/db/client'),
    filename: require.resolve('../src/db/client'),
    loaded: true,
    exports: prismaMock,
  };
  require.cache[require.resolve('../services/workflowService')] = {
    id: require.resolve('../services/workflowService'),
    filename: require.resolve('../services/workflowService'),
    loaded: true,
    exports: workflowServiceMock,
  };
  require.cache[require.resolve('../services/auditLog')] = {
    id: require.resolve('../services/auditLog'),
    filename: require.resolve('../services/auditLog'),
    loaded: true,
    exports: auditLogMock,
  };
  // Mock auth middleware — always passes as a user with documents:approve permission
  require.cache[require.resolve('../middleware/auth')] = {
    id: require.resolve('../middleware/auth'),
    filename: require.resolve('../middleware/auth'),
    loaded: true,
    exports: {
      authenticate: (req, _res, next) => {
        req.user = { id: 'user-1', userId: 'user-1', email: 'approver@example.com', role: 'approver', roleId: 'role-approver' };
        next();
      },
    },
  };
  // Mock rbac middleware — always passes
  require.cache[require.resolve('../middleware/rbac')] = {
    id: require.resolve('../middleware/rbac'),
    filename: require.resolve('../middleware/rbac'),
    loaded: true,
    exports: {
      requirePermission: (_perm) => (_req, _res, next) => next(),
      invalidateRoleCache: () => {},
    },
  };

  const express = require('express');
  const app = express();
  app.use(express.json());
  const approvalsRoute = require('../routes/approvals');
  app.use('/api/approvals', approvalsRoute);
  return app;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function makeRequest(app, method, path, body) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const payload = body ? JSON.stringify(body) : null;
      const opts = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
      };
      const req = http.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          server.close();
          let json;
          try { json = JSON.parse(data); } catch { json = data; }
          resolve({ status: res.statusCode, body: json });
        });
      });
      req.on('error', (e) => { server.close(); reject(e); });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedWorkflow(id, opts = {}) {
  const wf = {
    id,
    documentId: opts.documentId || `doc-${id}`,
    queueName: opts.queueName || 'legal',
    currentStep: opts.currentStep || 1,
    totalSteps: opts.totalSteps || 1,
    status: 'pending',
    _document: opts.documentType
      ? { metadata: { documentType: opts.documentType } }
      : { metadata: null },
  };
  mockWorkflows.set(id, wf);
  return wf;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/approvals/bulk-act', () => {
  let app;

  before(() => {
    app = buildApp();
  });

  after(() => {
    // Clean up module cache so other tests are unaffected
    [
      '../src/db/client',
      '../services/workflowService',
      '../services/auditLog',
      '../middleware/auth',
      '../middleware/rbac',
      '../routes/approvals',
    ].forEach(m => { try { delete require.cache[require.resolve(m)]; } catch {} });
  });

  beforeEach(() => {
    mockWorkflows.clear();
    mockConfig.clear();
    mockActOnStepCalls = [];
    mockLogEventCalls = [];
    mockActOnStepError = null;
  });

  // ─── Validation ─────────────────────────────────────────────────────────────

  it('returns 400 when workflowIds is missing', async () => {
    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      action: 'approved', comment: 'LGTM',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /workflowIds/);
  });

  it('returns 400 when workflowIds is empty array', async () => {
    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: [], action: 'approved', comment: 'LGTM',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /workflowIds/);
  });

  it('returns 400 when more than 50 workflowIds are sent', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `wf-${i}`);
    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ids, action: 'approved', comment: 'LGTM',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /50/);
  });

  it('returns 400 for invalid action', async () => {
    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ['wf-1'], action: 'changes_requested', comment: 'See notes',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /action/);
  });

  it('returns 400 when comment is missing', async () => {
    seedWorkflow('wf-1');
    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ['wf-1'], action: 'approved',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /comment/);
  });

  it('returns 400 when comment is empty string', async () => {
    seedWorkflow('wf-1');
    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ['wf-1'], action: 'approved', comment: '   ',
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /comment/);
  });

  // ─── Successful bulk approval ─────────────────────────────────────────────

  it('approves multiple workflows and returns results', async () => {
    seedWorkflow('wf-a');
    seedWorkflow('wf-b');

    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ['wf-a', 'wf-b'], action: 'approved', comment: 'All good',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.succeeded, 2);
    assert.equal(res.body.failed, 0);
    assert.equal(res.body.results.length, 2);
    assert.equal(res.body.results[0].success, true);
    assert.equal(res.body.results[1].success, true);
  });

  it('calls actOnStep for each selected workflow with correct args', async () => {
    seedWorkflow('wf-x', { currentStep: 1 });

    await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ['wf-x'], action: 'rejected', comment: 'Missing signature',
    });

    assert.equal(mockActOnStepCalls.length, 1);
    const call = mockActOnStepCalls[0];
    assert.equal(call.workflowId, 'wf-x');
    assert.equal(call.action, 'rejected');
    assert.equal(call.comment, 'Missing signature');
    assert.equal(call.userId, 'user-1');
  });

  it('writes an individual audit log entry per document', async () => {
    seedWorkflow('wf-audit-1');
    seedWorkflow('wf-audit-2');

    await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ['wf-audit-1', 'wf-audit-2'], action: 'approved', comment: 'Reviewed',
    });

    assert.equal(mockLogEventCalls.length, 2);
    const ids = mockLogEventCalls.map(e => e.targetId);
    assert.ok(ids.includes('wf-audit-1'));
    assert.ok(ids.includes('wf-audit-2'));
    // Each audit entry must have bulk: true in metadata
    for (const entry of mockLogEventCalls) {
      assert.equal(entry.metadata.bulk, true);
    }
  });

  // ─── Excluded document types ──────────────────────────────────────────────

  it('skips workflows whose document type is in excluded list', async () => {
    seedWorkflow('wf-high-value', { documentType: 'HighValueContract' });
    mockConfig.set('bulk_approval_excluded_types', JSON.stringify(['HighValueContract']));

    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ['wf-high-value'], action: 'approved', comment: 'LGTM',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.succeeded, 0);
    assert.equal(res.body.failed, 1);
    assert.match(res.body.results[0].error, /not eligible/);
    assert.equal(mockActOnStepCalls.length, 0);
  });

  it('allows a document type not in the excluded list even when list is configured', async () => {
    seedWorkflow('wf-routine', { documentType: 'RoutineReport' });
    mockConfig.set('bulk_approval_excluded_types', JSON.stringify(['HighValueContract']));

    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ['wf-routine'], action: 'approved', comment: 'LGTM',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.succeeded, 1);
    assert.equal(res.body.failed, 0);
  });

  // ─── Partial failure ──────────────────────────────────────────────────────

  it('continues processing remaining workflows when one fails', async () => {
    seedWorkflow('wf-good-1');
    seedWorkflow('wf-bad');
    seedWorkflow('wf-good-2');

    mockActOnStepError = { workflowId: 'wf-bad', message: 'Workflow is already completed', code: 'INVALID_STATE' };

    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ['wf-good-1', 'wf-bad', 'wf-good-2'], action: 'approved', comment: 'Batch review',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.succeeded, 2);
    assert.equal(res.body.failed, 1);

    const failed = res.body.results.find(r => r.workflowId === 'wf-bad');
    assert.equal(failed.success, false);
    assert.match(failed.error, /already completed/);
  });

  it('returns not-found error for unknown workflow without halting others', async () => {
    seedWorkflow('wf-real');

    const res = await makeRequest(app, 'POST', '/api/approvals/bulk-act', {
      workflowIds: ['wf-ghost', 'wf-real'], action: 'approved', comment: 'OK',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.succeeded, 1);
    assert.equal(res.body.failed, 1);

    const ghost = res.body.results.find(r => r.workflowId === 'wf-ghost');
    assert.match(ghost.error, /not found/i);
  });
});
