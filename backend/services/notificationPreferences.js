'use strict';

/**
 * Notification preference helpers.
 *
 * Each user can opt-in or opt-out of email/in-app notifications per event type.
 * Records are lazily created — a missing record means "all enabled" (default-on).
 *
 * Admin exemption: admins always receive document.escalated notifications
 * regardless of their stored preference.
 */

const prisma = require('../src/db/client');

const EVENT_TYPES = [
  'document.submitted',
  'document.approved',
  'document.rejected',
  'document.assigned',
  'document.escalated',
];

/**
 * Returns true if the user has email notifications enabled for the given event type.
 * Defaults to true when no record exists.
 * @param {string} userId
 * @param {string} eventType
 * @param {string} [userRole] - optional role, used for admin escalation exemption
 */
async function isEmailEnabled(userId, eventType, userRole) {
  if (!userId) return true;
  if (eventType === 'document.escalated') {
    const role = userRole || (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role;
    if (role === 'admin') return true;
  }
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_eventType: { userId, eventType } },
    select: { emailEnabled: true },
  });
  return pref ? pref.emailEnabled : true;
}

/**
 * Returns true if the user has in-app notifications enabled for the given event type.
 * Defaults to true when no record exists.
 * @param {string} userId
 * @param {string} eventType
 * @param {string} [userRole] - optional role, used for admin escalation exemption
 */
async function isInAppEnabled(userId, eventType, userRole) {
  if (!userId) return true;
  if (eventType === 'document.escalated') {
    const role = userRole || (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role;
    if (role === 'admin') return true;
  }
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_eventType: { userId, eventType } },
    select: { inAppEnabled: true },
  });
  return pref ? pref.inAppEnabled : true;
}

/**
 * Returns all preferences for a user, filling in defaults for missing event types.
 * @param {string} userId
 * @returns {{ eventType: string, emailEnabled: boolean, inAppEnabled: boolean }[]}
 */
async function getUserPreferences(userId) {
  const records = await prisma.notificationPreference.findMany({ where: { userId } });
  const prefMap = Object.fromEntries(records.map(r => [r.eventType, r]));
  return EVENT_TYPES.map(eventType => ({
    eventType,
    emailEnabled: prefMap[eventType]?.emailEnabled ?? true,
    inAppEnabled: prefMap[eventType]?.inAppEnabled ?? true,
  }));
}

/**
 * Bulk upsert preferences for a user.
 * Admin users cannot opt out of document.escalated — those flags are forced to true.
 *
 * @param {string} userId
 * @param {string} userRole
 * @param {{ eventType: string, emailEnabled: boolean, inAppEnabled: boolean }[]} updates
 */
async function updateUserPreferences(userId, userRole, updates) {
  const ops = updates.map(({ eventType, emailEnabled, inAppEnabled }) => {
    const isAdminEscalation = eventType === 'document.escalated' && userRole === 'admin';
    return prisma.notificationPreference.upsert({
      where: { userId_eventType: { userId, eventType } },
      create: {
        userId,
        eventType,
        emailEnabled: isAdminEscalation ? true : emailEnabled,
        inAppEnabled: isAdminEscalation ? true : inAppEnabled,
      },
      update: {
        emailEnabled: isAdminEscalation ? true : emailEnabled,
        inAppEnabled: isAdminEscalation ? true : inAppEnabled,
      },
    });
  });
  return prisma.$transaction(ops);
}

module.exports = { isEmailEnabled, isInAppEnabled, getUserPreferences, updateUserPreferences, EVENT_TYPES };
