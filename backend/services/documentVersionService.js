'use strict';

/**
 * Document version service — manages immutable version records for each document.
 *
 * Every file upload (initial or resubmission) creates a DocumentVersion row.
 * Versions are numbered sequentially per document (1, 2, 3, …).
 *
 * The admin setting `max_versions_per_document` (0 = unlimited) controls how many
 * old versions are retained. When exceeded, the oldest versions are pruned (records
 * deleted; physical files remain for audit safety).
 */

const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const prisma = require('../src/db/client');

const UPLOAD_DIR = path.join(__dirname, '../uploads');

// ─── Core CRUD ────────────────────────────────────────────────────────────────

/**
 * Creates a version record for a document. Call immediately after the file is
 * persisted to disk.
 *
 * @param {object} params
 * @param {string} params.documentId
 * @param {string} params.storagePath    - filename (relative to uploads/)
 * @param {string} params.mimeType
 * @param {number} params.sizeBytes
 * @param {string} params.originalFilename
 * @param {string} params.submittedByUserId
 * @returns {Promise<object>} the created DocumentVersion record
 */
async function createVersion({ documentId, storagePath, mimeType, sizeBytes, originalFilename, submittedByUserId }) {
  // Determine next version number atomically using a transaction
  return prisma.$transaction(async (tx) => {
    const latest = await tx.documentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;

    const version = await tx.documentVersion.create({
      data: { documentId, versionNumber, storagePath, mimeType, sizeBytes, originalFilename, submittedByUserId },
    });

    // Prune old versions if a limit is configured
    await pruneVersions(documentId, tx);

    return version;
  });
}

/**
 * Returns all versions for a document, ordered newest-first.
 *
 * @param {string} documentId
 * @returns {Promise<object[]>}
 */
async function listVersions(documentId) {
  return prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: { versionNumber: 'desc' },
  });
}

/**
 * Returns the latest version record for a document, or null if none exist.
 *
 * @param {string} documentId
 * @returns {Promise<object|null>}
 */
async function getLatestVersion(documentId) {
  return prisma.documentVersion.findFirst({
    where: { documentId },
    orderBy: { versionNumber: 'desc' },
  });
}

/**
 * Returns a specific version by number, or null.
 *
 * @param {string} documentId
 * @param {number} versionNumber
 * @returns {Promise<object|null>}
 */
async function getVersion(documentId, versionNumber) {
  return prisma.documentVersion.findUnique({
    where: { documentId_versionNumber: { documentId, versionNumber } },
  });
}

// ─── Pruning ──────────────────────────────────────────────────────────────────

/**
 * Deletes oldest version records beyond the configured maximum.
 * Physical files are NOT deleted (audit trail safety).
 * Call inside a transaction when possible; falls back to standalone query.
 *
 * @param {string} documentId
 * @param {object} [tx] - optional Prisma transaction client
 */
async function pruneVersions(documentId, tx) {
  const db = tx || prisma;
  let maxVersions = 0; // 0 = unlimited
  try {
    const cfg = await db.systemConfig.findUnique({ where: { key: 'max_versions_per_document' } });
    if (cfg) maxVersions = parseInt(cfg.value, 10) || 0;
  } catch {
    // If config table not available, skip pruning
    return;
  }

  if (maxVersions <= 0) return;

  const versions = await db.documentVersion.findMany({
    where: { documentId },
    orderBy: { versionNumber: 'desc' },
    select: { id: true, versionNumber: true },
  });

  if (versions.length <= maxVersions) return;

  const toDelete = versions.slice(maxVersions).map(v => v.id);
  await db.documentVersion.deleteMany({ where: { id: { in: toDelete } } });
}

// ─── DOCX diff ────────────────────────────────────────────────────────────────

/**
 * Extracts paragraph-level text from a DOCX file.
 *
 * @param {string} storagePath - filename relative to uploads/
 * @returns {string[]} array of paragraph strings
 */
function extractDocxParagraphs(storagePath) {
  const filePath = path.join(UPLOAD_DIR, storagePath);
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) throw new Error('word/document.xml not found in DOCX');

  const xml = entry.getData().toString('utf8');

  // Extract text runs within each paragraph
  const paragraphs = [];
  const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;

  let pMatch;
  while ((pMatch = pRegex.exec(xml)) !== null) {
    const pXml = pMatch[0];
    let text = '';
    let tMatch;
    while ((tMatch = tRegex.exec(pXml)) !== null) {
      text += tMatch[1];
    }
    paragraphs.push(text);
  }

  return paragraphs;
}

/**
 * Computes a line-level diff between two paragraph arrays using Myers diff.
 * Returns an array of change objects: { type: 'equal'|'added'|'removed', text: string }.
 *
 * @param {string[]} aLines
 * @param {string[]} bLines
 * @returns {{ type: string, text: string }[]}
 */
function computeDiff(aLines, bLines) {
  // Simple O(ND) diff via shortest-edit-path backtracking
  const m = aLines.length;
  const n = bLines.length;
  const max = m + n;
  const v = new Array(2 * max + 1).fill(0);
  const trace = [];

  for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      const ki = k + max;
      let x;
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        x = v[ki + 1];
      } else {
        x = v[ki - 1] + 1;
      }
      let y = x - k;
      while (x < m && y < n && aLines[x] === bLines[y]) { x++; y++; }
      v[ki] = x;
      if (x >= m && y >= n) {
        // Backtrack to build diff
        return backtrack(trace, aLines, bLines, max, d);
      }
    }
  }

  // Fallback: everything changed
  return [
    ...aLines.map(t => ({ type: 'removed', text: t })),
    ...bLines.map(t => ({ type: 'added', text: t })),
  ];
}

function backtrack(trace, aLines, bLines, max, d) {
  const result = [];
  let x = aLines.length;
  let y = bLines.length;

  for (let dd = d; dd > 0; dd--) {
    const v = trace[dd];
    const k = x - y;
    const ki = k + max;
    let prevK;
    if (k === -dd || (k !== dd && v[ki - 1] < v[ki + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[prevK + max];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--; y--;
      result.unshift({ type: 'equal', text: aLines[x] });
    }
    if (dd > 0) {
      if (x === prevX) {
        result.unshift({ type: 'added', text: bLines[y - 1] });
        y--;
      } else {
        result.unshift({ type: 'removed', text: aLines[x - 1] });
        x--;
      }
    }
  }

  // Remaining equals at the start
  while (x > 0 && y > 0) {
    x--; y--;
    result.unshift({ type: 'equal', text: aLines[x] });
  }

  return result;
}

/**
 * Produces a side-by-side paragraph diff between two versions of a DOCX document.
 * Returns structured change hunks.
 *
 * @param {string} documentId
 * @param {number} fromVersionNumber - older version
 * @param {number} toVersionNumber   - newer version
 * @returns {Promise<object>}
 */
async function diffVersions(documentId, fromVersionNumber, toVersionNumber) {
  const [fromVersion, toVersion] = await Promise.all([
    getVersion(documentId, fromVersionNumber),
    getVersion(documentId, toVersionNumber),
  ]);

  if (!fromVersion) throw Object.assign(new Error(`Version ${fromVersionNumber} not found`), { code: 'NOT_FOUND' });
  if (!toVersion) throw Object.assign(new Error(`Version ${toVersionNumber} not found`), { code: 'NOT_FOUND' });

  const isDocx = (v) => v.mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (!isDocx(fromVersion) || !isDocx(toVersion)) {
    throw Object.assign(new Error('Diff is only supported for DOCX documents'), { code: 'UNSUPPORTED_TYPE' });
  }

  const fromFilePath = path.join(UPLOAD_DIR, fromVersion.storagePath);
  const toFilePath = path.join(UPLOAD_DIR, toVersion.storagePath);

  if (!fs.existsSync(fromFilePath)) throw Object.assign(new Error(`File for version ${fromVersionNumber} not found on disk`), { code: 'NOT_FOUND' });
  if (!fs.existsSync(toFilePath)) throw Object.assign(new Error(`File for version ${toVersionNumber} not found on disk`), { code: 'NOT_FOUND' });

  const fromParagraphs = extractDocxParagraphs(fromVersion.storagePath);
  const toParagraphs = extractDocxParagraphs(toVersion.storagePath);

  const changes = computeDiff(fromParagraphs, toParagraphs);

  const added = changes.filter(c => c.type === 'added').length;
  const removed = changes.filter(c => c.type === 'removed').length;

  return {
    documentId,
    fromVersion: fromVersionNumber,
    toVersion: toVersionNumber,
    summary: { added, removed, unchanged: changes.filter(c => c.type === 'equal').length },
    changes,
  };
}

module.exports = {
  createVersion,
  listVersions,
  getLatestVersion,
  getVersion,
  diffVersions,
};
