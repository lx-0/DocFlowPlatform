'use strict';

/**
 * In-app notification service.
 *
 * Creates Notification records for document lifecycle events so users can see
 * pending actions and recent activity without relying on email.
 *
 * Usage:
 *   const { notifySubmitted, notifyApproved, ... } = require('./inAppNotification');
 *   await notifySubmitted(approverUserId, { id, title });
 */

const prisma = require('../src/db/client');

/**
 * Core helper — insert a single notification row.
 * @param {string} userId
 * @param {string} type
 * @param {string} title
 * @param {string} body
 * @param {string|null} [linkUrl]
 */
async function createNotification(userId, type, title, body, linkUrl = null) {
  try {
    await prisma.notification.create({
      data: { userId, type, title, body, linkUrl },
    });
  } catch (err) {
    // Non-fatal — never let notification failures break the workflow
    console.error('[InAppNotification] Failed to create notification:', err.message);
  }
}

/**
 * Notify an approver that a document was submitted for their review.
 * @param {string} approverUserId
 * @param {{ id: string, title: string }} doc
 */
async function notifySubmitted(approverUserId, doc) {
  await createNotification(
    approverUserId,
    'document.submitted',
    'Document submitted for review',
    `"${doc.title}" has been submitted and is awaiting your approval.`,
    `/approvals`
  );
}

/**
 * Notify the document owner that their document was approved.
 * @param {string} ownerUserId
 * @param {{ id: string, title: string }} doc
 */
async function notifyApproved(ownerUserId, doc) {
  await createNotification(
    ownerUserId,
    'document.approved',
    'Document approved',
    `Your document "${doc.title}" has been approved.`,
    `/documents/${doc.id}`
  );
}

/**
 * Notify the document owner that their document was rejected.
 * @param {string} ownerUserId
 * @param {{ id: string, title: string }} doc
 * @param {string|null} [reason]
 */
async function notifyRejected(ownerUserId, doc, reason) {
  const bodyExtra = reason ? ` Reason: ${reason}` : '';
  await createNotification(
    ownerUserId,
    'document.rejected',
    'Document rejected',
    `Your document "${doc.title}" was rejected.${bodyExtra}`,
    `/documents/${doc.id}`
  );
}

/**
 * Notify a user that a document has been assigned to them.
 * @param {string} assigneeUserId
 * @param {{ id: string, title: string }} doc
 */
async function notifyAssigned(assigneeUserId, doc) {
  await createNotification(
    assigneeUserId,
    'document.assigned',
    'Document assigned to you',
    `"${doc.title}" has been assigned to you for review.`,
    `/approvals`
  );
}

/**
 * Notify a user that a document has been escalated to them.
 * @param {string} escalateeUserId
 * @param {{ id: string, title: string }} doc
 */
async function notifyEscalated(escalateeUserId, doc) {
  await createNotification(
    escalateeUserId,
    'document.escalated',
    'Document escalated to you',
    `"${doc.title}" has been escalated and requires your attention.`,
    `/approvals`
  );
}

module.exports = {
  createNotification,
  notifySubmitted,
  notifyApproved,
  notifyRejected,
  notifyAssigned,
  notifyEscalated,
};
