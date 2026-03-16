'use strict';

/**
 * Delegation service — manages temporary approval authority transfers.
 *
 * Business rules:
 *  - Only users with role 'approver' or 'admin' may be delegates.
 *  - startDate must be before endDate.
 *  - A delegator may not create a circular chain (A→B when B→A already active).
 *  - A user cannot delegate to themselves.
 *  - Only one active delegation per delegator is enforced at creation time
 *    (overlapping date ranges for the same delegator are rejected).
 */

const prisma = require('../src/db/client');

/**
 * Returns the currently active delegation for a given delegator, if any.
 *
 * @param {string} delegatorId
 * @param {Date}   [now]
 * @returns {Promise<object|null>}
 */
async function getActiveDelegationForApprover(delegatorId, now = new Date()) {
  return prisma.approvalDelegation.findFirst({
    where: {
      delegatorId,
      revokedAt: null,
      startDate: { lte: now },
      endDate: { gte: now },
    },
    include: {
      delegate: { select: { id: true, email: true, role: true } },
      delegator: { select: { id: true, email: true } },
    },
  });
}

/**
 * Checks whether a delegation chain from `fromId` reaches `targetId` (cycle detection).
 *
 * @param {string} fromId    - the proposed delegate's id
 * @param {string} targetId  - the delegator's id we must not reach
 * @param {Date}   now
 * @returns {Promise<boolean>}
 */
async function chainReaches(fromId, targetId, now) {
  let currentId = fromId;
  const visited = new Set();
  while (currentId) {
    if (visited.has(currentId)) break; // avoid infinite loop on existing bad data
    visited.add(currentId);
    // eslint-disable-next-line no-await-in-loop
    const delegation = await prisma.approvalDelegation.findFirst({
      where: {
        delegatorId: currentId,
        revokedAt: null,
        startDate: { lte: now },
        endDate: { gte: now },
      },
      select: { delegateId: true },
    });
    if (!delegation) break;
    if (delegation.delegateId === targetId) return true;
    currentId = delegation.delegateId;
  }
  return false;
}

/**
 * Creates a new approval delegation.
 *
 * @param {object} params
 * @param {string} params.delegatorId
 * @param {string} params.delegateId
 * @param {Date}   params.startDate
 * @param {Date}   params.endDate
 * @returns {Promise<object>} the created delegation record
 */
async function createDelegation({ delegatorId, delegateId, startDate, endDate }) {
  if (delegatorId === delegateId) {
    throw Object.assign(new Error('A user cannot delegate to themselves'), { code: 'INVALID_DELEGATE' });
  }

  if (startDate >= endDate) {
    throw Object.assign(new Error('startDate must be before endDate'), { code: 'INVALID_DATES' });
  }

  // Verify delegate exists and has an appropriate role
  const delegate = await prisma.user.findUnique({
    where: { id: delegateId },
    select: { id: true, email: true, role: true, roleId: true },
  });
  if (!delegate) {
    throw Object.assign(new Error('Delegate user not found'), { code: 'NOT_FOUND' });
  }

  // Check delegate has approver or admin role
  let delegateCanApprove = delegate.role === 'approver' || delegate.role === 'admin';
  if (!delegateCanApprove && delegate.roleId) {
    // Also accept users whose RBAC role grants documents:approve permission
    const rolePerms = await prisma.rolePermission.findMany({
      where: { roleId: delegate.roleId },
      include: { permission: true },
    });
    delegateCanApprove = rolePerms.some(rp => rp.permission.name === 'documents:approve');
  }
  if (!delegateCanApprove) {
    throw Object.assign(
      new Error('Delegate must have Approver or Admin role'),
      { code: 'INVALID_DELEGATE_ROLE' }
    );
  }

  // Circular chain check: would delegating delegatorId → delegateId create a cycle?
  const now = new Date();
  const wouldCycle = await chainReaches(delegateId, delegatorId, now);
  if (wouldCycle) {
    throw Object.assign(
      new Error('This delegation would create a circular chain'),
      { code: 'CIRCULAR_DELEGATION' }
    );
  }

  // Check for overlapping active delegation for this delegator
  const overlap = await prisma.approvalDelegation.findFirst({
    where: {
      delegatorId,
      revokedAt: null,
      startDate: { lt: endDate },
      endDate: { gt: startDate },
    },
  });
  if (overlap) {
    throw Object.assign(
      new Error('An active delegation already exists for this time range'),
      { code: 'DELEGATION_CONFLICT' }
    );
  }

  return prisma.approvalDelegation.create({
    data: { delegatorId, delegateId, startDate, endDate },
    include: {
      delegator: { select: { id: true, email: true } },
      delegate: { select: { id: true, email: true } },
    },
  });
}

/**
 * Revokes an existing delegation.
 *
 * @param {string} delegationId
 * @param {string} revokedById  - user performing the revocation
 * @returns {Promise<object>} the updated delegation record
 */
async function revokeDelegation(delegationId, revokedById) {
  const delegation = await prisma.approvalDelegation.findUnique({
    where: { id: delegationId },
  });
  if (!delegation) {
    throw Object.assign(new Error('Delegation not found'), { code: 'NOT_FOUND' });
  }
  if (delegation.revokedAt) {
    throw Object.assign(new Error('Delegation is already revoked'), { code: 'ALREADY_REVOKED' });
  }
  return prisma.approvalDelegation.update({
    where: { id: delegationId },
    data: { revokedAt: new Date(), revokedById },
    include: {
      delegator: { select: { id: true, email: true } },
      delegate: { select: { id: true, email: true } },
    },
  });
}

module.exports = { createDelegation, getActiveDelegationForApprover, revokeDelegation };
