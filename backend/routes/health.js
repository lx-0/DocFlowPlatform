const express = require('express');
const router = express.Router();
const healthController = require('../controllers/healthController');

router.get('/health/live', healthController.getLive);
router.get('/health', healthController.getHealth);

module.exports = router;
