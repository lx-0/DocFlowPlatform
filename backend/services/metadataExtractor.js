const fs = require('fs');
const pdfParse = require('pdf-parse');
const AdmZip = require('adm-zip');

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function parsePDFDate(dateStr) {
  if (!dateStr) return null;
  // PDF dates: "D:YYYYMMDDHHmmss..." format
  const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (match) {
    const d = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

async function extractPDFMetadata(filePath) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const info = data.info || {};

  return {
    title: info.Title || null,
    author: info.Author || null,
    createdAt: parsePDFDate(info.CreationDate),
    lastModifiedAt: parsePDFDate(info.ModDate),
    pageCount: data.numpages || null,
    documentType: 'PDF',
    wordCount: null,
  };
}

function extractXMLValue(xml, tag) {
  const match = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`, 'i'));
  return match ? match[1].trim() || null : null;
}

function extractDOCXMetadata(filePath) {
  const zip = new AdmZip(filePath);

  let title = null;
  let author = null;
  let createdAt = null;
  let lastModifiedAt = null;
  let wordCount = null;

  const coreEntry = zip.getEntry('docProps/core.xml');
  if (coreEntry) {
    const coreXml = zip.readAsText('docProps/core.xml');
    if (coreXml) {
      title = extractXMLValue(coreXml, 'dc:title');
      author = extractXMLValue(coreXml, 'dc:creator');
      const created = extractXMLValue(coreXml, 'dcterms:created');
      const modified = extractXMLValue(coreXml, 'dcterms:modified');
      if (created) {
        const d = new Date(created);
        createdAt = isNaN(d.getTime()) ? null : d;
      }
      if (modified) {
        const d = new Date(modified);
        lastModifiedAt = isNaN(d.getTime()) ? null : d;
      }
    }
  }

  const appEntry = zip.getEntry('docProps/app.xml');
  if (appEntry) {
    const appXml = zip.readAsText('docProps/app.xml');
    if (appXml) {
      const wordMatch = appXml.match(/<Words>(\d+)<\/Words>/i);
      wordCount = wordMatch ? parseInt(wordMatch[1], 10) : null;
    }
  }

  return {
    title,
    author,
    createdAt,
    lastModifiedAt,
    pageCount: null,
    documentType: 'DOCX',
    wordCount,
  };
}

async function extractMetadata(filePath, mimeType) {
  if (mimeType === PDF_MIME) {
    return extractPDFMetadata(filePath);
  } else if (mimeType === DOCX_MIME) {
    return extractDOCXMetadata(filePath);
  }
  throw new Error(`Unsupported MIME type: ${mimeType}`);
}

module.exports = { extractMetadata };
