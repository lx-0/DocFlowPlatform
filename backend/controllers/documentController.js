const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const prisma = require('../src/db/client');
const { extractMetadata } = require('../services/metadataExtractor');
const { formatDocument } = require('../services/docxFormatter');
const { validateDocument: runValidation } = require('../services/formatValidator');

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

  // Extract metadata then validate; on failure, mark document accordingly
  const filePath = path.join(UPLOAD_DIR, storagePath);
  let savedMeta = null;
  try {
    const meta = await extractMetadata(filePath, req.file.mimetype);
    savedMeta = await prisma.documentMetadata.create({
      data: {
        id: uuidv4(),
        documentId: doc.id,
        title: meta.title,
        author: meta.author,
        docCreatedAt: meta.createdAt,
        lastModifiedAt: meta.lastModifiedAt,
        pageCount: meta.pageCount,
        documentType: meta.documentType,
        wordCount: meta.wordCount,
      },
    });
  } catch (err) {
    await prisma.document.update({
      where: { id: doc.id },
      data: { status: 'metadata_failed', errorMessage: err.message },
    });
  }

  // Run format validation automatically after upload
  try {
    const result = runValidation(filePath, req.file.mimetype, savedMeta);
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
  } catch (err) {
    // Non-fatal: validation errors don't block the upload response
  }

  const updated = await prisma.document.findUnique({
    where: { id: doc.id },
    select: { id: true, originalFilename: true, mimeType: true, sizeBytes: true, uploadedByUserId: true, status: true, createdAt: true },
  });

  return res.status(201).json({
    id: updated.id,
    originalFilename: updated.originalFilename,
    mimeType: updated.mimeType,
    size: updated.sizeBytes,
    uploadedBy: updated.uploadedByUserId,
    uploadedAt: updated.createdAt,
    status: updated.status,
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
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json({ documents: docs });
}

async function getDocument(req, res) {
  const doc = await prisma.document.findFirst({
    where: { id: req.params.id, uploadedByUserId: req.user.userId },
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!doc) {
    return res.status(404).json({ error: 'Document not found.' });
  }

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

    return res.json({ message: 'Document formatted successfully.', documentId: doc.id, status: 'formatted' });
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

module.exports = { uploadMiddleware, uploadDocument, listDocuments, getDocument, downloadDocument, getDocumentMetadata, formatDoc, downloadFormattedDocument, validateDoc, getValidationReport };
