'use strict';

const { v4: uuidv4 } = require('uuid');
const prisma = require('../src/db/client');

/**
 * Fire-and-forget audit log write.
 * Never throws — errors are logged to stderr but never surfaced to callers.
 *
 * @param {object} params
 * @param {string|null}  params.actorUserId  - user performing the action (null for system events)
 * @param {string}       params.action       - e.g. 'user.login', 'document.approved'
 * @param {string}       params.targetType   - e.g. 'user', 'document'
 * @param {string}       params.targetId     - id of the target entity
 * @param {object|null}  params.metadata     - optional extra JSON context
 * @param {string|null}  params.ipAddress    - originating IP address
 */
function logEvent({ actorUserId = null, action, targetType, targetId, metadata = null, ipAddress = null }) {
  prisma.auditLog
    .create({
      data: {
        id: uuidv4(),
        actorUserId: actorUserId ?? null,
        action,
        targetType,
        targetId,
        metadata: metadata ?? undefined,
        ipAddress: ipAddress ?? null,
      },
    })
    .catch((err) => {
      console.error('[AuditLog] write error:', err);
    });
}

module.exports = { logEvent };
