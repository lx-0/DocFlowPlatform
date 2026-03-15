const AdmZip = require('adm-zip');
const RULES = require('../config/formatting-rules.json');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

const PAGE_COUNT_MIN = 1;
const PAGE_COUNT_MAX = 500;

// Parse a numeric w: attribute value from an XML snippet
function getWAttr(xml, attrName) {
  const match = xml.match(new RegExp(`w:${attrName}="(\\d+)"`));
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Check page margins in word/document.xml against RULES.margins (twips).
 */
function checkMargins(docXml) {
  const violations = [];
  const pgMarMatch = docXml.match(/<w:pgMar([^/]*)\/>/);

  if (!pgMarMatch) {
    violations.push({
      rule: 'margins',
      message: 'No page margin settings (w:pgMar) found in document.',
      severity: 'error',
      location: 'word/document.xml sectPr',
    });
    return violations;
  }

  const attrs = pgMarMatch[1];
  for (const side of ['top', 'right', 'bottom', 'left']) {
    const actual = getWAttr(attrs, side);
    const expected = RULES.margins[side];
    if (actual === null) {
      violations.push({
        rule: `margins.${side}`,
        message: `Missing ${side} margin attribute; expected ${expected} twips.`,
        severity: 'warning',
        location: 'word/document.xml sectPr w:pgMar',
      });
    } else if (actual !== expected) {
      violations.push({
        rule: `margins.${side}`,
        message: `${side.charAt(0).toUpperCase() + side.slice(1)} margin is ${actual} twips but expected ${expected} twips.`,
        severity: 'error',
        location: 'word/document.xml sectPr w:pgMar',
      });
    }
  }
  return violations;
}

/**
 * Check default body font family and size from word/styles.xml docDefaults.
 */
function checkDefaultFont(stylesXml) {
  const violations = [];
  const rPrDefaultMatch = stylesXml.match(/<w:rPrDefault>([\s\S]*?)<\/w:rPrDefault>/);

  if (!rPrDefaultMatch) {
    violations.push({
      rule: 'font.default',
      message: 'No default run properties (w:rPrDefault) found in styles.',
      severity: 'warning',
      location: 'word/styles.xml docDefaults',
    });
    return violations;
  }

  const rPr = rPrDefaultMatch[1];
  const expectedFamily = RULES.defaultFont.family;
  const expectedHalfPt = RULES.defaultFont.sizePt * 2;

  // Font family
  const fontMatch = rPr.match(/w:ascii="([^"]+)"/);
  if (!fontMatch) {
    violations.push({
      rule: 'font.family',
      message: `Default font family not set; expected "${expectedFamily}".`,
      severity: 'error',
      location: 'word/styles.xml docDefaults rPrDefault',
    });
  } else if (fontMatch[1] !== expectedFamily) {
    violations.push({
      rule: 'font.family',
      message: `Default font family is "${fontMatch[1]}" but expected "${expectedFamily}".`,
      severity: 'error',
      location: 'word/styles.xml docDefaults rPrDefault',
    });
  }

  // Font size
  const szMatch = rPr.match(/<w:sz w:val="(\d+)"/);
  if (!szMatch) {
    violations.push({
      rule: 'font.size',
      message: `Default font size not set; expected ${RULES.defaultFont.sizePt}pt.`,
      severity: 'error',
      location: 'word/styles.xml docDefaults rPrDefault',
    });
  } else if (parseInt(szMatch[1], 10) !== expectedHalfPt) {
    violations.push({
      rule: 'font.size',
      message: `Default font size is ${parseInt(szMatch[1], 10) / 2}pt but expected ${RULES.defaultFont.sizePt}pt.`,
      severity: 'error',
      location: 'word/styles.xml docDefaults rPrDefault',
    });
  }

  return violations;
}

/**
 * Check a named heading style's font family, size, and bold in word/styles.xml.
 */
function checkHeadingStyle(stylesXml, styleId, config) {
  const violations = [];
  const styleRegex = new RegExp(
    `<w:style[^>]*w:styleId="${styleId}"[^>]*>([\\s\\S]*?)<\\/w:style>`,
  );
  const match = stylesXml.match(styleRegex);

  if (!match) {
    // Style not present in this document — skip rather than flag
    return violations;
  }

  const body = match[1];
  const rPrMatch = body.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);

  if (!rPrMatch) {
    violations.push({
      rule: `heading.${styleId}.font`,
      message: `${styleId} has no run properties; font/size cannot be verified.`,
      severity: 'warning',
      location: `word/styles.xml ${styleId}`,
    });
    return violations;
  }

  const rPr = rPrMatch[1];
  const expectedHalfPt = config.sizePt * 2;

  // Font family
  const fontMatch = rPr.match(/w:ascii="([^"]+)"/);
  if (!fontMatch || fontMatch[1] !== config.family) {
    const actual = fontMatch ? `"${fontMatch[1]}"` : 'not set';
    violations.push({
      rule: `heading.${styleId}.family`,
      message: `${styleId} font family is ${actual} but expected "${config.family}".`,
      severity: 'error',
      location: `word/styles.xml ${styleId} w:rPr`,
    });
  }

  // Font size
  const szMatch = rPr.match(/<w:sz w:val="(\d+)"/);
  if (!szMatch || parseInt(szMatch[1], 10) !== expectedHalfPt) {
    const actual = szMatch ? `${parseInt(szMatch[1], 10) / 2}pt` : 'not set';
    violations.push({
      rule: `heading.${styleId}.size`,
      message: `${styleId} font size is ${actual} but expected ${config.sizePt}pt.`,
      severity: 'error',
      location: `word/styles.xml ${styleId} w:rPr`,
    });
  }

  // Bold
  if (config.bold && !rPr.includes('<w:b/>') && !/<w:b[ >]/.test(rPr)) {
    violations.push({
      rule: `heading.${styleId}.bold`,
      message: `${styleId} should be bold but bold is not set.`,
      severity: 'error',
      location: `word/styles.xml ${styleId} w:rPr`,
    });
  }

  return violations;
}

/**
 * Check page count is within the allowed range.
 * pageCountFromMeta is the value from DocumentMetadata (may be null for DOCX).
 * Falls back to docProps/app.xml <Pages> for DOCX.
 */
function checkPageCount(zip, pageCountFromMeta) {
  const violations = [];
  let pageCount = pageCountFromMeta != null ? pageCountFromMeta : null;

  if (pageCount === null && zip) {
    const appEntry = zip.getEntry('docProps/app.xml');
    if (appEntry) {
      const appXml = appEntry.getData().toString('utf8');
      const pagesMatch = appXml.match(/<Pages>(\d+)<\/Pages>/i);
      if (pagesMatch) pageCount = parseInt(pagesMatch[1], 10);
    }
  }

  if (pageCount !== null) {
    if (pageCount < PAGE_COUNT_MIN || pageCount > PAGE_COUNT_MAX) {
      violations.push({
        rule: 'pageCount',
        message: `Page count is ${pageCount} but must be between ${PAGE_COUNT_MIN} and ${PAGE_COUNT_MAX}.`,
        severity: 'error',
        location: 'document',
      });
    }
  }

  return violations;
}

/**
 * Check that the document appears to have a cover sheet.
 * Looks for "cover" (case-insensitive) in the text of the first paragraph.
 */
function checkCoverSheet(docXml) {
  const violations = [];
  const firstParaMatch = docXml.match(/<w:p[ >]([\s\S]*?)<\/w:p>/);
  if (!firstParaMatch) return violations;

  const allText = [...firstParaMatch[1].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((m) => m[1])
    .join('')
    .toLowerCase();

  if (!allText.includes('cover')) {
    violations.push({
      rule: 'coverSheet',
      message:
        'Document does not appear to have a cover sheet. First paragraph should include cover sheet content.',
      severity: 'warning',
      location: 'word/document.xml first paragraph',
    });
  }

  return violations;
}

// ─── Per-type validators ──────────────────────────────────────────────────────

function validateDocx(filePath, metadata) {
  const violations = [];
  const zip = new AdmZip(filePath);

  const docEntry = zip.getEntry('word/document.xml');
  if (docEntry) {
    const docXml = docEntry.getData().toString('utf8');
    violations.push(...checkMargins(docXml));
    violations.push(...checkCoverSheet(docXml));
  }

  const stylesEntry = zip.getEntry('word/styles.xml');
  if (stylesEntry) {
    const stylesXml = stylesEntry.getData().toString('utf8');
    violations.push(...checkDefaultFont(stylesXml));
    violations.push(...checkHeadingStyle(stylesXml, 'Heading1', RULES.headings.h1));
    violations.push(...checkHeadingStyle(stylesXml, 'Heading2', RULES.headings.h2));
    violations.push(...checkHeadingStyle(stylesXml, 'Heading3', RULES.headings.h3));
  }

  const pageCount = metadata ? metadata.pageCount : null;
  violations.push(...checkPageCount(zip, pageCount));

  return { valid: violations.every((v) => v.severity !== 'error'), violations };
}

function validatePdf(filePath, metadata) {
  const violations = [];
  const pageCount = metadata ? metadata.pageCount : null;
  violations.push(...checkPageCount(null, pageCount));
  return { valid: violations.every((v) => v.severity !== 'error'), violations };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Validate a document file against company formatting rules.
 * @param {string} filePath - Absolute path to the file.
 * @param {string} mimeType - MIME type of the document.
 * @param {object|null} metadata - DocumentMetadata record (may be null).
 * @returns {{ valid: boolean, violations: Array }}
 */
function validateDocument(filePath, mimeType, metadata) {
  if (mimeType === DOCX_MIME) return validateDocx(filePath, metadata);
  if (mimeType === PDF_MIME) return validatePdf(filePath, metadata);
  throw new Error(`Unsupported MIME type for validation: ${mimeType}`);
}

module.exports = {
  validateDocument,
  // Exported for unit testing
  checkMargins,
  checkDefaultFont,
  checkHeadingStyle,
  checkPageCount,
  checkCoverSheet,
};
