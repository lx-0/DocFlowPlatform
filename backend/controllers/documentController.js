const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const prisma = require('../src/db/client');
const { extractMetadata } = require('../services/metadataExtractor');

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

  // Extract metadata synchronously; on failure, mark document as metadata_failed
  const filePath = path.join(UPLOAD_DIR, storagePath);
  try {
    const meta = await extractMetadata(filePath, req.file.mimetype);
    await prisma.documentMetadata.create({
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

module.exports = { uploadMiddleware, uploadDocument, listDocuments, getDocument, downloadDocument, getDocumentMetadata };
