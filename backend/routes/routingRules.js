'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
  listRoutingRules,
  createRoutingRule,
  updateRoutingRule,
  deleteRoutingRule,
} = require('../controllers/routingRulesController');

router.get('/', authenticate, requireAdmin, listRoutingRules);
router.post('/', authenticate, requireAdmin, createRoutingRule);
router.patch('/:id', authenticate, requireAdmin, updateRoutingRule);
router.delete('/:id', authenticate, requireAdmin, deleteRoutingRule);

module.exports = router;
