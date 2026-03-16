'use strict';

const prisma = require('../src/db/client');
const {
  sendDocumentSubmitted,
  sendDocumentApproved,
  sendDocumentRejected,
} = require('./email');

/**
 * Creates an ApprovalWorkflow and its step records for a document.
 *
 * @param {string} documentId
 * @param {string} queueName
 * @param {number} steps - number of approval steps
 * @param {string|null} [approverEmail] - optional approver email for assignment notification
 * @returns {Promise<object>} created workflow with steps
 */
async function createWorkflow(documentId, queueName, steps, approverEmail) {
  const workflow = await prisma.approvalWorkflow.create({
    data: {
      documentId,
      queueName,
      totalSteps: steps,
      currentStep: 1,
      status: 'pending',
      steps: {
        create: Array.from({ length: steps }, (_, i) => ({
          stepNumber: i + 1,
        })),
      },
    },
    include: { steps: true },
  });

  await prisma.document.update({
    where: { id: documentId },
    data: { routingStatus: 'in_approval' },
  });

  if (approverEmail) {
    try {
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
        include: { metadata: true },
      });
      const title = doc?.metadata?.title || doc?.originalFilename || documentId;
      await sendDocumentSubmitted(approverEmail, { id: documentId, title });
    } catch (err) {
      console.error('[WorkflowService] Failed to send submission notification:', err.message);
    }
  }

  return workflow;
}

/**
 * Records an approver action on a workflow step and advances or terminates the workflow.
 *
 * @param {string} workflowId
 * @param {number} stepNumber
 * @param {string} userId
 * @param {'approved'|'rejected'|'changes_requested'} action
 * @param {string|null} comment
 * @returns {Promise<object>} updated workflow with steps
 */
async function actOnStep(workflowId, stepNumber, userId, action, comment) {
  const workflow = await prisma.approvalWorkflow.findUnique({
    where: { id: workflowId },
    include: { steps: true },
  });

  if (!workflow) {
    throw Object.assign(new Error('Workflow not found'), { code: 'NOT_FOUND' });
  }

  if (workflow.status !== 'pending') {
    throw Object.assign(new Error('Workflow is already completed'), { code: 'INVALID_STATE' });
  }

  if (stepNumber !== workflow.currentStep) {
    throw Object.assign(
      new Error(`Expected step ${workflow.currentStep}, got ${stepNumber}`),
      { code: 'INVALID_STEP' }
    );
  }

  const step = workflow.steps.find(s => s.stepNumber === stepNumber);
  if (!step) {
    throw Object.assign(new Error('Step not found'), { code: 'NOT_FOUND' });
  }

  // Record the action on the step
  await prisma.approvalStep.update({
    where: { id: step.id },
    data: { action, comment: comment ?? null, actedAt: new Date(), assignedToUserId: userId },
  });

  let newStatus = workflow.status;
  let newCurrentStep = workflow.currentStep;
  let docRoutingStatus;

  if (action === 'approved') {
    if (stepNumber < workflow.totalSteps) {
      // Advance to next step
      newCurrentStep = stepNumber + 1;
      newStatus = 'pending';
      docRoutingStatus = 'in_approval';
    } else {
      // Final step approved — workflow complete
      newStatus = 'approved';
      docRoutingStatus = 'approved';
    }
  } else {
    // rejected or changes_requested — terminate
    newStatus = action;
    docRoutingStatus = action === 'rejected' ? 'rejected' : 'in_approval';
  }

  const updatedWorkflow = await prisma.approvalWorkflow.update({
    where: { id: workflowId },
    data: { status: newStatus, currentStep: newCurrentStep },
    include: { steps: true },
  });

  await prisma.document.update({
    where: { id: workflow.documentId },
    data: { routingStatus: docRoutingStatus },
  });

  // Send lifecycle email for terminal workflow states
  if (newStatus === 'approved' || newStatus === 'rejected') {
    try {
      const doc = await prisma.document.findUnique({
        where: { id: workflow.documentId },
        include: { metadata: true, uploadedBy: true },
      });
      if (doc?.uploadedBy?.email) {
        const docObj = {
          id: workflow.documentId,
          title: doc?.metadata?.title || doc?.originalFilename || workflow.documentId,
        };
        if (newStatus === 'approved') {
          await sendDocumentApproved(doc.uploadedBy.email, docObj);
        } else {
          await sendDocumentRejected(doc.uploadedBy.email, docObj, comment);
        }
      }
    } catch (err) {
      console.error('[WorkflowService] Failed to send lifecycle notification:', err.message);
    }
  }

  return updatedWorkflow;
}

module.exports = { createWorkflow, actOnStep };
