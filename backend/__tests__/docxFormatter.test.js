const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');

const { formatDocument, applyMargins, applyDocumentDefaults, applyHeadingStyle, applyNormalStyle } = require('../services/docxFormatter');
const RULES = require('../config/formatting-rules.json');

// ─── Minimal DOCX builder ────────────────────────────────────────────────────

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const WORD_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

function buildDocumentXml(pgMar) {
  const pgMarTag = pgMar
    ? `<w:pgMar w:top="${pgMar.top}" w:right="${pgMar.right}" w:bottom="${pgMar.bottom}" w:left="${pgMar.left}" w:header="720" w:footer="720" w:gutter="0"/>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello World</w:t></w:r></w:p>
    <w:sectPr>${pgMarTag}</w:sectPr>
  </w:body>
</w:document>`;
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>
        <w:sz w:val="24"/>
        <w:szCs w:val="24"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:before="0" w:after="160" w:line="200" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="40"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="36"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:pPr><w:spacing w:before="160" w:after="80"/></w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
    </w:rPr>
  </w:style>
</w:styles>`;
}

function createMinimalDocx(tmpDir, options = {}) {
  const filePath = path.join(tmpDir, `test-${Date.now()}.docx`);
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES_XML, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(RELS_XML, 'utf8'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(WORD_RELS_XML, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(buildDocumentXml(options.pgMar), 'utf8'));
  zip.addFile('word/styles.xml', Buffer.from(buildStylesXml(), 'utf8'));
  zip.writeZip(filePath);
  return filePath;
}

// ─── Unit tests for XML helpers ──────────────────────────────────────────────

describe('applyMargins', () => {
  test('replaces existing pgMar attributes with configured values', () => {
    const input = `<w:sectPr><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
    const result = applyMargins(input, RULES.margins);
    assert.ok(result.includes(`w:top="${RULES.margins.top}"`));
    assert.ok(result.includes(`w:left="${RULES.margins.left}"`));
  });

  test('inserts pgMar when none exists', () => {
    const input = `<w:body><w:sectPr></w:sectPr></w:body>`;
    const result = applyMargins(input, RULES.margins);
    assert.ok(result.includes('<w:pgMar'));
    assert.ok(result.includes(`w:top="${RULES.margins.top}"`));
  });
});

describe('applyDocumentDefaults', () => {
  test('replaces default font with configured family and size', () => {
    const stylesXml = buildStylesXml();
    const result = applyDocumentDefaults(stylesXml, RULES);
    assert.ok(result.includes(`w:ascii="${RULES.defaultFont.family}"`));
    assert.ok(result.includes(`w:val="${RULES.defaultFont.sizePt * 2}"`));
    // Old Times New Roman should be gone
    assert.ok(!result.includes('Times New Roman'));
  });
});

describe('applyHeadingStyle', () => {
  test('updates Heading1 font size and bold', () => {
    const stylesXml = buildStylesXml();
    const result = applyHeadingStyle(stylesXml, 'Heading1', RULES.headings.h1, 12, 6);
    const h1HalfPt = RULES.headings.h1.sizePt * 2;
    assert.ok(result.includes(`w:val="${h1HalfPt}"`));
    assert.ok(result.includes('<w:b/>'));
  });

  test('skips gracefully when style does not exist', () => {
    const stylesXml = buildStylesXml();
    const result = applyHeadingStyle(stylesXml, 'Heading9', RULES.headings.h1, 12, 6);
    assert.equal(result, stylesXml);
  });
});

describe('applyNormalStyle', () => {
  test('sets paragraph and line spacing on Normal style', () => {
    const stylesXml = buildStylesXml();
    const result = applyNormalStyle(stylesXml, RULES);
    const expectedAfter = Math.round(RULES.paragraphSpacing.afterPt * 20);
    const expectedLine = Math.round(RULES.lineSpacing.multiple * 240);
    assert.ok(result.includes(`w:after="${expectedAfter}"`));
    assert.ok(result.includes(`w:line="${expectedLine}"`));
  });
});

// ─── Integration test ────────────────────────────────────────────────────────

describe('formatDocument (integration)', () => {
  let tmpDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-format-test-'));
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('produces a valid DOCX with company formatting applied', async () => {
    const inputPath = createMinimalDocx(tmpDir, {
      pgMar: { top: 500, right: 500, bottom: 500, left: 500 },
    });
    const outputPath = path.join(tmpDir, 'output.docx');

    await formatDocument(inputPath, outputPath);

    assert.ok(fs.existsSync(outputPath), 'Output file should be created');
    assert.ok(fs.statSync(outputPath).size > 0, 'Output file should not be empty');

    // Verify the output DOCX is valid and contains our changes
    const zip = new AdmZip(outputPath);

    // Check margins in document.xml
    const docXml = zip.readAsText('word/document.xml');
    assert.ok(docXml.includes(`w:top="${RULES.margins.top}"`), 'Top margin should be updated');
    assert.ok(docXml.includes(`w:left="${RULES.margins.left}"`), 'Left margin should be updated');

    // Check font in styles.xml
    const stylesXml = zip.readAsText('word/styles.xml');
    assert.ok(stylesXml.includes(`w:ascii="${RULES.defaultFont.family}"`), 'Default font family should be updated');

    // Check heading sizes
    const h1HalfPt = RULES.headings.h1.sizePt * 2;
    assert.ok(stylesXml.includes(`w:val="${h1HalfPt}"`), 'H1 font size should be updated');

    // Check paragraph spacing on Normal
    const expectedAfter = Math.round(RULES.paragraphSpacing.afterPt * 20);
    assert.ok(stylesXml.includes(`w:after="${expectedAfter}"`), 'Paragraph spacing (after) should be updated');

    // Check line spacing on Normal
    const expectedLine = Math.round(RULES.lineSpacing.multiple * 240);
    assert.ok(stylesXml.includes(`w:line="${expectedLine}"`), 'Line spacing should be updated');

    // Original content preserved
    assert.ok(docXml.includes('<w:t>Hello World</w:t>'), 'Original document content must be preserved');
  });

  test('does not modify the original file', async () => {
    const inputPath = createMinimalDocx(tmpDir);
    const outputPath = path.join(tmpDir, 'output2.docx');
    const originalContent = fs.readFileSync(inputPath);

    await formatDocument(inputPath, outputPath);

    const afterContent = fs.readFileSync(inputPath);
    assert.deepEqual(originalContent, afterContent, 'Original file must not be modified');
  });
});
