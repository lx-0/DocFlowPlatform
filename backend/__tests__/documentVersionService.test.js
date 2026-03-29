'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockVersions = new Map();
const mockConfigs = new Map();

let _idCounter = 1;
function nextId() { return `vid-${_idCounter++}`; }

function buildVersion(data) {
  return {
    id: data.id ?? nextId(),
    documentId: data.documentId,
    versionNumber: data.versionNumber,
    storagePath: data.storagePath,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    originalFilename: data.originalFilename,
    submittedByUserId: data.submittedByUserId,
    createdAt: new Date(),
  };
}

const mockPrisma = {
  $transaction: async (fn) => fn(mockPrisma),

  documentVersion: {
    findFirst: async ({ where, orderBy, select }) => {
      const docs = [...mockVersions.values()].filter(v => {
        if (where.documentId && v.documentId !== where.documentId) return false;
        return true;
      });
      if (orderBy?.versionNumber === 'desc') docs.sort((a, b) => b.versionNumber - a.versionNumber);
      else docs.sort((a, b) => a.versionNumber - b.versionNumber);
      const v = docs[0] ?? null;
      if (!v) return null;
      return select ? Object.fromEntries(Object.keys(select).map(k => [k, v[k]])) : v;
    },
    findMany: async ({ where, orderBy, select }) => {
      const docs = [...mockVersions.values()].filter(v => {
        if (where.documentId && v.documentId !== where.documentId) return false;
        if (where.id?.in && !where.id.in.includes(v.id)) return false;
        return true;
      });
      if (orderBy?.versionNumber === 'desc') docs.sort((a, b) => b.versionNumber - a.versionNumber);
      else docs.sort((a, b) => a.versionNumber - b.versionNumber);
      return select ? docs.map(v => Object.fromEntries(Object.keys(select).map(k => [k, v[k]]))) : docs;
    },
    findUnique: async ({ where }) => {
      if (where.documentId_versionNumber) {
        return [...mockVersions.values()].find(v =>
          v.documentId === where.documentId_versionNumber.documentId &&
          v.versionNumber === where.documentId_versionNumber.versionNumber
        ) ?? null;
      }
      return mockVersions.get(where.id) ?? null;
    },
    create: async ({ data }) => {
      const v = buildVersion(data);
      mockVersions.set(v.id, v);
      return v;
    },
    deleteMany: async ({ where }) => {
      const ids = where.id?.in ?? [];
      for (const id of ids) mockVersions.delete(id);
      return { count: ids.length };
    },
  },

  systemConfig: {
    findUnique: async ({ where }) => {
      const val = mockConfigs.get(where.key);
      return val != null ? { key: where.key, value: val } : null;
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
  delete require.cache[require.resolve('../services/documentVersionService')];
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DocumentVersionService', () => {
  let createVersion, listVersions, getLatestVersion, getVersion, diffVersions;

  before(() => {
    ({ createVersion, listVersions, getLatestVersion, getVersion, diffVersions } =
      require('../services/documentVersionService'));
  });

  beforeEach(() => {
    mockVersions.clear();
    mockConfigs.clear();
    _idCounter = 1;
  });

  // ─── createVersion ────────────────────────────────────────────────────────

  describe('createVersion', () => {
    it('creates version 1 for a new document', async () => {
      const v = await createVersion({
        documentId: 'doc-1',
        storagePath: 'file-a.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: 1024,
        originalFilename: 'report.docx',
        submittedByUserId: 'user-1',
      });
      assert.equal(v.versionNumber, 1);
      assert.equal(v.documentId, 'doc-1');
    });

    it('auto-increments version numbers', async () => {
      const params = { documentId: 'doc-1', storagePath: 'f.docx', mimeType: 'application/pdf', sizeBytes: 512, originalFilename: 'f.pdf', submittedByUserId: 'u1' };
      const v1 = await createVersion(params);
      const v2 = await createVersion({ ...params, storagePath: 'f2.docx' });
      const v3 = await createVersion({ ...params, storagePath: 'f3.docx' });
      assert.equal(v1.versionNumber, 1);
      assert.equal(v2.versionNumber, 2);
      assert.equal(v3.versionNumber, 3);
    });

    it('prunes oldest versions when max_versions_per_document is set', async () => {
      mockConfigs.set('max_versions_per_document', '2');
      const params = { documentId: 'doc-2', storagePath: 'x.docx', mimeType: 'application/pdf', sizeBytes: 100, originalFilename: 'x.pdf', submittedByUserId: 'u1' };
      await createVersion(params);
      await createVersion({ ...params, storagePath: 'x2.docx' });
      await createVersion({ ...params, storagePath: 'x3.docx' }); // triggers prune

      const remaining = await listVersions('doc-2');
      assert.equal(remaining.length, 2);
      // Should keep the two newest (v2 and v3)
      assert.equal(remaining[0].versionNumber, 3);
      assert.equal(remaining[1].versionNumber, 2);
    });

    it('does not prune when max is 0 (unlimited)', async () => {
      mockConfigs.set('max_versions_per_document', '0');
      const params = { documentId: 'doc-3', storagePath: 'y.docx', mimeType: 'application/pdf', sizeBytes: 100, originalFilename: 'y.pdf', submittedByUserId: 'u1' };
      for (let i = 0; i < 5; i++) await createVersion({ ...params, storagePath: `y${i}.docx` });
      const versions = await listVersions('doc-3');
      assert.equal(versions.length, 5);
    });
  });

  // ─── listVersions / getLatestVersion / getVersion ─────────────────────────

  describe('listVersions', () => {
    it('returns versions newest-first', async () => {
      const params = { documentId: 'doc-4', storagePath: 'z.docx', mimeType: 'application/pdf', sizeBytes: 100, originalFilename: 'z.pdf', submittedByUserId: 'u1' };
      await createVersion(params);
      await createVersion({ ...params, storagePath: 'z2.docx' });
      const versions = await listVersions('doc-4');
      assert.equal(versions[0].versionNumber, 2);
      assert.equal(versions[1].versionNumber, 1);
    });

    it('returns empty array for unknown document', async () => {
      const versions = await listVersions('unknown-doc');
      assert.deepEqual(versions, []);
    });
  });

  describe('getLatestVersion', () => {
    it('returns latest version', async () => {
      const params = { documentId: 'doc-5', storagePath: 'a.docx', mimeType: 'application/pdf', sizeBytes: 100, originalFilename: 'a.pdf', submittedByUserId: 'u1' };
      await createVersion(params);
      await createVersion({ ...params, storagePath: 'a2.docx' });
      const latest = await getLatestVersion('doc-5');
      assert.equal(latest.versionNumber, 2);
    });

    it('returns null for document with no versions', async () => {
      const result = await getLatestVersion('no-such-doc');
      assert.equal(result, null);
    });
  });

  describe('getVersion', () => {
    it('returns the requested specific version', async () => {
      const params = { documentId: 'doc-6', storagePath: 'b.docx', mimeType: 'application/pdf', sizeBytes: 100, originalFilename: 'b.pdf', submittedByUserId: 'u1' };
      await createVersion(params);
      await createVersion({ ...params, storagePath: 'b2.docx' });
      const v = await getVersion('doc-6', 1);
      assert.equal(v.storagePath, 'b.docx');
    });

    it('returns null for non-existent version', async () => {
      const result = await getVersion('doc-6', 99);
      assert.equal(result, null);
    });
  });

  // ─── diffVersions ────────────────────────────────────────────────────────

  describe('diffVersions', () => {
    it('throws NOT_FOUND for missing version', async () => {
      await assert.rejects(
        () => diffVersions('doc-7', 1, 2),
        err => { assert.equal(err.code, 'NOT_FOUND'); return true; }
      );
    });

    it('throws UNSUPPORTED_TYPE for non-DOCX documents', async () => {
      // Create two PDF version records
      const params = { documentId: 'doc-8', storagePath: 'p.pdf', mimeType: 'application/pdf', sizeBytes: 100, originalFilename: 'p.pdf', submittedByUserId: 'u1' };
      await createVersion(params);
      await createVersion({ ...params, storagePath: 'p2.pdf' });

      await assert.rejects(
        () => diffVersions('doc-8', 1, 2),
        err => { assert.equal(err.code, 'UNSUPPORTED_TYPE'); return true; }
      );
    });
  });
});
