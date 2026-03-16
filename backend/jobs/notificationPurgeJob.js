'use strict';

/**
 * Nightly notification purge job (runs at 03:30 server time).
 *
 * Hard-deletes Notification records older than 30 days.
 *
 * Register this job at startup by calling `register()`.
 * Export `runPurge(now?)` for testing.
 */

const cron = require('node-cron');
const prisma = require('../src/db/client');

const NOTIFICATION_RETENTION_DAYS = 30;

/**
 * Run the notification purge for the given reference time.
 * @param {Date} [now] - Reference time (defaults to new Date())
 */
async function runPurge(now = new Date()) {
  const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await prisma.notification.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  console.log(`[NotificationPurgeJob] Deleted ${result.count} notification(s) older than ${NOTIFICATION_RETENTION_DAYS} days`);
  return { deleted: result.count };
}

function register() {
  cron.schedule('30 3 * * *', async () => {
    try {
      await runPurge(new Date());
    } catch (err) {
      console.error('[NotificationPurgeJob] Error during purge:', err);
    }
  });
  console.log('[NotificationPurgeJob] Scheduled nightly notification purge at 03:30');
}

module.exports = { register, runPurge };
