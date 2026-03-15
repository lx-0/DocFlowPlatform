'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');

// ─── Minimal DOCX builder ─────────────────────────────────────────────────────

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const CORE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Pipeline Test Document</dc:title>
  <dc:creator>Test Author</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>
</cp:coreProperties>`;

function buildDocumentXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Pipeline integration test content</w:t></w:r></w:p>
    <w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

function createMinimalDocx(dir) {
  const filePath = path.join(dir, `test-pipeline-${Date.now()}.docx`);
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES_XML, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(RELS_XML, 'utf8'));
  zip.addFile('docProps/core.xml', Buffer.from(CORE_XML, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(buildDocumentXml(), 'utf8'));
  zip.writeZip(filePath);
  return filePath;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Pipeline integration: DOCX end-to-end', () => {
  let tmpDir;
  let docxPath;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-int-test-'));
    docxPath = createMinimalDocx(tmpDir);

    // Point pipeline service at our tmp dir via env var
    process.env.UPLOAD_DIR = tmpDir;

    // ── In-memory prisma mock ──────────────────────────────────────────────
    const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    let metadataState = null;

    const docState = {
      id: 'pipeline-test-doc-id',
      mimeType: DOCX_MIME,
      storagePath: path.basename(docxPath),
      status: 'uploaded',
      errorMessage: null,
      formattedStoragePath: null,
      finalStoragePath: null,
    };

    const mockPrisma = {
      document: {
        findUnique: async ({ where, include }) => {
          const doc = { ...docState };
          if (include && include.metadata) doc.metadata = metadataState;
          return doc;
        },
        update: async ({ where, data }) => {
          Object.assign(docState, data);
          return { ...docState };
        },
      },
      documentMetadata: {
        upsert: async ({ create }) => {
          metadataState = { ...create };
          return metadataState;
        },
      },
      validationReport: {
        upsert: async ({ create }) => create,
      },
      $transaction: async (ops) => Promise.all(ops),
    };

    // Inject mock into require cache before loading pipeline service
    const dbPath = require.resolve('../src/db/client');
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockPrisma };

    // Expose for test assertions
    global.__pipelineDocState = docState;
  });

  after(() => {
    delete process.env.UPLOAD_DIR;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('pipeline reaches cover_sheet_applied and creates final document with cover sheet', async () => {
    // Load pipeline service after mock is injected
    const pipelineServicePath = require.resolve('../services/pipelineService');
    delete require.cache[pipelineServicePath];
    const { runPipeline } = require('../services/pipelineService');

    const docState = global.__pipelineDocState;

    await runPipeline('pipeline-test-doc-id');

    // Final status must be cover_sheet_applied
    assert.equal(docState.status, 'cover_sheet_applied', `Expected cover_sheet_applied, got: ${docState.status} (error: ${docState.errorMessage})`);

    // Final file must exist on disk
    assert.ok(docState.finalStoragePath, 'finalStoragePath should be set');
    const finalPath = path.join(tmpDir, docState.finalStoragePath);
    assert.ok(fs.existsSync(finalPath), 'Final document file should exist on disk');
    assert.ok(fs.statSync(finalPath).size > 0, 'Final document file should not be empty');

    // Cover sheet content must be present
    const zip = new AdmZip(finalPath);
    const docXml = zip.readAsText('word/document.xml');
    assert.ok(docXml.includes('<w:br w:type="page"/>'), 'Final document should include a page break from cover sheet');
    assert.ok(docXml.includes('Pipeline integration test content'), 'Final document should preserve original content');

    // Formatted intermediate file must also exist
    assert.ok(docState.formattedStoragePath, 'formattedStoragePath should be set');
    const formattedPath = path.join(tmpDir, docState.formattedStoragePath);
    assert.ok(fs.existsSync(formattedPath), 'Formatted document file should exist on disk');
  });

  test('errorMessage is null after successful pipeline run', () => {
    const docState = global.__pipelineDocState;
    assert.equal(docState.errorMessage, null);
  });
});

describe('Pipeline integration: metadata failure halts pipeline', () => {
  let tmpDir2;

  before(() => {
    tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-fail-test-'));
    process.env.UPLOAD_DIR = tmpDir2;

    const docState = {
      id: 'fail-test-doc-id',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      storagePath: 'nonexistent.docx', // file does not exist → extractMetadata will throw
      status: 'uploaded',
      errorMessage: null,
    };

    const mockPrisma = {
      document: {
        findUnique: async () => ({ ...docState }),
        update: async ({ data }) => { Object.assign(docState, data); return { ...docState }; },
      },
      documentMetadata: { upsert: async () => ({}) },
      validationReport: { upsert: async () => ({}) },
      $transaction: async (ops) => Promise.all(ops),
    };

    const dbPath = require.resolve('../src/db/client');
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: mockPrisma };
    global.__pipelineFailDocState = docState;
  });

  after(() => {
    delete process.env.UPLOAD_DIR;
    fs.rmSync(tmpDir2, { recursive: true, force: true });
  });

  test('pipeline sets status to metadata_failed when file is missing', async () => {
    const pipelineServicePath = require.resolve('../services/pipelineService');
    delete require.cache[pipelineServicePath];
    const { runPipeline } = require('../services/pipelineService');

    await runPipeline('fail-test-doc-id');

    const docState = global.__pipelineFailDocState;
    assert.equal(docState.status, 'metadata_failed');
    assert.ok(docState.errorMessage, 'errorMessage should describe the failure');
  });
});
