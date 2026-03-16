'use strict';

const path = require('path');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../src/db/client');
const { extractMetadata } = require('./metadataExtractor');
const { validateDocument: runValidation } = require('./formatValidator');
const { formatDocument } = require('./docxFormatter');
const { generateCoverSheet } = require('./coverSheetGenerator');
const { routeDocument } = require('./routingEngine');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../uploads');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function metaFields(meta) {
  return {
    title: meta.title,
    author: meta.author,
    docCreatedAt: meta.createdAt,
    lastModifiedAt: meta.lastModifiedAt,
    pageCount: meta.pageCount,
    documentType: meta.documentType,
    wordCount: meta.wordCount,
  };
}

async function runPipeline(documentId) {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) return;

  const filePath = path.join(UPLOAD_DIR, doc.storagePath);

  // Stage 1: Metadata extraction
  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'extracting_metadata', errorMessage: null },
  });

  let metadata = null;
  try {
    const meta = await extractMetadata(filePath, doc.mimeType);
    metadata = await prisma.documentMetadata.upsert({
      where: { documentId },
      create: { id: uuidv4(), documentId, ...metaFields(meta) },
      update: metaFields(meta),
    });
  } catch (err) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'metadata_failed', errorMessage: err.message },
    });
    return;
  }

  // Stage 2: Format validation
  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'validating' },
  });

  try {
    const result = runValidation(filePath, doc.mimeType, metadata);
    const newStatus = result.valid ? 'validated' : 'validation_failed';
    await prisma.$transaction([
      prisma.validationReport.upsert({
        where: { documentId },
        create: { id: uuidv4(), documentId, valid: result.valid, violations: result.violations },
        update: { valid: result.valid, violations: result.violations, validatedAt: new Date() },
      }),
      prisma.document.update({
        where: { id: documentId },
        data: { status: newStatus },
      }),
    ]);
    if (!result.valid) return;
  } catch (err) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'validation_failed', errorMessage: err.message },
    });
    return;
  }

  // Stage 3: Route document to approval queue
  try {
    const latestMetadata = await prisma.documentMetadata.findUnique({ where: { documentId } });
    await routeDocument(documentId, latestMetadata);
  } catch (err) {
    console.error(`[Pipeline] Routing failed for document ${documentId}: ${err.message}`);
    // Non-fatal: pipeline continues even if routing fails
  }

  // Stages 4 & 5 apply to DOCX only
  if (doc.mimeType !== DOCX_MIME) return;

  // Stage 3: Format document
  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'formatting' },
  });

  let formattedPath;
  try {
    const formattedFilename = `formatted-${uuidv4()}.docx`;
    formattedPath = path.join(UPLOAD_DIR, formattedFilename);
    await formatDocument(filePath, formattedPath);
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'formatted', formattedStoragePath: formattedFilename },
    });
  } catch (err) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'formatting_failed', errorMessage: err.message },
    });
    return;
  }

  // Stage 4: Apply cover sheet
  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'applying_cover_sheet' },
  });

  try {
    const finalFilename = `final-${uuidv4()}.docx`;
    const finalPath = path.join(UPLOAD_DIR, finalFilename);
    const updatedDoc = await prisma.document.findUnique({
      where: { id: documentId },
      include: { metadata: true },
    });
    await generateCoverSheet(formattedPath, finalPath, updatedDoc.metadata);
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'cover_sheet_applied', finalStoragePath: finalFilename },
    });
  } catch (err) {
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'cover_sheet_failed', errorMessage: err.message },
    });
  }
}

module.exports = { runPipeline };
