const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const prisma = require('../src/db/client');
const { formatDocument } = require('../services/docxFormatter');
const { validateDocument: runValidation } = require('../services/formatValidator');
const { generateCoverSheet } = require('../services/coverSheetGenerator');
const { runPipeline } = require('../services/pipelineService');
const { logEvent } = require('../services/auditLog');
const {
  createVersion,
  listVersions: listVersionRecords,
  getVersion,
  diffVersions,
} = require('../services/documentVersionService');

const UPLOAD_DIR = path.join(__dirname, '../uploads');
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const ALLOWED_MIME_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];

// Multer storage: keep original extension, use UUID filename
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error('Invalid file type. Only PDF and DOCX are allowed.'), { status: 400 }), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE_BYTES },
});

// Middleware export for route use
const uploadMiddleware = upload.single('file');

async function uploadDocument(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const storagePath = req.file.filename;

  const doc = await prisma.document.create({
    data: {
      id: uuidv4(),
      originalFilename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      storagePath,
      uploadedByUserId: req.user.userId,
      status: 'uploaded',
    },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      uploadedByUserId: true,
      status: true,
      createdAt: true,
    },
  });

  // Create version 1 record — fire-and-forget, non-fatal
  createVersion({
    documentId: doc.id,
    storagePath,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    originalFilename: req.file.originalname,
    submittedByUserId: req.user.userId,
  }).catch(err => console.error('[Documents] Failed to create version record:', err.message));

  // Kick off pipeline asynchronously — client polls GET /status
  runPipeline(doc.id).catch(() => {});

  return res.status(201).json({
    id: doc.id,
    originalFilename: doc.originalFilename,
    mimeType: doc.mimeType,
    size: doc.sizeBytes,
    uploadedBy: doc.uploadedByUserId,
    uploadedAt: doc.createdAt,
    status: doc.status,
  });
}

async function getDocumentMetadata(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
    select: {
      id: true,
      status: true,
      errorMessage: true,
      metadata: {
        select: {
          title: true,
          author: true,
          docCreatedAt: true,
          lastModifiedAt: true,
          pageCount: true,
          documentType: true,
          wordCount: true,
          extractedAt: true,
        },
      },
    },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  if (!doc.metadata) {
    return res.status(404).json({ error: 'Metadata not available.', status: doc.status, errorMessage: doc.errorMessage });
  }

  return res.json({
    documentId: doc.id,
    title: doc.metadata.title,
    author: doc.metadata.author,
    createdAt: doc.metadata.docCreatedAt,
    lastModifiedAt: doc.metadata.lastModifiedAt,
    pageCount: doc.metadata.pageCount,
    documentType: doc.metadata.documentType,
    wordCount: doc.metadata.wordCount,
    extractedAt: doc.metadata.extractedAt,
  });
}

async function listDocuments(req, res) {
  const docs = await prisma.document.findMany({
    where: { uploadedByUserId: req.user.userId },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      routingStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ documents: docs });
}

async function getDocument(req, res) {
  const isAdmin = req.user.role === 'admin';
  const where = isAdmin
    ? { id: req.params.id }
    : { id: req.params.id, uploadedByUserId: req.user.userId };

  const doc = await prisma.document.findFirst({
    where,
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      routingQueueId: true,
      routingStatus: true,
      createdAt: true,
      updatedAt: true,
      approvalWorkflow: {
        select: {
          id: true,
          queueName: true,
          currentStep: true,
          totalSteps: true,
          status: true,
          createdAt: true,
          steps: {
            select: {
              id: true,
              stepNumber: true,
              assignedToUserId: true,
              action: true,
              comment: true,
              actedAt: true,
            },
            orderBy: { stepNumber: 'asc' },
          },
        },
      },
    },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  try {
    logEvent({ actorUserId: req.user.userId || null, action: 'document.viewed', targetType: 'document', targetId: doc.id, ipAddress: req.ip || null });
  } catch {}

  return res.json(doc);
}

async function downloadDocument(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  const filePath = path.join(UPLOAD_DIR, doc.storagePath);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on storage.' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${doc.originalFilename}"`);
  res.setHeader('Content-Type', doc.mimeType);
  return res.sendFile(filePath);
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function formatDoc(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  if (doc.mimeType !== DOCX_MIME) {
    return res.status(422).json({ error: 'Only DOCX documents can be formatted.' });
  }

  const inputPath = path.join(UPLOAD_DIR, doc.storagePath);
  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'File not found on storage.' });
  }

  // Mark as formatting
  await prisma.document.update({
    where: { id: doc.id },
    data: { status: 'formatting' },
  });

  try {
    const formattedFilename = `formatted-${uuidv4()}.docx`;
    const outputPath = path.join(UPLOAD_DIR, formattedFilename);

    await formatDocument(inputPath, outputPath);

    await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'formatted', formattedStoragePath: formattedFilename },
    });

    // Auto-apply cover sheet after formatting
    let finalStatus = 'formatted';
    try {
      const finalFilename = `final-${uuidv4()}.docx`;
      const finalPath = path.join(UPLOAD_DIR, finalFilename);
      const updatedDoc = await prisma.document.findUnique({ where: { id: doc.id }, include: { metadata: true } });
      await generateCoverSheet(outputPath, finalPath, updatedDoc.metadata);
      await prisma.document.update({
        where: { id: doc.id },
        data: { status: 'cover_sheet_applied', finalStoragePath: finalFilename },
      });
      finalStatus = 'cover_sheet_applied';
    } catch (coverErr) {
      // Non-fatal: document remains in formatted status
    }

    return res.json({ message: 'Document formatted successfully.', documentId: doc.id, status: finalStatus });
  } catch (err) {
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'formatting_failed', errorMessage: err.message },
    });
    return res.status(500).json({ error: 'Formatting failed.', details: err.message });
  }
}

async function downloadFormattedDocument(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  if (!doc.formattedStoragePath) {
    return res.status(404).json({ error: 'Formatted document not available. Run POST /format first.' });
  }

  const filePath = path.join(UPLOAD_DIR, doc.formattedStoragePath);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Formatted file not found on storage.' });
  }

  const formattedFilename = `formatted-${doc.originalFilename.replace(/\.docx$/i, '')}.docx`;
  res.setHeader('Content-Disposition', `attachment; filename="${formattedFilename}"`);
  res.setHeader('Content-Type', DOCX_MIME);
  return res.sendFile(filePath);
}

async function validateDoc(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
    include: { metadata: true },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  const filePath = path.join(UPLOAD_DIR, doc.storagePath);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on storage.' });
  }

  let result;
  try {
    result = runValidation(filePath, doc.mimeType, doc.metadata);
  } catch (err) {
    return res.status(422).json({ error: err.message });
  }

  const newStatus = result.valid ? 'validated' : 'validation_failed';
  await prisma.$transaction([
    prisma.validationReport.upsert({
      where: { documentId: doc.id },
      create: { id: uuidv4(), documentId: doc.id, valid: result.valid, violations: result.violations },
      update: { valid: result.valid, violations: result.violations, validatedAt: new Date() },
    }),
    prisma.document.update({
      where: { id: doc.id },
      data: { status: newStatus },
    }),
  ]);

  return res.json({ valid: result.valid, violations: result.violations });
}

async function getValidationReport(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  const report = await prisma.validationReport.findUnique({
    where: { documentId: doc.id },
  });

  if (!report) {
    return res.status(404).json({ error: 'No validation report available. Run POST /validate first.' });
  }

  return res.json({
    documentId: doc.id,
    valid: report.valid,
    violations: report.violations,
    validatedAt: report.validatedAt,
  });
}

async function applyCoverSheet(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
    include: { metadata: true },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  if (doc.status !== 'formatted') {
    return res.status(422).json({ error: 'Document must be in formatted status. Run POST /format first.' });
  }

  if (!doc.formattedStoragePath) {
    return res.status(422).json({ error: 'Formatted document not available. Run POST /format first.' });
  }

  const inputPath = path.join(UPLOAD_DIR, doc.formattedStoragePath);
  if (!fs.existsSync(inputPath)) {
    return res.status(404).json({ error: 'Formatted file not found on storage.' });
  }

  try {
    const finalFilename = `final-${uuidv4()}.docx`;
    const outputPath = path.join(UPLOAD_DIR, finalFilename);

    await generateCoverSheet(inputPath, outputPath, doc.metadata);

    await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'cover_sheet_applied', finalStoragePath: finalFilename },
    });

    return res.json({ message: 'Cover sheet applied successfully.', documentId: doc.id, status: 'cover_sheet_applied' });
  } catch (err) {
    return res.status(500).json({ error: 'Cover sheet generation failed.', details: err.message });
  }
}

async function downloadFinalDocument(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  if (!doc.finalStoragePath) {
    return res.status(404).json({ error: 'Final document not available. Run POST /cover-sheet first.' });
  }

  const filePath = path.join(UPLOAD_DIR, doc.finalStoragePath);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Final file not found on storage.' });
  }

  const finalFilename = `final-${doc.originalFilename.replace(/\.docx$/i, '')}.docx`;
  res.setHeader('Content-Disposition', `attachment; filename="${finalFilename}"`);
  res.setHeader('Content-Type', DOCX_MIME);
  return res.sendFile(filePath);
}

const STATUS_INFO = {
  uploaded:             { stage: 'upload',             progress: 5   },
  extracting_metadata:  { stage: 'metadata_extraction', progress: 20  },
  metadata_failed:      { stage: 'metadata_extraction', progress: 20  },
  validating:           { stage: 'format_validation',   progress: 40  },
  validation_failed:    { stage: 'format_validation',   progress: 40  },
  validated:            { stage: 'format_validation',   progress: 50  },
  formatting:           { stage: 'formatting',          progress: 65  },
  formatting_failed:    { stage: 'formatting',          progress: 65  },
  formatted:            { stage: 'formatting',          progress: 75  },
  applying_cover_sheet: { stage: 'cover_sheet',         progress: 90  },
  cover_sheet_failed:   { stage: 'cover_sheet',         progress: 90  },
  cover_sheet_applied:  { stage: 'cover_sheet',         progress: 100 },
};

async function getDocumentStatus(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
    select: { id: true, status: true, errorMessage: true },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  const info = STATUS_INFO[doc.status] || { stage: 'unknown', progress: 0 };
  return res.json({
    status: doc.status,
    stage: info.stage,
    progress: info.progress,
    errors: doc.errorMessage ? [doc.errorMessage] : [],
  });
}

async function reprocessDocument(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

  await prisma.document.update({
    where: { id: doc.id },
    data: { status: 'uploaded', errorMessage: null, formattedStoragePath: null, finalStoragePath: null },
  });

  runPipeline(doc.id).catch(() => {});

  return res.json({ message: 'Reprocessing started.', documentId: doc.id, status: 'uploaded' });
}

// ─── Version history ──────────────────────────────────────────────────────────

/**
 * GET /api/documents/:id/versions — list all versions for a document.
 * Submitters see only their own documents; admins and approvers see any.
 */
async function listDocumentVersions(req, res) {
  const isAdmin = req.user.role === 'admin' || req.user.role === 'approver';
  const where = isAdmin ? { id: req.params.id } : { id: req.params.id, uploadedByUserId: req.user.userId };

  const doc = await prisma.document.findFirst({ where, select: { id: true } });
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  const versions = await listVersionRecords(doc.id);
  return res.json({ documentId: doc.id, versions });
}

/**
 * GET /api/documents/:id/versions/:versionNumber/download — download a specific version.
 */
async function downloadDocumentVersion(req, res) {
  const versionNumber = parseInt(req.params.versionNumber, 10);
  if (isNaN(versionNumber)) return res.status(400).json({ error: 'Invalid version number.' });

  const isAdmin = req.user.role === 'admin' || req.user.role === 'approver';
  const where = isAdmin ? { id: req.params.id } : { id: req.params.id, uploadedByUserId: req.user.userId };

  const doc = await prisma.document.findFirst({ where, select: { id: true } });
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  const version = await getVersion(doc.id, versionNumber);
  if (!version) return res.status(404).json({ error: `Version ${versionNumber} not found.` });

  const filePath = path.join(UPLOAD_DIR, version.storagePath);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on storage.' });

  res.setHeader('Content-Disposition', `attachment; filename="v${versionNumber}-${version.originalFilename}"`);
  res.setHeader('Content-Type', version.mimeType);
  return res.sendFile(filePath);
}

/**
 * POST /api/documents/:id/versions — upload a new version (resubmit).
 * Only the original submitter may add versions.
 * Body: multipart/form-data with 'file' field.
 */
async function resubmitDocument(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
    select: { id: true, originalFilename: true },
  });
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  try {
    const version = await createVersion({
      documentId: doc.id,
      storagePath: req.file.filename,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      originalFilename: req.file.originalname,
      submittedByUserId: req.user.userId,
    });

    try {
      logEvent({
        actorUserId: req.user.userId || null,
        action: 'document.version_added',
        targetType: 'document',
        targetId: doc.id,
        metadata: { versionNumber: version.versionNumber, storagePath: req.file.filename },
        ipAddress: req.ip || null,
      });
    } catch {}

    return res.status(201).json(version);
  } catch (err) {
    console.error('[Documents] resubmitDocument error:', err);
    return res.status(500).json({ error: 'Failed to create new version.' });
  }
}

/**
 * GET /api/documents/:id/versions/diff?from=<n>&to=<m> — diff two DOCX versions.
 * Approvers and admins only.
 */
async function diffDocumentVersions(req, res) {
  const from = parseInt(req.query.from, 10);
  const to = parseInt(req.query.to, 10);

  if (isNaN(from) || isNaN(to)) {
    return res.status(400).json({ error: 'Query params "from" and "to" (version numbers) are required.' });
  }
  if (from === to) {
    return res.status(400).json({ error: '"from" and "to" must be different version numbers.' });
  }

  const isAuthorised = req.user.role === 'admin' || req.user.role === 'approver';
  const where = isAuthorised ? { id: req.params.id } : { id: req.params.id, uploadedByUserId: req.user.userId };

  const doc = await prisma.document.findFirst({ where, select: { id: true } });
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  try {
    const diff = await diffVersions(doc.id, from, to);
    return res.json(diff);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: err.message });
    if (err.code === 'UNSUPPORTED_TYPE') return res.status(422).json({ error: err.message });
    console.error('[Documents] diffDocumentVersions error:', err);
    return res.status(500).json({ error: 'Failed to compute diff.' });
  }
}

module.exports = {
  uploadMiddleware,
  uploadDocument,
  listDocuments,
  getDocument,
  downloadDocument,
  getDocumentMetadata,
  formatDoc,
  downloadFormattedDocument,
  validateDoc,
  getValidationReport,
  applyCoverSheet,
  downloadFinalDocument,
  getDocumentStatus,
  reprocessDocument,
  listDocumentVersions,
  downloadDocumentVersion,
  resubmitDocument,
  diffDocumentVersions,
};
