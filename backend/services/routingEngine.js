'use strict';

const prisma = require('../src/db/client');

/**
 * Evaluates active routing rules against a document and assigns it to the correct queue.
 * Rules are evaluated in priority order (ascending); first match wins.
 * A rule with both documentType AND departmentTag requires both to match.
 *
 * @param {string} documentId
 * @param {{ documentType: string, departmentTag?: string|null }} metadata
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
    const typeMatch = rule.documentType == null || rule.documentType === docType;
    const tagMatch = rule.departmentTag == null || rule.departmentTag === deptTag;
    if (typeMatch && tagMatch) {
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

module.exports = { routeDocument };
