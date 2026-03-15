'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma = require('../src/db/client');

async function listRoutingRules(req, res) {
  const rules = await prisma.routingRule.findMany({
    orderBy: { priority: 'asc' },
  });
  res.json(rules);
}

async function createRoutingRule(req, res) {
  const { name, documentType, departmentTag, priority, targetQueue, isActive } = req.body;

  if (!name || priority === undefined || priority === null || !targetQueue) {
    return res.status(400).json({ error: 'name, priority, and targetQueue are required' });
  }

  const parsedPriority = parseInt(priority, 10);
  if (isNaN(parsedPriority)) {
    return res.status(400).json({ error: 'priority must be a number' });
  }

  const rule = await prisma.routingRule.create({
    data: {
      id: uuidv4(),
      name,
      documentType: documentType ?? null,
      departmentTag: departmentTag ?? null,
      priority: parsedPriority,
      targetQueue,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
    },
  });

  res.status(201).json(rule);
}

async function updateRoutingRule(req, res) {
  const { id } = req.params;
  const { name, documentType, departmentTag, priority, targetQueue, isActive } = req.body;

  const existing = await prisma.routingRule.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ error: 'Routing rule not found' });
  }

  const data = {};
  if (name !== undefined) data.name = name;
  if (documentType !== undefined) data.documentType = documentType;
  if (departmentTag !== undefined) data.departmentTag = departmentTag;
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
