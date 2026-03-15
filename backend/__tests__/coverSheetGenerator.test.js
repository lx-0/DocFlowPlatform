const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');

const { generateCoverSheet, buildCoverSheetXml, escapeXml } = require('../services/coverSheetGenerator');

// ─── Minimal DOCX builder ────────────────────────────────────────────────────

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

function buildDocumentXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Main content paragraph</w:t></w:r></w:p>
    <w:sectPr><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`;
}

function createMinimalDocx(tmpDir) {
  const filePath = path.join(tmpDir, `test-input-${Date.now()}.docx`);
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES_XML, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(RELS_XML, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(buildDocumentXml(), 'utf8'));
  zip.writeZip(filePath);
  return filePath;
}

// ─── Unit tests for buildCoverSheetXml ───────────────────────────────────────

describe('buildCoverSheetXml', () => {
  test('includes title from metadata', () => {
    const xml = buildCoverSheetXml({ title: 'My Report', author: 'Jane Doe', documentType: 'Report' });
    assert.ok(xml.includes('My Report'), 'Should include document title');
  });

  test('includes author from metadata', () => {
    const xml = buildCoverSheetXml({ title: 'Report', author: 'Jane Doe', documentType: 'Report' });
    assert.ok(xml.includes('Jane Doe'), 'Should include author name');
  });

  test('includes document type from metadata', () => {
    const xml = buildCoverSheetXml({ title: 'Report', author: 'Jane Doe', documentType: 'Proposal' });
    assert.ok(xml.includes('Proposal'), 'Should include document type');
  });

  test('shows [Not Provided] for missing title', () => {
    const xml = buildCoverSheetXml({ author: 'Jane Doe', documentType: 'Report' });
    assert.ok(xml.includes('[Not Provided]'), 'Should show [Not Provided] for missing title');
  });

  test('shows [Not Provided] for missing author', () => {
    const xml = buildCoverSheetXml({ title: 'Report', documentType: 'Report' });
    assert.ok(xml.includes('[Not Provided]'), 'Should show [Not Provided] for missing author');
  });

  test('shows [Not Provided] for department (never extracted)', () => {
    const xml = buildCoverSheetXml({ title: 'Report', author: 'Jane', documentType: 'Report' });
    assert.ok(xml.includes('[Not Provided]'), 'Department should always be [Not Provided]');
  });

  test('handles null metadata gracefully', () => {
    const xml = buildCoverSheetXml(null);
    const notProvidedCount = (xml.match(/\[Not Provided\]/g) || []).length;
    assert.ok(notProvidedCount >= 3, 'Should show [Not Provided] for all missing fields');
  });

  test('includes a page break element', () => {
    const xml = buildCoverSheetXml({ title: 'T', author: 'A', documentType: 'D' });
    assert.ok(xml.includes('<w:br w:type="page"/>'), 'Should include a page break');
  });

  test('escapes XML special characters in title', () => {
    const xml = buildCoverSheetXml({ title: 'A & B <test>', author: 'Jane', documentType: 'D' });
    assert.ok(xml.includes('A &amp; B &lt;test&gt;'), 'Should escape XML special characters');
    assert.ok(!xml.includes('<test>'), 'Should not include raw < > in title');
  });
});

describe('escapeXml', () => {
  test('escapes ampersand', () => assert.equal(escapeXml('a & b'), 'a &amp; b'));
  test('escapes less-than', () => assert.equal(escapeXml('<tag>'), '&lt;tag&gt;'));
  test('escapes quotes', () => assert.equal(escapeXml('"hi"'), '&quot;hi&quot;'));
  test('returns string for non-string input', () => assert.equal(escapeXml(42), '42'));
});

// ─── Integration test for generateCoverSheet ─────────────────────────────────

describe('generateCoverSheet (integration)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-sheet-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('creates output file', async () => {
    const inputPath = createMinimalDocx(tmpDir);
    const outputPath = path.join(tmpDir, 'final.docx');
    const metadata = { title: 'Test Doc', author: 'Alice', documentType: 'Report', docCreatedAt: '2026-01-15T00:00:00Z' };

    await generateCoverSheet(inputPath, outputPath, metadata);

    assert.ok(fs.existsSync(outputPath), 'Output file should be created');
    assert.ok(fs.statSync(outputPath).size > 0, 'Output file should not be empty');
  });

  test('cover sheet is first page (page break before main content)', async () => {
    const inputPath = createMinimalDocx(tmpDir);
    const outputPath = path.join(tmpDir, 'final2.docx');
    const metadata = { title: 'Test Doc', author: 'Alice', documentType: 'Report' };

    await generateCoverSheet(inputPath, outputPath, metadata);

    const zip = new AdmZip(outputPath);
    const docXml = zip.readAsText('word/document.xml');

    // Page break must appear before the main content
    const pageBreakIdx = docXml.indexOf('<w:br w:type="page"/>');
    const mainContentIdx = docXml.indexOf('Main content paragraph');

    assert.ok(pageBreakIdx !== -1, 'Page break should exist');
    assert.ok(mainContentIdx !== -1, 'Original content should be preserved');
    assert.ok(pageBreakIdx < mainContentIdx, 'Page break must appear before main content');
  });

  test('cover sheet contains expected metadata fields', async () => {
    const inputPath = createMinimalDocx(tmpDir);
    const outputPath = path.join(tmpDir, 'final3.docx');
    const metadata = { title: 'Annual Report', author: 'Bob Smith', documentType: 'Annual Report' };

    await generateCoverSheet(inputPath, outputPath, metadata);

    const zip = new AdmZip(outputPath);
    const docXml = zip.readAsText('word/document.xml');

    assert.ok(docXml.includes('Annual Report'), 'Should contain document title');
    assert.ok(docXml.includes('Bob Smith'), 'Should contain author name');
    assert.ok(docXml.includes('[Not Provided]'), 'Department should be [Not Provided]');
  });

  test('original file is not modified', async () => {
    const inputPath = createMinimalDocx(tmpDir);
    const outputPath = path.join(tmpDir, 'final4.docx');
    const originalContent = fs.readFileSync(inputPath);

    await generateCoverSheet(inputPath, outputPath, { title: 'T', author: 'A', documentType: 'D' });

    const afterContent = fs.readFileSync(inputPath);
    assert.deepEqual(originalContent, afterContent, 'Original file must not be modified');
  });

  test('works with null metadata (all [Not Provided])', async () => {
    const inputPath = createMinimalDocx(tmpDir);
    const outputPath = path.join(tmpDir, 'final5.docx');

    await generateCoverSheet(inputPath, outputPath, null);

    assert.ok(fs.existsSync(outputPath), 'Output file should be created even with null metadata');
    const zip = new AdmZip(outputPath);
    const docXml = zip.readAsText('word/document.xml');
    assert.ok(docXml.includes('[Not Provided]'), 'Should show [Not Provided] for all fields');
  });
});
