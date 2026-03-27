'use strict';

/**
 * Escalation job — runs every hour.
 *
 * Finds pending approval workflows whose current step has exceeded the
 * configured deadline for the matching routing rule, then:
 *   1. Reassigns the step to the configured backup approver.
 *   2. Notifies the backup approver and the document submitter via email
 *      and in-app notifications.
 *   3. Writes a document.escalated audit log entry.
 *   4. Fires a document.escalated webhook event.
 *
 * Register at startup by calling `register()`.
 * Export `runEscalation(now?)` for testing.
 */

const cron = require('node-cron');
const prisma = require('../src/db/client');
const { sendDocumentEscalated } = require('../services/email');
const { notifyEscalated } = require('../services/inAppNotification');
const { logEvent } = require('../services/auditLog');
const { deliverEvent } = require('../services/webhook');

/**
 * Run the escalation check for the given reference time.
 * @param {Date} [now] - Reference time (defaults to new Date())
 * @returns {Promise<{ escalated: number }>}
 */
async function runEscalation(now = new Date()) {
  // Find all active routing rules with escalation configured
  const rules = await prisma.routingRule.findMany({
    where: {
      isActive: true,
      escalationEnabled: true,
      escalationDeadlineHours: { not: null },
      backupApproverEmail: { not: null },
    },
  });

  let escalated = 0;

  for (const rule of rules) {
    const deadlineMs = rule.escalationDeadlineHours * 60 * 60 * 1000;
    const cutoff = new Date(now.getTime() - deadlineMs);

    // Find pending workflows for this queue
    const workflows = await prisma.approvalWorkflow.findMany({
      where: {
        status: 'pending',
        queueName: rule.targetQueue,
      },
      include: {
        steps: true,
        document: {
          include: {
            metadata: true,
            uploadedBy: { select: { id: true, email: true } },
          },
        },
      },
    });

    for (const workflow of workflows) {
      const currentStep = workflow.steps.find(s => s.stepNumber === workflow.currentStep);
      if (!currentStep) continue;
      if (currentStep.escalatedAt) continue;   // already escalated
      if (!currentStep.startedAt) continue;    // no timing recorded
      if (currentStep.startedAt > cutoff) continue; // deadline not yet passed

      // Look up backup approver user
      let backupUserId = null;
      let backupUserEmail = rule.backupApproverEmail;
      try {
        const backupUser = await prisma.user.findUnique({
          where: { email: rule.backupApproverEmail },
          select: { id: true },
        });
        backupUserId = backupUser?.id ?? null;
      } catch (err) {
        console.error('[EscalationJob] Failed to look up backup approver:', err.message);
      }

      // Reassign the step to the backup approver and mark escalated
      await prisma.approvalStep.update({
        where: { id: currentStep.id },
        data: {
          assignedToUserId: backupUserId,
          escalatedAt: now,
        },
      });

      const doc = workflow.document;
      const docObj = {
        id: doc.id,
        title: doc?.metadata?.title || doc?.originalFilename || doc.id,
      };
      const docPayload = {
        id: doc.id,
        originalFilename: doc.originalFilename,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        status: doc.status,
        routingStatus: doc.routingStatus,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      };

      // Notify backup approver
      try {
        await sendDocumentEscalated(backupUserEmail, docObj, backupUserId);
      } catch (err) {
        console.error('[EscalationJob] Failed to send escalation email to backup approver:', err.message);
      }
      if (backupUserId) {
        try {
          await notifyEscalated(backupUserId, docObj);
        } catch (err) {
          console.error('[EscalationJob] Failed to create in-app escalation notification for backup approver:', err.message);
        }
      }

      // Notify submitter (if different from backup approver)
      const submitterUserId = doc?.uploadedByUserId ?? null;
      const submitterEmail = doc?.uploadedBy?.email ?? null;
      if (submitterEmail && submitterUserId !== backupUserId) {
        try {
          await sendDocumentEscalated(submitterEmail, docObj, submitterUserId);
        } catch (err) {
          console.error('[EscalationJob] Failed to send escalation email to submitter:', err.message);
        }
      }
      if (submitterUserId && submitterUserId !== backupUserId) {
        try {
          await notifyEscalated(submitterUserId, docObj);
        } catch (err) {
          console.error('[EscalationJob] Failed to create in-app escalation notification for submitter:', err.message);
        }
      }

      // Audit log
      logEvent({
        actorUserId: null,
        action: 'document.escalated',
        targetType: 'approval_workflow',
        targetId: workflow.id,
        metadata: {
          documentId: doc.id,
          stepNumber: currentStep.stepNumber,
          ruleId: rule.id,
          backupApproverEmail: rule.backupApproverEmail,
          deadlineHours: rule.escalationDeadlineHours,
        },
      });

      // Webhook
      if (submitterUserId) {
        deliverEvent(submitterUserId, 'document.escalated', docPayload);
      }

      escalated++;
      console.log(
        `[EscalationJob] Escalated workflow ${workflow.id} (step ${currentStep.stepNumber}) ` +
        `to ${rule.backupApproverEmail} (rule: ${rule.name})`
      );
    }
  }

  return { escalated };
}

function register() {
  cron.schedule('0 * * * *', async () => {
    try {
      const result = await runEscalation(new Date());
      console.log(`[EscalationJob] Completed — ${result.escalated} workflow(s) escalated`);
    } catch (err) {
      console.error('[EscalationJob] Error during escalation run:', err);
    }
  });
  console.log('[EscalationJob] Scheduled escalation check every hour');
}

module.exports = { register, runEscalation };
