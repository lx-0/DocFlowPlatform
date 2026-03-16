'use strict';

const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { getSmtpConfig, getTemplate, readFileTemplate } = require('./emailConfig');
const { isEmailEnabled: isEmailPrefEnabled } = require('./notificationPreferences');

const TEMPLATES_DIR = path.join(__dirname, '../templates/email');

function isEmailEnabled() {
  return process.env.EMAIL_ENABLED !== 'false';
}

function renderVars(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    out = out.replace(re, value != null ? String(value) : '');
  }
  return out;
}

/**
 * Builds nodemailer mail options for a given event type, resolving the
 * subject and body from DB overrides (with file-based template fallback).
 */
async function buildMailOptions(eventType, vars, toAddress) {
  const config = await getSmtpConfig();
  const { subject: subjectTemplate, body: dbBody } = await getTemplate(eventType);

  const subject = renderVars(subjectTemplate, vars);

  // HTML: prefer DB override, fall back to file template
  let html;
  if (dbBody) {
    html = renderVars(dbBody, vars);
  } else {
    const htmlPath = path.join(TEMPLATES_DIR, `${eventType}.html`);
    html = renderVars(fs.readFileSync(htmlPath, 'utf8'), vars);
  }

  // Plain-text always comes from file (no DB storage for text variant)
  const { text: fileText } = readFileTemplate(eventType);
  const text = renderVars(fileText, vars);

  const fromStr = config.fromName
    ? `"${config.fromName}" <${config.fromAddress}>`
    : config.fromAddress;

  return { config, mailOptions: { from: fromStr, to: toAddress, subject, html, text } };
}

/**
 * Dispatches an email asynchronously via setImmediate so the calling request
 * handler is never blocked. Returns a Promise that resolves once the mail is
 * sent (or skipped when EMAIL_ENABLED=false / SMTP not configured).
 */
async function dispatchEmail(eventType, vars, toAddress) {
  return new Promise((resolve, reject) => {
    setImmediate(async () => {
      try {
        if (!isEmailEnabled()) {
          console.log(`[EmailService] EMAIL_ENABLED=false — would send ${eventType} to ${toAddress}`);
          return resolve();
        }

        const { config, mailOptions } = await buildMailOptions(eventType, vars, toAddress);

        if (!config.host || !config.user || !config.pass) {
          console.log(`[EmailService] SMTP not configured — skipping email to ${toAddress}`);
          return resolve();
        }

        const transporter = nodemailer.createTransport({
          host: config.host,
          port: config.port,
          auth: { user: config.user, pass: config.pass },
        });
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
 * @param {string} [approverUserId] - optional, used to check notification preferences
 */
async function sendDocumentSubmitted(approverEmails, doc, approverUserId) {
  if (approverUserId && !(await isEmailPrefEnabled(approverUserId, 'document.submitted'))) return;
  const to = Array.isArray(approverEmails) ? approverEmails.join(', ') : approverEmails;
  return dispatchEmail('submitted', { documentTitle: doc.title || doc.id, documentId: doc.id }, to);
}

/**
 * document.approved — notify submitter that their document was approved.
 *
 * @param {string} submitterEmail
 * @param {{ id: string, title?: string }} doc
 * @param {string} [submitterUserId] - optional, used to check notification preferences
 */
async function sendDocumentApproved(submitterEmail, doc, submitterUserId) {
  if (submitterUserId && !(await isEmailPrefEnabled(submitterUserId, 'document.approved'))) return;
  return dispatchEmail('approved', { documentTitle: doc.title || doc.id, documentId: doc.id }, submitterEmail);
}

/**
 * document.rejected — notify submitter that their document was rejected.
 *
 * @param {string} submitterEmail
 * @param {{ id: string, title?: string }} doc
 * @param {string|null} reason
 * @param {string} [submitterUserId] - optional, used to check notification preferences
 */
async function sendDocumentRejected(submitterEmail, doc, reason, submitterUserId) {
  if (submitterUserId && !(await isEmailPrefEnabled(submitterUserId, 'document.rejected'))) return;
  const reasonRow = reason
    ? `<tr style="background: #f5f5f5;"><td style="padding: 8px; font-weight: bold;">Reason:</td><td style="padding: 8px;">${reason}</td></tr>`
    : '';
  const reasonLine = reason ? `Reason:      ${reason}\n` : '';
  return dispatchEmail(
    'rejected',
    { documentTitle: doc.title || doc.id, documentId: doc.id, reasonRow, reasonLine },
    submitterEmail,
  );
}

/**
 * document.assigned — notify the new assignee that a document has been assigned to them.
 *
 * @param {string} assigneeEmail
 * @param {{ id: string, title?: string }} doc
 * @param {string} [assigneeUserId] - optional, used to check notification preferences
 */
async function sendDocumentAssigned(assigneeEmail, doc, assigneeUserId) {
  if (assigneeUserId && !(await isEmailPrefEnabled(assigneeUserId, 'document.assigned'))) return;
  return dispatchEmail('assigned', { documentTitle: doc.title || doc.id, documentId: doc.id }, assigneeEmail);
}

/**
 * document.escalated — notify the escalation target that a document has been escalated.
 *
 * @param {string} escalationEmail
 * @param {{ id: string, title?: string }} doc
 * @param {string} [escalateeUserId] - optional, used to check notification preferences
 */
async function sendDocumentEscalated(escalationEmail, doc, escalateeUserId) {
  if (escalateeUserId && !(await isEmailPrefEnabled(escalateeUserId, 'document.escalated'))) return;
  return dispatchEmail('escalated', { documentTitle: doc.title || doc.id, documentId: doc.id }, escalationEmail);
}

module.exports = {
  sendDocumentSubmitted,
  sendDocumentApproved,
  sendDocumentRejected,
  sendDocumentAssigned,
  sendDocumentEscalated,
};
