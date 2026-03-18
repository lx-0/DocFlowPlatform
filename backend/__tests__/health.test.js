'use strict';

/**
 * Unit tests for the /health and /health/live endpoints (DOCA-76).
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Mock: prisma client ──────────────────────────────────────────────────────

let prismaQueryRawShouldFail = false;

require('module').Module._resolveFilename = (() => {
  const orig = require('module').Module._resolveFilename.bind(require('module').Module);
  return function (request, parent, ...rest) {
    return orig(request, parent, ...rest);
  };
})();

// We use module mocking via register/require tricks. For simplicity use a
// direct approach: patch the controller after mocking its deps.

// ─── Mock: fs ────────────────────────────────────────────────────────────────

let fsShouldFail = false;
const fsMock = {
  writeFileSync: (p, d) => { if (fsShouldFail) throw new Error('EACCES'); },
  unlinkSync: (p) => {},
};

// ─── Mock: prisma ─────────────────────────────────────────────────────────────

const prismaMock = {
  $queryRaw: async () => { if (prismaQueryRawShouldFail) throw new Error('DB error'); return [{ '?column?': 1 }]; },
};

// ─── Load controller with mocked deps ────────────────────────────────────────

const Module = require('module');
const origLoad = Module._load.bind(Module);
Module._load = function (request, parent, isMain) {
  if (request === 'fs') return fsMock;
  if (request.endsWith('src/db/client') || request.endsWith('/client')) return prismaMock;
  return origLoad(request, parent, isMain);
};

const controller = require('../controllers/healthController');

// Restore original _load after controller is loaded
Module._load = origLoad;

// ─── Helper: mock req/res ─────────────────────────────────────────────────────

function mockRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json = (body) => { res._body = body; return res; };
  return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /health/live', () => {
  it('returns 200 immediately', () => {
    const res = mockRes();
    controller.getLive({}, res);
    assert.equal(res._status, 200);
    assert.deepEqual(res._body, { status: 'ok' });
  });
});

describe('GET /health', () => {
  beforeEach(() => {
    prismaQueryRawShouldFail = false;
    fsShouldFail = false;
    delete process.env.SMTP_HOST;
  });

  it('returns 200 with all-ok when dependencies are healthy', async () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    const res = mockRes();
    await controller.getHealth({}, res);
    assert.equal(res._status, 200);
    assert.equal(res._body.status, 'ok');
    assert.equal(res._body.db, 'ok');
    assert.equal(res._body.storage, 'ok');
    assert.equal(res._body.email, 'ok');
    assert.ok(res._body.timestamp);
  });

  it('returns 503 degraded when DB is down', async () => {
    prismaQueryRawShouldFail = true;
    const res = mockRes();
    await controller.getHealth({}, res);
    assert.equal(res._status, 503);
    assert.equal(res._body.status, 'degraded');
    assert.equal(res._body.db, 'error');
  });

  it('returns 503 degraded when storage is not writable', async () => {
    fsShouldFail = true;
    const res = mockRes();
    await controller.getHealth({}, res);
    assert.equal(res._status, 503);
    assert.equal(res._body.status, 'degraded');
    assert.equal(res._body.storage, 'error');
  });

  it('reports email unconfigured when SMTP_HOST is not set', async () => {
    const res = mockRes();
    await controller.getHealth({}, res);
    assert.equal(res._body.email, 'unconfigured');
  });

  it('does not expose sensitive data', async () => {
    const res = mockRes();
    await controller.getHealth({}, res);
    const keys = Object.keys(res._body);
    assert.deepEqual(keys.sort(), ['db', 'email', 'status', 'storage', 'timestamp'].sort());
  });
});
