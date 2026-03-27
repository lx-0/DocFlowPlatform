'use strict';

const prisma = require('../src/db/client');

/**
 * Evaluates a single condition against a metadata value.
 *
 * @param {*} actual  - The actual value from document metadata
 * @param {string} op - Operator: eq, neq, gt, gte, lt, lte, contains
 * @param {*} expected - The expected value from the condition
 * @returns {boolean}
 */
function evalCondition(actual, op, expected) {
  switch (op) {
    case 'eq':       return actual == expected; // loose equality to handle string/number coercion
    case 'neq':      return actual != expected;
    case 'gt':       return Number(actual) > Number(expected);
    case 'gte':      return Number(actual) >= Number(expected);
    case 'lt':       return Number(actual) < Number(expected);
    case 'lte':      return Number(actual) <= Number(expected);
    case 'contains': return String(actual ?? '').toLowerCase().includes(String(expected).toLowerCase());
    default:         return false;
  }
}

/**
 * Resolves a field path against the metadata object.
 * Supports top-level fields (e.g. "documentType") and nested custom fields
 * via "custom.<key>" notation (e.g. "custom.invoiceType").
 *
 * @param {object} metadata
 * @param {string} field
 * @returns {*}
 */
function resolveField(metadata, field) {
  if (field.startsWith('custom.')) {
    const key = field.slice(7);
    return metadata.customFields?.[key] ?? null;
  }
  return metadata[field] ?? null;
}

/**
 * Evaluates a condition group against document metadata.
 *
 * Condition group shape:
 * {
 *   operator: "AND" | "OR",
 *   conditions: [
 *     { field: "documentType", op: "eq", value: "PDF" },
 *     { field: "department",   op: "eq", value: "legal" },
 *     { field: "amount",       op: "gt", value: 10000 },
 *     { field: "custom.tag",   op: "eq", value: "urgent" }
 *   ]
 * }
 *
 * @param {object} conditionGroup
 * @param {object} metadata
 * @returns {boolean}
 */
function evalConditionGroup(conditionGroup, metadata) {
  const { operator = 'AND', conditions = [] } = conditionGroup;
  if (conditions.length === 0) return true; // empty group = unconditional

  if (operator === 'OR') {
    return conditions.some(c => evalCondition(resolveField(metadata, c.field), c.op, c.value));
  }
  // Default: AND
  return conditions.every(c => evalCondition(resolveField(metadata, c.field), c.op, c.value));
}

/**
 * Evaluates active routing rules against a document and assigns it to the correct queue.
 * Rules are evaluated in priority order (ascending); first match wins.
 *
 * Rules with a `conditions` JSON group use AND/OR condition evaluation.
 * Rules without `conditions` fall back to legacy documentType + departmentTag matching.
 *
 * @param {string} documentId
 * @param {{ documentType: string, departmentTag?: string|null, [key: string]: any }} metadata
 * @returns {Promise<{ routingQueueId: string|null, routingStatus: string }>}
 */
async function routeDocument(documentId, metadata) {
  const rules = await prisma.routingRule.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  });

  const docType = metadata.documentType ?? null;
  const deptTag = metadata.departmentTag ?? null;

  let matched = null;
  for (const rule of rules) {
    let ruleMatches;
    if (rule.conditions != null) {
      ruleMatches = evalConditionGroup(rule.conditions, metadata);
    } else {
      // Legacy matching: documentType and/or departmentTag
      const typeMatch = rule.documentType == null || rule.documentType === docType;
      const tagMatch = rule.departmentTag == null || rule.departmentTag === deptTag;
      ruleMatches = typeMatch && tagMatch;
    }

    if (ruleMatches) {
      matched = rule;
      break;
    }
  }

  if (matched) {
    await prisma.document.update({
      where: { id: documentId },
      data: { routingQueueId: matched.targetQueue, routingStatus: 'queued' },
    });
    return { routingQueueId: matched.targetQueue, routingStatus: 'queued' };
  }

  console.warn(`[RoutingEngine] No matching rule for document ${documentId} (type=${docType}, tag=${deptTag})`);
  await prisma.document.update({
    where: { id: documentId },
    data: { routingQueueId: null, routingStatus: 'unrouted' },
  });
  return { routingQueueId: null, routingStatus: 'unrouted' };
}

module.exports = { routeDocument, evalConditionGroup };
