'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma = require('../src/db/client');

const VALID_FIELDS = new Set(['documentType', 'department', 'departmentTag', 'amount', 'pageCount', 'wordCount', 'author', 'title']);
const VALID_OPS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains']);

/**
 * Validates a conditions object.
 * Shape: { operator: "AND"|"OR", conditions: [{ field, op, value }] }
 * Returns an error string if invalid, null if valid.
 */
function validateConditions(conditions) {
  if (conditions == null) return null;
  if (typeof conditions !== 'object' || Array.isArray(conditions)) {
    return 'conditions must be an object';
  }
  const { operator = 'AND', conditions: list } = conditions;
  if (operator !== 'AND' && operator !== 'OR') {
    return 'conditions.operator must be "AND" or "OR"';
  }
  if (!Array.isArray(list)) {
    return 'conditions.conditions must be an array';
  }
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c.field || typeof c.field !== 'string') {
      return `conditions.conditions[${i}].field is required and must be a string`;
    }
    // Allow known fields and custom.* fields
    if (!VALID_FIELDS.has(c.field) && !c.field.startsWith('custom.')) {
      return `conditions.conditions[${i}].field "${c.field}" is not a supported field`;
    }
    if (!VALID_OPS.has(c.op)) {
      return `conditions.conditions[${i}].op "${c.op}" is not a supported operator`;
    }
    if (c.value === undefined || c.value === null) {
      return `conditions.conditions[${i}].value is required`;
    }
  }
  return null;
}

async function listRoutingRules(req, res) {
  const rules = await prisma.routingRule.findMany({
    orderBy: { priority: 'asc' },
  });
  res.json(rules);
}

async function createRoutingRule(req, res) {
  const { name, documentType, departmentTag, conditions, priority, targetQueue, isActive } = req.body;

  if (!name || priority === undefined || priority === null || !targetQueue) {
    return res.status(400).json({ error: 'name, priority, and targetQueue are required' });
  }

  const parsedPriority = parseInt(priority, 10);
  if (isNaN(parsedPriority)) {
    return res.status(400).json({ error: 'priority must be a number' });
  }

  const condErr = validateConditions(conditions);
  if (condErr) {
    return res.status(400).json({ error: condErr });
  }

  const rule = await prisma.routingRule.create({
    data: {
      id: uuidv4(),
      name,
      documentType: documentType ?? null,
      departmentTag: departmentTag ?? null,
      conditions: conditions ?? null,
      priority: parsedPriority,
      targetQueue,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    },
  });

  res.status(201).json(rule);
}

async function updateRoutingRule(req, res) {
  const { id } = req.params;
  const { name, documentType, departmentTag, conditions, priority, targetQueue, isActive } = req.body;

  const existing = await prisma.routingRule.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Routing rule not found' });
  }

  const condErr = validateConditions(conditions);
  if (condErr) {
    return res.status(400).json({ error: condErr });
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (documentType !== undefined) data.documentType = documentType;
  if (departmentTag !== undefined) data.departmentTag = departmentTag;
  if (conditions !== undefined) data.conditions = conditions;
  if (priority !== undefined) {
    const parsedPriority = parseInt(priority, 10);
    if (isNaN(parsedPriority)) {
      return res.status(400).json({ error: 'priority must be a number' });
    }
    data.priority = parsedPriority;
  }
  if (targetQueue !== undefined) data.targetQueue = targetQueue;
  if (isActive !== undefined) data.isActive = Boolean(isActive);

  const rule = await prisma.routingRule.update({ where: { id }, data });
  res.json(rule);
}

async function deleteRoutingRule(req, res) {
  const { id } = req.params;

  const existing = await prisma.routingRule.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Routing rule not found' });
  }

  // Soft delete via isActive = false
  const rule = await prisma.routingRule.update({
    where: { id },
    data: { isActive: false },
  });
  res.json(rule);
}

module.exports = { listRoutingRules, createRoutingRule, updateRoutingRule, deleteRoutingRule };
