'use strict';

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '../templates/email');

function isEmailEnabled() {
  return process.env.EMAIL_ENABLED !== 'false';
}

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

function renderTemplate(name, vars) {
  const htmlPath = path.join(TEMPLATES_DIR, `${name}.html`);
  const txtPath = path.join(TEMPLATES_DIR, `${name}.txt`);

  let html = fs.readFileSync(htmlPath, 'utf8');
  let text = fs.readFileSync(txtPath, 'utf8');

  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    const safe = value != null ? String(value) : '';
    html = html.replace(re, safe);
    text = text.replace(re, safe);
  }

  return { html, text };
}

function from() {
  return process.env.EMAIL_FROM || 'noreply@docflow.local';
}

/**
 * Dispatches an email asynchronously via setImmediate so the calling request
 * handler is never blocked. Returns a Promise that resolves once the mail is
 * sent (or skipped when EMAIL_ENABLED=false / SMTP not configured).
 *
 * @param {object} mailOptions - nodemailer mail options
 * @returns {Promise<void>}
 */
function dispatchEmail(mailOptions) {
  return new Promise((resolve, reject) => {
    setImmediate(async () => {
      try {
        if (!isEmailEnabled()) {
          console.log('[EmailService] EMAIL_ENABLED=false — would send:', mailOptions);
          return resolve();
        }
        if (!isSmtpConfigured()) {
          console.log(`[EmailService] SMTP not configured — skipping email to ${mailOptions.to}`);
          return resolve();
        }
        const transporter = createTransporter();
        await transporter.sendMail(mailOptions);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * document.submitted — notify assigned approvers that a new document awaits review.
 *
 * @param {string|string[]} approverEmails
 * @param {{ id: string, title?: string }} doc
 */
function sendDocumentSubmitted(approverEmails, doc) {
  const to = Array.isArray(approverEmails) ? approverEmails.join(', ') : approverEmails;
  const documentTitle = doc.title || doc.id;
  const { html, text } = renderTemplate('submitted', { documentTitle, documentId: doc.id });
  return dispatchEmail({
    from: from(),
    to,
    subject: `New document awaiting your review: ${documentTitle}`,
    html,
    text,
  });
}

/**
 * document.approved — notify submitter that their document was approved.
 *
 * @param {string} submitterEmail
 * @param {{ id: string, title?: string }} doc
 */
function sendDocumentApproved(submitterEmail, doc) {
  const documentTitle = doc.title || doc.id;
  const { html, text } = renderTemplate('approved', { documentTitle, documentId: doc.id });
  return dispatchEmail({
    from: from(),
    to: submitterEmail,
    subject: `Your document has been approved: ${documentTitle}`,
    html,
    text,
  });
}

/**
 * document.rejected — notify submitter that their document was rejected.
 *
 * @param {string} submitterEmail
 * @param {{ id: string, title?: string }} doc
 * @param {string|null} reason
 */
function sendDocumentRejected(submitterEmail, doc, reason) {
  const documentTitle = doc.title || doc.id;
  const reasonRow = reason
    ? `<tr style="background: #f5f5f5;"><td style="padding: 8px; font-weight: bold;">Reason:</td><td style="padding: 8px;">${reason}</td></tr>`
    : '';
  const reasonLine = reason ? `Reason:      ${reason}\n` : '';
  const { html, text } = renderTemplate('rejected', {
    documentTitle,
    documentId: doc.id,
    reasonRow,
    reasonLine,
  });
  return dispatchEmail({
    from: from(),
    to: submitterEmail,
    subject: `Your document has been rejected: ${documentTitle}`,
    html,
    text,
  });
}

/**
 * document.assigned — notify the new assignee that a document has been assigned to them.
 *
 * @param {string} assigneeEmail
 * @param {{ id: string, title?: string }} doc
 */
function sendDocumentAssigned(assigneeEmail, doc) {
  const documentTitle = doc.title || doc.id;
  const { html, text } = renderTemplate('assigned', { documentTitle, documentId: doc.id });
  return dispatchEmail({
    from: from(),
    to: assigneeEmail,
    subject: `A document has been assigned to you: ${documentTitle}`,
    html,
    text,
  });
}

/**
 * document.escalated — notify the escalation target that a document has been escalated.
 *
 * @param {string} escalationEmail
 * @param {{ id: string, title?: string }} doc
 */
function sendDocumentEscalated(escalationEmail, doc) {
  const documentTitle = doc.title || doc.id;
  const { html, text } = renderTemplate('escalated', { documentTitle, documentId: doc.id });
  return dispatchEmail({
    from: from(),
    to: escalationEmail,
    subject: `A document has been escalated to you: ${documentTitle}`,
    html,
    text,
  });
}

module.exports = {
  sendDocumentSubmitted,
  sendDocumentApproved,
  sendDocumentRejected,
  sendDocumentAssigned,
  sendDocumentEscalated,
};
