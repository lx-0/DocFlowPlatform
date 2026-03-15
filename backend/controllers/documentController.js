const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const prisma = require('../src/db/client');

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

module.exports = { uploadMiddleware, uploadDocument, listDocuments, getDocument, downloadDocument };
