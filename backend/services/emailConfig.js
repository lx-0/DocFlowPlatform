'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const prisma = require('../src/db/client');

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const TEMPLATES_DIR = path.join(__dirname, '../templates/email');

// ─── Encryption ───────────────────────────────────────────────────────────────

function getEncryptionKey() {
  const k = process.env.ENCRYPTION_KEY || 'docflow-default-insecure-key';
  return crypto.createHash('sha256').update(k).digest();
}

function encrypt(plaintext) {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(ciphertext) {
  if (!ciphertext) return '';
  try {
    const [ivHex, encHex] = ciphertext.split(':');
    if (!ivHex || !encHex) return '';
    const iv = Buffer.from(ivHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), iv);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

// ─── SMTP config ──────────────────────────────────────────────────────────────

const SMTP_KEYS = ['smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass', 'smtp.fromAddress', 'smtp.fromName'];

/**
 * Returns SMTP configuration, checking the DB first and falling back to env vars.
 * smtpPass is decrypted before being returned.
 */
async function getSmtpConfig() {
  try {
    const rows = await prisma.systemConfig.findMany({ where: { key: { in: SMTP_KEYS } } });
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      host: map['smtp.host'] || process.env.SMTP_HOST || '',
      port: map['smtp.port'] ? Number(map['smtp.port']) : Number(process.env.SMTP_PORT || 587),
      user: map['smtp.user'] || process.env.SMTP_USER || '',
      pass: map['smtp.pass'] ? decrypt(map['smtp.pass']) : (process.env.SMTP_PASS || ''),
      fromAddress: map['smtp.fromAddress'] || process.env.EMAIL_FROM || 'noreply@docflow.local',
      fromName: map['smtp.fromName'] || '',
    };
  } catch {
    return {
      host: process.env.SMTP_HOST || '',
      port: Number(process.env.SMTP_PORT || 587),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      fromAddress: process.env.EMAIL_FROM || 'noreply@docflow.local',
      fromName: '',
    };
  }
}

// ─── Notification templates ───────────────────────────────────────────────────

const EVENT_TYPES = ['submitted', 'approved', 'rejected', 'assigned', 'escalated'];

const DEFAULT_SUBJECTS = {
  submitted: 'New document awaiting your review: {{documentTitle}}',
  approved: 'Your document has been approved: {{documentTitle}}',
  rejected: 'Your document has been rejected: {{documentTitle}}',
  assigned: 'A document has been assigned to you: {{documentTitle}}',
  escalated: 'A document has been escalated to you: {{documentTitle}}',
};

function readFileTemplate(eventType) {
  const htmlPath = path.join(TEMPLATES_DIR, `${eventType}.html`);
  const txtPath = path.join(TEMPLATES_DIR, `${eventType}.txt`);
  return {
    html: fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : '',
    text: fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : '',
  };
}

/**
 * Returns the current subject + body for an event type.
 * DB overrides take precedence; file-based templates are the fallback.
 */
async function getTemplate(eventType) {
  try {
    const [subjectRow, bodyRow] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: `template.${eventType}.subject` } }),
      prisma.systemConfig.findUnique({ where: { key: `template.${eventType}.body` } }),
    ]);
    const subject = subjectRow?.value || DEFAULT_SUBJECTS[eventType] || '';
    const body = bodyRow?.value || null; // null → use file template
    return { subject, body, isCustomized: !!(subjectRow || bodyRow) };
  } catch {
    return { subject: DEFAULT_SUBJECTS[eventType] || '', body: null, isCustomized: false };
  }
}

// Sample data used for template preview
const SAMPLE_DATA = {
  documentTitle: 'Sample Document',
  documentId: 'DOC-00000000-0000-0000-0000-000000000000',
  reasonRow: '<tr style="background: #f5f5f5;"><td style="padding: 8px; font-weight: bold;">Reason:</td><td style="padding: 8px;">Sample rejection reason</td></tr>',
  reasonLine: 'Reason:      Sample rejection reason\n',
};

module.exports = {
  encrypt,
  decrypt,
  getSmtpConfig,
  getTemplate,
  readFileTemplate,
  EVENT_TYPES,
  DEFAULT_SUBJECTS,
  SAMPLE_DATA,
  SMTP_KEYS,
};
