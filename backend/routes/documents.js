const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const {
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
} = require('../controllers/documentController');

// Wrap multer errors into proper HTTP responses
function handleUpload(req, res, next) {
  uploadMiddleware(req, res, (err) => {
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

router.post('/upload', authenticate, requirePermission('documents:write'), handleUpload, uploadDocument);
router.get('/', authenticate, requirePermission('documents:read'), listDocuments);
router.get('/:id', authenticate, getDocument);
router.get('/:id/status', authenticate, getDocumentStatus);
router.get('/:id/metadata', authenticate, getDocumentMetadata);
router.get('/:id/download', authenticate, downloadDocument);
router.post('/:id/format', authenticate, formatDoc);
router.get('/:id/formatted/download', authenticate, downloadFormattedDocument);
router.post('/:id/validate', authenticate, validateDoc);
router.get('/:id/validation-report', authenticate, getValidationReport);
router.post('/:id/cover-sheet', authenticate, applyCoverSheet);
router.get('/:id/final/download', authenticate, downloadFinalDocument);
router.post('/:id/reprocess', authenticate, reprocessDocument);

module.exports = router;
