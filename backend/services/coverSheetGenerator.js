const AdmZip = require('adm-zip');

const NOT_PROVIDED = '[Not Provided]';

/**
 * Build OOXML paragraph XML with optional center alignment and bold run.
 */
function buildParagraph(text, { bold = false, sizePt = 11, center = false } = {}) {
  const halfPt = sizePt * 2;
  const jc = center ? '<w:jc w:val="center"/>' : '';
  const boldTag = bold ? '<w:b/><w:bCs/>' : '';
  const rPr = `<w:rPr>${boldTag}<w:sz w:val="${halfPt}"/><w:szCs w:val="${halfPt}"/></w:rPr>`;
  const pPr = `<w:pPr>${jc}</w:pPr>`;
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function buildLabelValueParagraph(label, value) {
  const display = value || NOT_PROVIDED;
  const halfPt = 22; // 11pt
  const rPrBold = `<w:rPr><w:b/><w:bCs/><w:sz w:val="${halfPt}"/><w:szCs w:val="${halfPt}"/></w:rPr>`;
  const rPrNormal = `<w:rPr><w:sz w:val="${halfPt}"/><w:szCs w:val="${halfPt}"/></w:rPr>`;
  const pPr = '<w:pPr><w:jc w:val="center"/></w:pPr>';
  return (
    `<w:p>${pPr}` +
    `<w:r>${rPrBold}<w:t xml:space="preserve">${escapeXml(label + ': ')}</w:t></w:r>` +
    `<w:r>${rPrNormal}<w:t xml:space="preserve">${escapeXml(display)}</w:t></w:r>` +
    `</w:p>`
  );
}

function buildPageBreakParagraph() {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function buildSpacerParagraph() {
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr></w:p>';
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build cover sheet XML paragraphs from metadata.
 * @param {object} metadata - DocumentMetadata fields (may be null/partial)
 * @returns {string} OOXML paragraph XML to prepend to body
 */
function buildCoverSheetXml(metadata) {
  const title = metadata?.title || NOT_PROVIDED;
  const author = metadata?.author || NOT_PROVIDED;
  const documentType = metadata?.documentType || NOT_PROVIDED;
  // submission date: use docCreatedAt if available, otherwise current date
  const submissionDate = metadata?.docCreatedAt
    ? new Date(metadata.docCreatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  // department is not extracted from documents
  const department = NOT_PROVIDED;

  const parts = [
    buildSpacerParagraph(),
    buildSpacerParagraph(),
    buildSpacerParagraph(),
    buildSpacerParagraph(),
    buildParagraph(title, { bold: true, sizePt: 24, center: true }),
    buildSpacerParagraph(),
    buildSpacerParagraph(),
    buildLabelValueParagraph('Author', author),
    buildSpacerParagraph(),
    buildLabelValueParagraph('Submission Date', submissionDate),
    buildSpacerParagraph(),
    buildLabelValueParagraph('Document Type', documentType),
    buildSpacerParagraph(),
    buildLabelValueParagraph('Department', department),
    buildSpacerParagraph(),
    buildSpacerParagraph(),
    buildSpacerParagraph(),
    buildPageBreakParagraph(),
  ];

  return parts.join('');
}

/**
 * Generate a cover-sheet-prefixed DOCX from a formatted DOCX.
 * Reads inputPath, writes final DOCX to outputPath.
 * @param {string} inputPath - path to formatted DOCX
 * @param {string} outputPath - path to write final DOCX
 * @param {object|null} metadata - DocumentMetadata record
 */
async function generateCoverSheet(inputPath, outputPath, metadata) {
  const zip = new AdmZip(inputPath);

  const docEntry = zip.getEntry('word/document.xml');
  if (!docEntry) {
    throw new Error('Invalid DOCX: missing word/document.xml');
  }

  let docXml = docEntry.getData().toString('utf8');
  const coverXml = buildCoverSheetXml(metadata);

  // Prepend cover sheet paragraphs right after <w:body>
  if (docXml.includes('<w:body>')) {
    docXml = docXml.replace('<w:body>', `<w:body>${coverXml}`);
  } else {
    // Handle body tag with attributes
    docXml = docXml.replace(/<w:body[^>]*>/, (match) => `${match}${coverXml}`);
  }

  zip.updateFile('word/document.xml', Buffer.from(docXml, 'utf8'));
  zip.writeZip(outputPath);
}

module.exports = {
  generateCoverSheet,
  buildCoverSheetXml,
  buildParagraph,
  buildLabelValueParagraph,
  buildPageBreakParagraph,
  escapeXml,
};
