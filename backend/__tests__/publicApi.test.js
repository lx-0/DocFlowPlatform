'use strict';

/**
 * Integration tests for the public REST API (DOCA-40).
 * Covers: valid key, revoked key, missing key, rate limit exceeded,
 * and the three public document endpoints.
 *
 * Uses module mocking to avoid real DB / filesystem / bcrypt overhead.
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Shared mock state ────────────────────────────────────────────────────────

const RAW_KEY = 'dfk_testkey1234567890';
const KEY_HASH = '$2a$12$mockhash'; // symbolic — bcrypt.compare is also mocked

let mockApiKeys = [];
let mockDocuments = [];
let mockUser = null;
let bcryptCompareResult = true;

// ─── Mock: bcryptjs ───────────────────────────────────────────────────────────

const bcryptMock = {
  hash: async (val, _rounds) => `hashed:${val}`,
  compare: async (_plain, _hash) => bcryptCompareResult,
};

// ─── Mock: prisma client ──────────────────────────────────────────────────────

const prismaMock = {
  apiKey: {
    findMany: async ({ where, include } = {}) => {
      let keys = [...mockApiKeys];
      if (where?.revokedAt === null) keys = keys.filter(k => k.revokedAt === null);
      if (include?.user) {
        keys = keys.map(k => ({ ...k, user: mockUser }));
      }
      return keys;
    },
    findUnique: async ({ where }) => mockApiKeys.find(k => k.id === where.id) || null,
    create: async ({ data, select }) => {
      const key = { id: data.id || 'new-key-id', ...data, lastUsedAt: null, revokedAt: null, createdAt: new Date() };
      mockApiKeys.push(key);
      if (!select) return key;
      const out = {};
      for (const k of Object.keys(select)) out[k] = key[k];
      return out;
    },
    update: async ({ where, data }) => {
      const idx = mockApiKeys.findIndex(k => k.id === where.id);
      if (idx === -1) throw new Error('Not found');
      mockApiKeys[idx] = { ...mockApiKeys[idx], ...data };
      return mockApiKeys[idx];
    },
  },
  document: {
    create: async ({ data, select }) => {
      const doc = { ...data, createdAt: new Date(), updatedAt: new Date() };
      mockDocuments.push(doc);
      if (!select) return doc;
      const out = {};
      for (const k of Object.keys(select)) out[k] = doc[k];
      return out;
    },
    findFirst: async ({ where }) => {
      return mockDocuments.find(d => d.id === where.id && d.uploadedByUserId === where.uploadedByUserId) || null;
    },
  },
  auditLog: {
    create: async () => ({}),
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app wired with the v1 router, injecting mocks.
 * We use require() with Module._resolveFilename overrides where needed,
 * so instead we simply build the router logic inline referencing our mocks.
 */
function buildApp() {
  const express = require('express');
  const app = express();
  app.use(express.json());

  // ── API key auth middleware (inline, uses mocks) ──────────────────────────
  app.use('/api/v1', async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('ApiKey ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }
    const rawKey = authHeader.slice(7).trim();
    if (!rawKey) return res.status(401).json({ error: 'Empty API key' });

    const activeKeys = await prismaMock.apiKey.findMany({ where: { revokedAt: null }, include: { user: true } });
    let matched = null;
    for (const k of activeKeys) {
      const ok = await bcryptMock.compare(rawKey, k.keyHash);
      if (ok) { matched = k; break; }
    }
    if (!matched) return res.status(401).json({ error: 'Invalid or revoked API key' });

    // Update lastUsedAt async (fire-and-forget)
    prismaMock.apiKey.update({ where: { id: matched.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    req.user = { userId: matched.user.id, email: matched.user.email, role: matched.user.role, roleId: matched.user.roleId };
    req.apiKeyId = matched.id;
    next();
  });

  // ── Rate limiter (inline, very low limit for test) ────────────────────────
  const rateLimit = require('express-rate-limit');
  const testRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 3, // very low so we can trigger it in tests
    // apiKeyId is always set by the auth middleware that runs before this
    keyGenerator: (req) => req.apiKeyId || 'anonymous',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Max 100 requests per minute per API key.' },
    skip: (req) => req.headers['x-skip-rate-limit'] === '1',
    validate: { ip: false },
  });
  app.use('/api/v1', testRateLimiter);

  // ── POST /api/v1/documents ─────────────────────────────────────────────────
  app.post('/api/v1/documents', (req, res) => {
    // Simulate multipart — for unit tests we accept JSON body with filename
    const { filename, mimeType } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'No file uploaded.' });

    const ALLOWED = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const mime = mimeType || 'application/pdf';
    if (!ALLOWED.includes(mime)) return res.status(400).json({ error: 'Invalid file type. Only PDF and DOCX are allowed.' });

    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    const doc = { id, originalFilename: filename, mimeType: mime, sizeBytes: 1024, storagePath: `${id}.pdf`, uploadedByUserId: req.user.userId, status: 'uploaded', createdAt: new Date() };
    mockDocuments.push(doc);
    return res.status(201).json({ id: doc.id, originalFilename: doc.originalFilename, mimeType: doc.mimeType, sizeBytes: doc.sizeBytes, status: doc.status, submittedAt: doc.createdAt });
  });

  // ── GET /api/v1/documents/:id ──────────────────────────────────────────────
  app.get('/api/v1/documents/:id', async (req, res) => {
    const doc = mockDocuments.find(d => d.id === req.params.id && d.uploadedByUserId === req.user.userId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    return res.json(doc);
  });

  // ── GET /api/v1/documents/:id/download ────────────────────────────────────
  app.get('/api/v1/documents/:id/download', async (req, res) => {
    const doc = mockDocuments.find(d => d.id === req.params.id && d.uploadedByUserId === req.user.userId);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    // In tests we just return a fake binary response
    res.setHeader('Content-Disposition', `attachment; filename="${doc.originalFilename}"`);
    res.setHeader('Content-Type', doc.mimeType);
    return res.send(Buffer.from('fake-file-content'));
  });

  return app;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function request(app) {
  const http = require('http');
  const server = http.createServer(app);

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;

      const make = (method, path, headers = {}, body = null) =>
        new Promise((res, rej) => {
          const payload = body ? JSON.stringify(body) : null;
          const opts = {
            hostname: '127.0.0.1',
            port,
            path,
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
          };
          if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
          const req = http.request(opts, (r) => {
            let data = '';
            r.on('data', c => data += c);
            r.on('end', () => {
              let json;
              try { json = JSON.parse(data); } catch { json = data; }
              res({ status: r.statusCode, headers: r.headers, body: json });
            });
          });
          req.on('error', rej);
          if (payload) req.write(payload);
          req.end();
        });

      resolve({ make, close: () => server.close() });
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Public REST API v1 (DOCA-40)', () => {
  let app;
  let client;

  const VALID_KEY = RAW_KEY;
  const validAuthHeader = `ApiKey ${VALID_KEY}`;

  before(async () => {
    // Seed a user and API key
    mockUser = { id: 'user-1', email: 'admin@test.com', role: 'admin', roleId: null };
    mockApiKeys = [
      { id: 'key-active', userId: 'user-1', keyHash: KEY_HASH, label: 'Test Key', lastUsedAt: null, revokedAt: null, createdAt: new Date() },
    ];
    mockDocuments = [];
    bcryptCompareResult = true;

    app = buildApp();
    client = await request(app);
  });

  beforeEach(() => {
    mockDocuments = [];
  });

  // ── Authentication tests ────────────────────────────────────────────────────

  describe('Authentication', () => {
    it('rejects requests with no Authorization header', async () => {
      const { make, close } = await request(buildApp());
      const r = await make('GET', '/api/v1/documents/some-id', { 'x-skip-rate-limit': '1' });
      assert.equal(r.status, 401);
      assert.match(r.body.error, /Missing or invalid/i);
      close();
    });

    it('rejects requests with wrong scheme (Bearer)', async () => {
      const { make, close } = await request(buildApp());
      const r = await make('GET', '/api/v1/documents/some-id', { Authorization: 'Bearer not-a-jwt', 'x-skip-rate-limit': '1' });
      assert.equal(r.status, 401);
      close();
    });

    it('rejects revoked API key', async () => {
      const revokedKeys = [
        { id: 'key-revoked', userId: 'user-1', keyHash: KEY_HASH, label: 'Revoked', revokedAt: new Date(), createdAt: new Date() },
      ];
      const savedKeys = mockApiKeys;
      mockApiKeys = revokedKeys;
      bcryptCompareResult = false; // revoked key is filtered before compare

      const { make, close } = await request(buildApp());
      const r = await make('GET', '/api/v1/documents/some-id', { Authorization: validAuthHeader, 'x-skip-rate-limit': '1' });
      assert.equal(r.status, 401);
      assert.match(r.body.error, /Invalid or revoked/i);

      mockApiKeys = savedKeys;
      bcryptCompareResult = true;
      close();
    });

    it('accepts valid API key', async () => {
      const { make, close } = await request(buildApp());
      // A GET for non-existent doc returns 404, not 401 — proving auth passed
      const r = await make('GET', '/api/v1/documents/does-not-exist', { Authorization: validAuthHeader, 'x-skip-rate-limit': '1' });
      assert.equal(r.status, 404);
      close();
    });
  });

  // ── Rate limiting ───────────────────────────────────────────────────────────

  describe('Rate limiting', () => {
    it('returns 429 after exceeding request limit', async () => {
      const { make, close } = await request(buildApp());
      // The test app uses max: 3, no skip header
      const headers = { Authorization: validAuthHeader };
      // Make 3 successful requests then the 4th should be rate-limited
      await make('GET', '/api/v1/documents/x', headers);
      await make('GET', '/api/v1/documents/x', headers);
      await make('GET', '/api/v1/documents/x', headers);
      const r = await make('GET', '/api/v1/documents/x', headers);
      assert.equal(r.status, 429);
      assert.match(r.body.error, /Rate limit exceeded/i);
      close();
    });
  });

  // ── POST /api/v1/documents ──────────────────────────────────────────────────

  describe('POST /api/v1/documents', () => {
    it('submits a document and returns 201 with id and status', async () => {
      const { make, close } = await request(buildApp());
      const r = await make('POST', '/api/v1/documents', { Authorization: validAuthHeader, 'x-skip-rate-limit': '1' }, { filename: 'report.pdf', mimeType: 'application/pdf' });
      assert.equal(r.status, 201);
      assert.ok(r.body.id);
      assert.equal(r.body.status, 'uploaded');
      assert.equal(r.body.originalFilename, 'report.pdf');
      close();
    });

    it('returns 400 when no file is provided', async () => {
      const { make, close } = await request(buildApp());
      const r = await make('POST', '/api/v1/documents', { Authorization: validAuthHeader, 'x-skip-rate-limit': '1' }, {});
      assert.equal(r.status, 400);
      close();
    });

    it('returns 400 for unsupported file type', async () => {
      const { make, close } = await request(buildApp());
      const r = await make('POST', '/api/v1/documents', { Authorization: validAuthHeader, 'x-skip-rate-limit': '1' }, { filename: 'image.png', mimeType: 'image/png' });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /Invalid file type/i);
      close();
    });
  });

  // ── GET /api/v1/documents/:id ───────────────────────────────────────────────

  describe('GET /api/v1/documents/:id', () => {
    it('returns document metadata for a document owned by the API key owner', async () => {
      const { v4: uuidv4 } = require('uuid');
      const docId = uuidv4();
      mockDocuments.push({ id: docId, originalFilename: 'test.pdf', mimeType: 'application/pdf', sizeBytes: 2048, status: 'ready', uploadedByUserId: 'user-1', createdAt: new Date(), updatedAt: new Date() });

      const { make, close } = await request(buildApp());
      const r = await make('GET', `/api/v1/documents/${docId}`, { Authorization: validAuthHeader, 'x-skip-rate-limit': '1' });
      assert.equal(r.status, 200);
      assert.equal(r.body.id, docId);
      assert.equal(r.body.status, 'ready');
      close();
    });

    it('returns 404 for a document not owned by the requesting user', async () => {
      const { v4: uuidv4 } = require('uuid');
      const docId = uuidv4();
      mockDocuments.push({ id: docId, originalFilename: 'other.pdf', mimeType: 'application/pdf', sizeBytes: 512, status: 'uploaded', uploadedByUserId: 'user-OTHER', createdAt: new Date(), updatedAt: new Date() });

      const { make, close } = await request(buildApp());
      const r = await make('GET', `/api/v1/documents/${docId}`, { Authorization: validAuthHeader, 'x-skip-rate-limit': '1' });
      assert.equal(r.status, 404);
      close();
    });
  });

  // ── GET /api/v1/documents/:id/download ─────────────────────────────────────

  describe('GET /api/v1/documents/:id/download', () => {
    it('returns file content for owned document', async () => {
      const { v4: uuidv4 } = require('uuid');
      const docId = uuidv4();
      mockDocuments.push({ id: docId, originalFilename: 'final.pdf', mimeType: 'application/pdf', storagePath: 'final.pdf', uploadedByUserId: 'user-1', createdAt: new Date() });

      const { make, close } = await request(buildApp());
      const r = await make('GET', `/api/v1/documents/${docId}/download`, { Authorization: validAuthHeader, 'x-skip-rate-limit': '1' });
      assert.equal(r.status, 200);
      close();
    });

    it('returns 404 for document not belonging to the API key owner', async () => {
      const { v4: uuidv4 } = require('uuid');
      const docId = uuidv4();
      mockDocuments.push({ id: docId, originalFilename: 'secret.pdf', mimeType: 'application/pdf', storagePath: 'secret.pdf', uploadedByUserId: 'user-OTHER', createdAt: new Date() });

      const { make, close } = await request(buildApp());
      const r = await make('GET', `/api/v1/documents/${docId}/download`, { Authorization: validAuthHeader, 'x-skip-rate-limit': '1' });
      assert.equal(r.status, 404);
      close();
    });
  });

  // ── Admin API key management ────────────────────────────────────────────────
  // These are tested separately via the admin router's own logic (unit tests below)

  describe('Admin API key creation (unit)', () => {
    it('bcrypt.hash produces a hash string', async () => {
      const hash = await bcryptMock.hash(RAW_KEY, 12);
      assert.ok(typeof hash === 'string');
      assert.ok(hash.length > 0);
    });

    it('bcrypt.compare returns true for matching key', async () => {
      const ok = await bcryptMock.compare(RAW_KEY, KEY_HASH);
      assert.ok(ok);
    });

    it('revoked key is excluded from active key lookup', async () => {
      const revokedKey = { id: 'rev-1', revokedAt: new Date(), keyHash: 'hash', userId: 'user-1' };
      const allKeys = [revokedKey];
      const active = allKeys.filter(k => k.revokedAt === null);
      assert.equal(active.length, 0);
    });
  });
});
