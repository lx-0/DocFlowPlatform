'use strict';

const { describe, it, before, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ------------------------------------------------------------------
// Inline helpers that mirror the extractor's parsePDFDate / extractXMLValue
// so we can test parsing logic without requiring the real modules.
// ------------------------------------------------------------------
function parsePDFDate(dateStr) {
  if (!dateStr) return null;
  const match = dateStr.match(/D:(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (match) {
    const d = new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function extractXMLValue(xml, tag) {
  const match = xml.match(new RegExp(`<[^>]*${tag}[^>]*>([^<]*)<`, 'i'));
  return match ? match[1].trim() || null : null;
}

// ------------------------------------------------------------------
// Tests
// ------------------------------------------------------------------
describe('parsePDFDate', () => {
  it('parses D: format PDF dates', () => {
    const d = parsePDFDate('D:20230101120000Z');
    assert.deepEqual(d, new Date('2023-01-01T12:00:00Z'));
  });

  it('parses ISO format dates', () => {
    const d = parsePDFDate('2024-05-10T09:00:00Z');
    assert.deepEqual(d, new Date('2024-05-10T09:00:00Z'));
  });

  it('returns null for null input', () => {
    assert.equal(parsePDFDate(null), null);
  });

  it('returns null for invalid date strings', () => {
    assert.equal(parsePDFDate('not-a-date'), null);
  });
});

describe('extractXMLValue', () => {
  it('extracts a simple tag value', () => {
    const xml = '<dc:title>My Document</dc:title>';
    assert.equal(extractXMLValue(xml, 'dc:title'), 'My Document');
  });

  it('extracts value from a tag with attributes', () => {
    const xml = '<dcterms:created xsi:type="dcterms:W3CDTF">2023-03-15T10:00:00Z</dcterms:created>';
    assert.equal(extractXMLValue(xml, 'dcterms:created'), '2023-03-15T10:00:00Z');
  });

  it('returns null when tag not found', () => {
    assert.equal(extractXMLValue('<foo>bar</foo>', 'dc:title'), null);
  });

  it('returns null for empty tag content', () => {
    assert.equal(extractXMLValue('<dc:title></dc:title>', 'dc:title'), null);
  });
});

describe('metadataExtractor integration (mocked deps)', () => {
  // We test the service by monkey-patching require cache entries
  let extractMetadata;
  let fsMock;
  let pdfParseMock;
  let admZipMock;

  before(() => {
    // Set up mocks in the module cache before requiring the service
    fsMock = { readFileSync: () => Buffer.from('fake') };
    pdfParseMock = null; // set per-test
    admZipMock = null;   // set per-test

    // Inject mocks into require.cache
    require.cache[require.resolve('fs')] = { id: 'fs', filename: 'fs', loaded: true, exports: fsMock };
    require.cache[require.resolve('pdf-parse')] = {
      id: 'pdf-parse', filename: 'pdf-parse', loaded: true,
      exports: async (...args) => pdfParseMock(...args),
    };
    require.cache[require.resolve('adm-zip')] = {
      id: 'adm-zip', filename: 'adm-zip', loaded: true,
      exports: function AdmZipStub(...args) { return admZipMock(...args); },
    };

    // Delete cached service module so it re-requires with our mocks
    const svcPath = require.resolve('../services/metadataExtractor');
    delete require.cache[svcPath];
    ({ extractMetadata } = require('../services/metadataExtractor'));
  });

  describe('PDF extraction', () => {
    it('extracts title, author, dates, and page count', async () => {
      pdfParseMock = async () => ({
        numpages: 5,
        info: {
          Title: 'Annual Report',
          Author: 'Jane Doe',
          CreationDate: 'D:20230101120000Z',
          ModDate: 'D:20230601153000Z',
        },
      });

      const result = await extractMetadata('/path/report.pdf', PDF_MIME);

      assert.equal(result.title, 'Annual Report');
      assert.equal(result.author, 'Jane Doe');
      assert.deepEqual(result.createdAt, new Date('2023-01-01T12:00:00Z'));
      assert.deepEqual(result.lastModifiedAt, new Date('2023-06-01T15:30:00Z'));
      assert.equal(result.pageCount, 5);
      assert.equal(result.documentType, 'PDF');
      assert.equal(result.wordCount, null);
    });

    it('returns nulls for missing PDF metadata', async () => {
      pdfParseMock = async () => ({ numpages: 1, info: {} });

      const result = await extractMetadata('/path/empty.pdf', PDF_MIME);

      assert.equal(result.title, null);
      assert.equal(result.author, null);
      assert.equal(result.createdAt, null);
      assert.equal(result.lastModifiedAt, null);
      assert.equal(result.pageCount, 1);
      assert.equal(result.documentType, 'PDF');
    });
  });

  describe('DOCX extraction', () => {
    const coreXml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<cp:coreProperties>',
      '  <dc:title>Quarterly Summary</dc:title>',
      '  <dc:creator>Bob Smith</dc:creator>',
      '  <dcterms:created xsi:type="dcterms:W3CDTF">2024-02-14T08:00:00Z</dcterms:created>',
      '  <dcterms:modified xsi:type="dcterms:W3CDTF">2024-03-01T17:00:00Z</dcterms:modified>',
      '</cp:coreProperties>',
    ].join('\n');

    const appXml = '<Properties><Words>3200</Words></Properties>';

    it('extracts title, author, dates, and word count', async () => {
      admZipMock = () => ({
        getEntry: (name) => (['docProps/core.xml', 'docProps/app.xml'].includes(name) ? {} : null),
        readAsText: (name) => {
          if (name === 'docProps/core.xml') return coreXml;
          if (name === 'docProps/app.xml') return appXml;
          return null;
        },
      });

      const result = await extractMetadata('/path/doc.docx', DOCX_MIME);

      assert.equal(result.title, 'Quarterly Summary');
      assert.equal(result.author, 'Bob Smith');
      assert.deepEqual(result.createdAt, new Date('2024-02-14T08:00:00Z'));
      assert.deepEqual(result.lastModifiedAt, new Date('2024-03-01T17:00:00Z'));
      assert.equal(result.pageCount, null);
      assert.equal(result.documentType, 'DOCX');
      assert.equal(result.wordCount, 3200);
    });

    it('returns null fields when DOCX has no metadata files', async () => {
      admZipMock = () => ({
        getEntry: () => null,
        readAsText: () => null,
      });

      const result = await extractMetadata('/path/bare.docx', DOCX_MIME);

      assert.equal(result.title, null);
      assert.equal(result.author, null);
      assert.equal(result.createdAt, null);
      assert.equal(result.lastModifiedAt, null);
      assert.equal(result.wordCount, null);
      assert.equal(result.documentType, 'DOCX');
    });

    it('handles DOCX with core.xml but no app.xml', async () => {
      admZipMock = () => ({
        getEntry: (name) => (name === 'docProps/core.xml' ? {} : null),
        readAsText: (name) => {
          if (name === 'docProps/core.xml')
            return '<cp:coreProperties><dc:title>Draft</dc:title></cp:coreProperties>';
          return null;
        },
      });

      const result = await extractMetadata('/path/draft.docx', DOCX_MIME);

      assert.equal(result.title, 'Draft');
      assert.equal(result.wordCount, null);
    });
  });

  it('throws for unsupported MIME types', async () => {
    await assert.rejects(
      () => extractMetadata('/path/file.txt', 'text/plain'),
      /Unsupported MIME type: text\/plain/
    );
  });
});
