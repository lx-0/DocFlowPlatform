const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const AdmZip = require('adm-zip');

const {
  checkMargins,
  checkDefaultFont,
  checkHeadingStyle,
  checkPageCount,
  checkCoverSheet,
  validateDocument,
} = require('../services/formatValidator');
const RULES = require('../config/formatting-rules.json');

// ─── XML fixtures ─────────────────────────────────────────────────────────────

function makePgMarXml(top, right, bottom, left) {
  return `<w:sectPr><w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
}

function makeStylesXml({ family = 'Times New Roman', sizePt = 12, headingFamily = 'Arial', headingSizePt = 20 } = {}) {
  const halfPt = sizePt * 2;
  const hHalfPt = headingSizePt * 2;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}"/>
        <w:sz w:val="${halfPt}"/>
        <w:szCs w:val="${halfPt}"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:rPr>
      <w:rFonts w:ascii="${headingFamily}" w:hAnsi="${headingFamily}"/>
      <w:b/>
      <w:sz w:val="${hHalfPt}"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:rPr>
      <w:rFonts w:ascii="${headingFamily}" w:hAnsi="${headingFamily}"/>
      <w:b/>
      <w:sz w:val="${hHalfPt}"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:rPr>
      <w:rFonts w:ascii="${headingFamily}" w:hAnsi="${headingFamily}"/>
      <w:b/>
      <w:sz w:val="${hHalfPt}"/>
    </w:rPr>
  </w:style>
</w:styles>`;
}

// ─── Helpers for building minimal DOCX files ──────────────────────────────────

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

function buildDocXml({ firstParaText = 'Cover Sheet', margins = RULES.margins } = {}) {
  const { top, right, bottom, left } = margins;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>${firstParaText}</w:t></w:r></w:p>
    <w:sectPr><w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
  </w:body>
</w:document>`;
}

function buildConformingStylesXml() {
  const halfPt = RULES.defaultFont.sizePt * 2;
  const h1HalfPt = RULES.headings.h1.sizePt * 2;
  const h2HalfPt = RULES.headings.h2.sizePt * 2;
  const h3HalfPt = RULES.headings.h3.sizePt * 2;
  const family = RULES.defaultFont.family;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="${family}" w:hAnsi="${family}" w:cs="${family}"/>
        <w:sz w:val="${halfPt}"/>
        <w:szCs w:val="${halfPt}"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/><w:b/><w:sz w:val="${h1HalfPt}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/><w:b/><w:sz w:val="${h2HalfPt}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:rPr><w:rFonts w:ascii="${family}" w:hAnsi="${family}"/><w:b/><w:sz w:val="${h3HalfPt}"/></w:rPr>
  </w:style>
</w:styles>`;
}

function createDocx(tmpDir, { docXml, stylesXml } = {}) {
  const filePath = path.join(tmpDir, `test-${Date.now()}-${Math.random()}.docx`);
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(CONTENT_TYPES_XML, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(RELS_XML, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(docXml || buildDocXml(), 'utf8'));
  zip.addFile('word/styles.xml', Buffer.from(stylesXml || buildConformingStylesXml(), 'utf8'));
  zip.writeZip(filePath);
  return filePath;
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

// ─── checkMargins ─────────────────────────────────────────────────────────────

describe('checkMargins', () => {
  test('returns no violations when margins match rules', () => {
    const { top, right, bottom, left } = RULES.margins;
    const xml = makePgMarXml(top, right, bottom, left);
    const violations = checkMargins(xml);
    assert.equal(violations.length, 0);
  });

  test('flags incorrect top margin as error', () => {
    const { right, bottom, left } = RULES.margins;
    const xml = makePgMarXml(500, right, bottom, left);
    const violations = checkMargins(xml);
    const v = violations.find((v) => v.rule === 'margins.top');
    assert.ok(v, 'Should have a top margin violation');
    assert.equal(v.severity, 'error');
    assert.ok(v.message.includes('500'));
  });

  test('flags missing pgMar as error', () => {
    const xml = `<w:body><w:sectPr></w:sectPr></w:body>`;
    const violations = checkMargins(xml);
    assert.ok(violations.length > 0);
    assert.equal(violations[0].rule, 'margins');
    assert.equal(violations[0].severity, 'error');
  });

  test('flags all four wrong margins', () => {
    const xml = makePgMarXml(100, 200, 300, 400);
    const violations = checkMargins(xml);
    const rules = ['margins.top', 'margins.right', 'margins.bottom', 'margins.left'];
    for (const rule of rules) {
      assert.ok(violations.some((v) => v.rule === rule), `Expected violation for ${rule}`);
    }
  });
});

// ─── checkDefaultFont ─────────────────────────────────────────────────────────

describe('checkDefaultFont', () => {
  test('returns no violations when font family and size match rules', () => {
    const stylesXml = makeStylesXml({
      family: RULES.defaultFont.family,
      sizePt: RULES.defaultFont.sizePt,
    });
    const violations = checkDefaultFont(stylesXml);
    assert.equal(violations.filter((v) => v.rule.startsWith('font.')).length, 0);
  });

  test('flags wrong font family', () => {
    const stylesXml = makeStylesXml({ family: 'Arial', sizePt: RULES.defaultFont.sizePt });
    const violations = checkDefaultFont(stylesXml);
    const v = violations.find((v) => v.rule === 'font.family');
    assert.ok(v, 'Should have font.family violation');
    assert.equal(v.severity, 'error');
    assert.ok(v.message.includes('Arial'));
    assert.ok(v.message.includes(RULES.defaultFont.family));
  });

  test('flags wrong font size', () => {
    const stylesXml = makeStylesXml({ family: RULES.defaultFont.family, sizePt: 10 });
    const violations = checkDefaultFont(stylesXml);
    const v = violations.find((v) => v.rule === 'font.size');
    assert.ok(v, 'Should have font.size violation');
    assert.equal(v.severity, 'error');
    assert.ok(v.message.includes('10pt'));
    assert.ok(v.message.includes(`${RULES.defaultFont.sizePt}pt`));
  });

  test('flags missing rPrDefault with warning', () => {
    const stylesXml = `<w:styles><w:docDefaults></w:docDefaults></w:styles>`;
    const violations = checkDefaultFont(stylesXml);
    assert.ok(violations.length > 0);
    assert.equal(violations[0].severity, 'warning');
  });
});

// ─── checkHeadingStyle ────────────────────────────────────────────────────────

describe('checkHeadingStyle', () => {
  test('returns no violations when heading matches rules', () => {
    const stylesXml = makeStylesXml({
      headingFamily: RULES.headings.h1.family,
      headingSizePt: RULES.headings.h1.sizePt,
    });
    const violations = checkHeadingStyle(stylesXml, 'Heading1', RULES.headings.h1);
    assert.equal(violations.length, 0);
  });

  test('flags wrong heading font family', () => {
    const stylesXml = makeStylesXml({ headingFamily: 'Comic Sans MS', headingSizePt: RULES.headings.h1.sizePt });
    const violations = checkHeadingStyle(stylesXml, 'Heading1', RULES.headings.h1);
    const v = violations.find((v) => v.rule === 'heading.Heading1.family');
    assert.ok(v, 'Should have heading family violation');
    assert.equal(v.severity, 'error');
  });

  test('flags wrong heading font size', () => {
    const stylesXml = makeStylesXml({ headingFamily: RULES.headings.h1.family, headingSizePt: 10 });
    const violations = checkHeadingStyle(stylesXml, 'Heading1', RULES.headings.h1);
    const v = violations.find((v) => v.rule === 'heading.Heading1.size');
    assert.ok(v, 'Should have heading size violation');
    assert.equal(v.severity, 'error');
  });

  test('flags missing bold when required', () => {
    // Build styles without bold for Heading1
    const stylesXml = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:style w:type="paragraph" w:styleId="Heading1">
        <w:rPr>
          <w:rFonts w:ascii="${RULES.headings.h1.family}" w:hAnsi="${RULES.headings.h1.family}"/>
          <w:sz w:val="${RULES.headings.h1.sizePt * 2}"/>
        </w:rPr>
      </w:style>
    </w:styles>`;
    const violations = checkHeadingStyle(stylesXml, 'Heading1', RULES.headings.h1);
    const v = violations.find((v) => v.rule === 'heading.Heading1.bold');
    assert.ok(v, 'Should flag missing bold');
    assert.equal(v.severity, 'error');
  });

  test('skips gracefully when style does not exist in document', () => {
    const violations = checkHeadingStyle('<w:styles></w:styles>', 'Heading1', RULES.headings.h1);
    assert.equal(violations.length, 0);
  });
});

// ─── checkPageCount ───────────────────────────────────────────────────────────

describe('checkPageCount', () => {
  test('returns no violations for valid page count', () => {
    const violations = checkPageCount(null, 10);
    assert.equal(violations.length, 0);
  });

  test('flags page count above maximum', () => {
    const violations = checkPageCount(null, 9999);
    assert.ok(violations.length > 0);
    assert.equal(violations[0].rule, 'pageCount');
    assert.equal(violations[0].severity, 'error');
  });

  test('flags page count of zero', () => {
    const violations = checkPageCount(null, 0);
    assert.ok(violations.length > 0);
    assert.equal(violations[0].rule, 'pageCount');
  });

  test('returns no violations when page count is null (unknown)', () => {
    const violations = checkPageCount(null, null);
    assert.equal(violations.length, 0);
  });
});

// ─── checkCoverSheet ──────────────────────────────────────────────────────────

describe('checkCoverSheet', () => {
  test('returns no violations when first paragraph contains "cover"', () => {
    const xml = `<w:body><w:p><w:r><w:t>Cover Sheet</w:t></w:r></w:p></w:body>`;
    const violations = checkCoverSheet(xml);
    assert.equal(violations.length, 0);
  });

  test('returns warning when first paragraph lacks "cover"', () => {
    const xml = `<w:body><w:p><w:r><w:t>Introduction</w:t></w:r></w:p></w:body>`;
    const violations = checkCoverSheet(xml);
    assert.ok(violations.length > 0);
    assert.equal(violations[0].rule, 'coverSheet');
    assert.equal(violations[0].severity, 'warning');
  });

  test('is case-insensitive for "cover" detection', () => {
    const xml = `<w:body><w:p><w:r><w:t>COVER PAGE</w:t></w:r></w:p></w:body>`;
    const violations = checkCoverSheet(xml);
    assert.equal(violations.length, 0);
  });
});

// ─── validateDocument integration ────────────────────────────────────────────

describe('validateDocument (DOCX integration)', () => {
  let tmpDir;

  test.before
    ? test.before(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-test-')); })
    : null;

  // Use describe-level setup via a shared variable initialised inline
  const _tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-test-'));

  test('conforming DOCX returns valid=true with no errors', () => {
    const filePath = createDocx(_tmpDir, {
      docXml: buildDocXml({ firstParaText: 'Cover Sheet', margins: RULES.margins }),
      stylesXml: buildConformingStylesXml(),
    });
    const result = validateDocument(filePath, DOCX_MIME, null);
    const errors = result.violations.filter((v) => v.severity === 'error');
    assert.equal(errors.length, 0, `Unexpected errors: ${JSON.stringify(errors)}`);
    assert.equal(result.valid, true);
  });

  test('DOCX with wrong margins returns valid=false', () => {
    const filePath = createDocx(_tmpDir, {
      docXml: buildDocXml({ firstParaText: 'Cover Sheet', margins: { top: 100, right: 100, bottom: 100, left: 100 } }),
      stylesXml: buildConformingStylesXml(),
    });
    const result = validateDocument(filePath, DOCX_MIME, null);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.rule.startsWith('margins.')));
  });

  test('DOCX with wrong font returns valid=false', () => {
    const stylesXml = makeStylesXml({ family: 'Comic Sans MS', sizePt: RULES.defaultFont.sizePt });
    const filePath = createDocx(_tmpDir, {
      docXml: buildDocXml(),
      stylesXml,
    });
    const result = validateDocument(filePath, DOCX_MIME, null);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.rule === 'font.family'));
  });

  test('DOCX with wrong heading style returns valid=false', () => {
    const stylesXml = makeStylesXml({
      headingFamily: 'Comic Sans MS',
      headingSizePt: 8,
    });
    const filePath = createDocx(_tmpDir, {
      docXml: buildDocXml(),
      stylesXml,
    });
    const result = validateDocument(filePath, DOCX_MIME, null);
    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.rule.startsWith('heading.')));
  });

  test('violations array has correct shape', () => {
    const filePath = createDocx(_tmpDir, {
      docXml: buildDocXml({ firstParaText: 'Cover', margins: { top: 100, right: 100, bottom: 100, left: 100 } }),
      stylesXml: buildConformingStylesXml(),
    });
    const result = validateDocument(filePath, DOCX_MIME, null);
    for (const v of result.violations) {
      assert.ok(typeof v.rule === 'string');
      assert.ok(typeof v.message === 'string');
      assert.ok(v.severity === 'error' || v.severity === 'warning');
    }
  });

  test('throws for unsupported MIME type', () => {
    assert.throws(
      () => validateDocument('/any/path', 'text/plain', null),
      /Unsupported MIME type/,
    );
  });

  // Cleanup
  process.on('exit', () => {
    try { fs.rmSync(_tmpDir, { recursive: true, force: true }); } catch (_) {}
  });
});
