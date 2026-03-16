'use strict';

/**
 * Public REST API v1 — external integration endpoints.
 * Secured by API key authentication (Authorization: ApiKey <key>).
 * Rate limited to 100 requests/minute per API key.
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { authenticateApiKey } = require('../middleware/apiKeyAuth');
const prisma = require('../src/db/client');
const { runPipeline } = require('../services/pipelineService');
const { logEvent } = require('../services/auditLog');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '../uploads');
const MAX_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// ─── Rate limiter: 100 req/min per API key ────────────────────────────────────
const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  // apiKeyId is always set by authenticateApiKey which runs before this middleware
  keyGenerator: (req) => req.apiKeyId,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Max 100 requests per minute per API key.' },
});

// ─── Multer config ────────────────────────────────────────────────────────────
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

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_SIZE_BYTES } });

function handleUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File exceeds 50MB limit.' });
    }
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Upload failed.' });
  });
}

// Apply authentication and rate limiting to all v1 routes
router.use(authenticateApiKey);
router.use(apiRateLimiter);

// ─── POST /api/v1/documents ───────────────────────────────────────────────────
// Submit a document; returns document id and initial status.
router.post('/documents', handleUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field name "file".' });
  }

  try {
    const doc = await prisma.document.create({
      data: {
        id: uuidv4(),
        originalFilename: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        storagePath: req.file.filename,
        uploadedByUserId: req.user.userId,
        status: 'uploaded',
      },
      select: {
        id: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        createdAt: true,
      },
    });

    try {
      logEvent({
        actorUserId: req.user.userId,
        action: 'document.submitted_via_api',
        targetType: 'document',
        targetId: doc.id,
        metadata: { apiKeyId: req.apiKeyId },
        ipAddress: req.ip || null,
      });
    } catch {}

    // Kick off pipeline asynchronously
    runPipeline(doc.id).catch(() => {});

    return res.status(201).json({
      id: doc.id,
      originalFilename: doc.originalFilename,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      status: doc.status,
      submittedAt: doc.createdAt,
    });
  } catch (err) {
    console.error('[v1] POST /documents error:', err);
    return res.status(500).json({ error: 'Failed to submit document.' });
  }
});

// ─── GET /api/v1/documents/:id ────────────────────────────────────────────────
// Get document status and metadata.
router.get('/documents/:id', async (req, res) => {
  try {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, uploadedByUserId: req.user.userId },
      select: {
        id: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        errorMessage: true,
        routingStatus: true,
        routingQueueId: true,
        createdAt: true,
        updatedAt: true,
        metadata: {
          select: {
            title: true,
            author: true,
            documentType: true,
            pageCount: true,
            wordCount: true,
            extractedAt: true,
          },
        },
        approvalWorkflow: {
          select: {
            id: true,
            queueName: true,
            currentStep: true,
            totalSteps: true,
            status: true,
          },
        },
      },
    });

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    return res.json(doc);
  } catch (err) {
    console.error('[v1] GET /documents/:id error:', err);
    return res.status(500).json({ error: 'Failed to retrieve document.' });
  }
});

// ─── GET /api/v1/documents/:id/download ──────────────────────────────────────
// Download processed document. Returns the most processed version available:
// final > formatted > original.
router.get('/documents/:id/download', async (req, res) => {
  try {
    const doc = await prisma.document.findFirst({
      where: { id: req.params.id, uploadedByUserId: req.user.userId },
    });

    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    // Prefer finalStoragePath > formattedStoragePath > storagePath
    const storagePath = doc.finalStoragePath || doc.formattedStoragePath || doc.storagePath;
    const filePath = path.join(UPLOAD_DIR, storagePath);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on storage.' });
    }

    // Sanitize filename to prevent header injection (strip CR/LF and quotes)
    const safeFilename = doc.originalFilename.replace(/[\r\n"]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', doc.mimeType);
    return res.sendFile(filePath);
  } catch (err) {
    console.error('[v1] GET /documents/:id/download error:', err);
    return res.status(500).json({ error: 'Failed to download document.' });
  }
});

module.exports = router;
