'use strict';

const nodemailer = require('nodemailer');

function isSmtpConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Sends an email to an approver when a document is assigned to their queue.
 *
 * @param {string} approverEmail
 * @param {string} documentTitle
 * @param {string} workflowId
 */
async function sendAssignmentEmail(approverEmail, documentTitle, workflowId) {
  if (!isSmtpConfigured()) {
    console.log(
      `[NotificationService] SMTP not configured. Skipping assignment email to ${approverEmail} for "${documentTitle}" (workflow: ${workflowId})`
    );
    return;
  }

  const from = process.env.EMAIL_FROM || 'noreply@docflow.local';
  const subject = `Document assigned for approval: ${documentTitle}`;
  const html = `
    <h2>Document Assigned for Your Approval</h2>
    <p>A document has been assigned to your approval queue.</p>
    <ul>
      <li><strong>Document:</strong> ${documentTitle}</li>
      <li><strong>Workflow ID:</strong> ${workflowId}</li>
    </ul>
    <p><a href="/approver/queue">View your approval queue</a></p>
  `;

  const transporter = createTransporter();
  await transporter.sendMail({ from, to: approverEmail, subject, html });
}

/**
 * Sends a status change email to the document submitter.
 *
 * @param {string} submitterEmail
 * @param {string} documentTitle
 * @param {'approved'|'rejected'|'changes_requested'} newStatus
 * @param {string|null} comment
 */
async function sendStatusChangeEmail(submitterEmail, documentTitle, newStatus, comment) {
  if (!isSmtpConfigured()) {
    console.log(
      `[NotificationService] SMTP not configured. Skipping status change email to ${submitterEmail} for "${documentTitle}" (status: ${newStatus})`
    );
    return;
  }

  const from = process.env.EMAIL_FROM || 'noreply@docflow.local';
  const statusLabels = {
    approved: 'Approved',
    rejected: 'Rejected',
    changes_requested: 'Changes Requested',
  };
  const statusLabel = statusLabels[newStatus] || newStatus;
  const subject = `Document ${statusLabel}: ${documentTitle}`;
  const html = `
    <h2>Document Status Update</h2>
    <p>Your document status has been updated.</p>
    <ul>
      <li><strong>Document:</strong> ${documentTitle}</li>
      <li><strong>Status:</strong> ${statusLabel}</li>
      ${comment ? `<li><strong>Comment:</strong> ${comment}</li>` : ''}
    </ul>
    <p><a href="/submitter/status">View your documents</a></p>
  `;

  const transporter = createTransporter();
  await transporter.sendMail({ from, to: submitterEmail, subject, html });
}

module.exports = { sendAssignmentEmail, sendStatusChangeEmail };
