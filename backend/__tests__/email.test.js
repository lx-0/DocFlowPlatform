'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// ─── nodemailer mock ──────────────────────────────────────────────────────────

const sentMails = [];
let shouldFailSend = false;

const mockTransporter = {
  sendMail: async (options) => {
    if (shouldFailSend) throw new Error('SMTP send failure');
    sentMails.push(options);
    return { messageId: 'mock-id' };
  },
};

const mockNodemailer = { createTransport: () => mockTransporter };

// ─── Setup / teardown ─────────────────────────────────────────────────────────

before(() => {
  require.cache[require.resolve('nodemailer')] = {
    id: require.resolve('nodemailer'),
    filename: require.resolve('nodemailer'),
    loaded: true,
    exports: mockNodemailer,
  };
});

after(() => {
  delete require.cache[require.resolve('nodemailer')];
  delete require.cache[require.resolve('../services/email')];
});

function setSmtpEnv() {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASS = 'secret';
  process.env.EMAIL_FROM = 'noreply@docflow.example.com';
  process.env.EMAIL_ENABLED = 'true';
}

function clearEnv() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_ENABLED;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EmailService', () => {
  let emailService;

  before(() => {
    emailService = require('../services/email');
  });

  beforeEach(() => {
    sentMails.length = 0;
    shouldFailSend = false;
  });

  afterEach(() => {
    clearEnv();
  });

  // ─── EMAIL_ENABLED flag ───────────────────────────────────────────────────

  describe('EMAIL_ENABLED env var', () => {
    it('skips sending and logs when EMAIL_ENABLED=false', async () => {
      setSmtpEnv();
      process.env.EMAIL_ENABLED = 'false';

      await emailService.sendDocumentApproved('user@example.com', { id: 'doc-1', title: 'Test Doc' });

      assert.equal(sentMails.length, 0, 'no email should be sent when EMAIL_ENABLED=false');
    });

    it('sends email when EMAIL_ENABLED=true', async () => {
      setSmtpEnv();
      process.env.EMAIL_ENABLED = 'true';

      await emailService.sendDocumentApproved('user@example.com', { id: 'doc-1', title: 'Test Doc' });

      assert.equal(sentMails.length, 1);
    });

    it('sends email when EMAIL_ENABLED is not set (default on)', async () => {
      setSmtpEnv();
      delete process.env.EMAIL_ENABLED;

      await emailService.sendDocumentApproved('user@example.com', { id: 'doc-1', title: 'Test Doc' });

      assert.equal(sentMails.length, 1);
    });
  });

  // ─── SMTP not configured ──────────────────────────────────────────────────

  describe('SMTP not configured', () => {
    it('skips sending when SMTP env vars are absent', async () => {
      clearEnv();
      process.env.EMAIL_ENABLED = 'true';

      await emailService.sendDocumentApproved('user@example.com', { id: 'doc-1', title: 'Test Doc' });

      assert.equal(sentMails.length, 0);
    });

    it('skips sending when only some SMTP vars are set', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.EMAIL_ENABLED = 'true';

      await emailService.sendDocumentApproved('user@example.com', { id: 'doc-1', title: 'Test Doc' });

      assert.equal(sentMails.length, 0);
    });
  });

  // ─── sendDocumentSubmitted ────────────────────────────────────────────────

  describe('sendDocumentSubmitted', () => {
    it('sends to single approver with correct subject and content', async () => {
      setSmtpEnv();

      await emailService.sendDocumentSubmitted('approver@example.com', { id: 'doc-42', title: 'Q4 Budget' });

      assert.equal(sentMails.length, 1);
      const mail = sentMails[0];
      assert.equal(mail.to, 'approver@example.com');
      assert.equal(mail.from, 'noreply@docflow.example.com');
      assert.ok(mail.subject.includes('Q4 Budget'), 'subject includes doc title');
      assert.ok(mail.subject.toLowerCase().includes('review'), 'subject mentions review');
      assert.ok(mail.html.includes('Q4 Budget'), 'HTML includes doc title');
      assert.ok(mail.html.includes('doc-42'), 'HTML includes doc ID');
      assert.ok(mail.text.includes('Q4 Budget'), 'text includes doc title');
    });

    it('joins multiple approver emails', async () => {
      setSmtpEnv();

      await emailService.sendDocumentSubmitted(
        ['a@example.com', 'b@example.com'],
        { id: 'doc-1', title: 'Policy' }
      );

      assert.ok(sentMails[0].to.includes('a@example.com'));
      assert.ok(sentMails[0].to.includes('b@example.com'));
    });

    it('falls back to doc.id when title is absent', async () => {
      setSmtpEnv();

      await emailService.sendDocumentSubmitted('approver@example.com', { id: 'doc-99' });

      assert.ok(sentMails[0].subject.includes('doc-99'));
    });
  });

  // ─── sendDocumentApproved ─────────────────────────────────────────────────

  describe('sendDocumentApproved', () => {
    it('sends to submitter with approved content', async () => {
      setSmtpEnv();

      await emailService.sendDocumentApproved('submitter@example.com', { id: 'doc-5', title: 'Annual Report' });

      assert.equal(sentMails.length, 1);
      const mail = sentMails[0];
      assert.equal(mail.to, 'submitter@example.com');
      assert.ok(mail.subject.includes('Annual Report'));
      assert.ok(mail.subject.toLowerCase().includes('approved'));
      assert.ok(mail.html.toLowerCase().includes('approved'));
      assert.ok(mail.text.toLowerCase().includes('approved'));
    });
  });

  // ─── sendDocumentRejected ─────────────────────────────────────────────────

  describe('sendDocumentRejected', () => {
    it('sends rejection email with reason in HTML and text', async () => {
      setSmtpEnv();

      await emailService.sendDocumentRejected(
        'submitter@example.com',
        { id: 'doc-7', title: 'Draft Memo' },
        'Missing executive signature'
      );

      assert.equal(sentMails.length, 1);
      const mail = sentMails[0];
      assert.equal(mail.to, 'submitter@example.com');
      assert.ok(mail.subject.toLowerCase().includes('rejected'));
      assert.ok(mail.html.includes('Missing executive signature'), 'HTML includes reason');
      assert.ok(mail.text.includes('Missing executive signature'), 'text includes reason');
    });

    it('omits reason block when reason is null', async () => {
      setSmtpEnv();

      await emailService.sendDocumentRejected('submitter@example.com', { id: 'doc-7', title: 'Draft' }, null);

      const mail = sentMails[0];
      assert.ok(!mail.html.includes('<strong>Reason:</strong>'), 'no reason row in HTML');
      assert.ok(!mail.text.includes('Reason:'), 'no reason line in text');
    });

    it('omits reason block when reason is empty string', async () => {
      setSmtpEnv();

      await emailService.sendDocumentRejected('submitter@example.com', { id: 'doc-7', title: 'Draft' }, '');

      const mail = sentMails[0];
      assert.ok(!mail.html.includes('<strong>Reason:</strong>'), 'no reason row in HTML');
    });
  });

  // ─── sendDocumentAssigned ─────────────────────────────────────────────────

  describe('sendDocumentAssigned', () => {
    it('sends assignment email to assignee', async () => {
      setSmtpEnv();

      await emailService.sendDocumentAssigned('assignee@example.com', { id: 'doc-10', title: 'Policy Update' });

      assert.equal(sentMails.length, 1);
      const mail = sentMails[0];
      assert.equal(mail.to, 'assignee@example.com');
      assert.ok(mail.subject.includes('Policy Update'));
      assert.ok(mail.subject.toLowerCase().includes('assigned'));
      assert.ok(mail.html.includes('Policy Update'));
    });
  });

  // ─── sendDocumentEscalated ────────────────────────────────────────────────

  describe('sendDocumentEscalated', () => {
    it('sends escalation email to escalation target', async () => {
      setSmtpEnv();

      await emailService.sendDocumentEscalated('manager@example.com', { id: 'doc-20', title: 'Urgent Contract' });

      assert.equal(sentMails.length, 1);
      const mail = sentMails[0];
      assert.equal(mail.to, 'manager@example.com');
      assert.ok(mail.subject.includes('Urgent Contract'));
      assert.ok(mail.subject.toLowerCase().includes('escalated'));
      assert.ok(mail.html.includes('Urgent Contract'));
    });
  });

  // ─── EMAIL_FROM fallback ──────────────────────────────────────────────────

  describe('EMAIL_FROM', () => {
    it('uses EMAIL_FROM env var as sender', async () => {
      setSmtpEnv();
      process.env.EMAIL_FROM = 'custom@docflow.io';

      await emailService.sendDocumentApproved('user@example.com', { id: 'doc-1', title: 'Doc' });

      assert.equal(sentMails[0].from, 'custom@docflow.io');
    });

    it('uses default sender when EMAIL_FROM is not set', async () => {
      setSmtpEnv();
      delete process.env.EMAIL_FROM;

      await emailService.sendDocumentApproved('user@example.com', { id: 'doc-1', title: 'Doc' });

      assert.ok(sentMails[0].from, 'should have a from address');
    });
  });

  // ─── Async dispatch ───────────────────────────────────────────────────────

  describe('async dispatch', () => {
    it('resolves without throwing when SMTP send fails', async () => {
      setSmtpEnv();
      shouldFailSend = true;

      await assert.rejects(
        () => emailService.sendDocumentApproved('user@example.com', { id: 'doc-1', title: 'Doc' }),
        /SMTP send failure/
      );
    });
  });
});
