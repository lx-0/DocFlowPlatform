'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── nodemailer mock ──────────────────────────────────────────────────────────

const sentMails = [];
let shouldFailSend = false;

const mockTransporter = {
  sendMail: async (options) => {
    if (shouldFailSend) throw new Error('SMTP send failure');
    sentMails.push(options);
    return { messageId: 'mock-message-id' };
  },
};

const mockNodemailer = {
  createTransport: () => mockTransporter,
};

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
  delete require.cache[require.resolve('../services/notificationService')];
});

// ─── Helper to set / clear SMTP env vars ─────────────────────────────────────

function setSmtpEnv() {
  process.env.SMTP_HOST = 'smtp.example.com';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'user@example.com';
  process.env.SMTP_PASS = 'secret';
  process.env.EMAIL_FROM = 'noreply@docflow.example.com';
}

function clearSmtpEnv() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.EMAIL_FROM;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationService', () => {
  let sendAssignmentEmail, sendStatusChangeEmail;

  before(() => {
    ({ sendAssignmentEmail, sendStatusChangeEmail } = require('../services/notificationService'));
  });

  beforeEach(() => {
    sentMails.length = 0;
    shouldFailSend = false;
  });

  afterEach(() => {
    clearSmtpEnv();
  });

  // ─── sendAssignmentEmail ──────────────────────────────────────────────────

  describe('sendAssignmentEmail', () => {
    it('sends email with correct recipient, subject, and HTML when SMTP is configured', async () => {
      setSmtpEnv();

      await sendAssignmentEmail('approver@example.com', 'Q4 Budget Report', 'wf-abc-123');

      assert.equal(sentMails.length, 1);
      const mail = sentMails[0];
      assert.equal(mail.to, 'approver@example.com');
      assert.equal(mail.from, 'noreply@docflow.example.com');
      assert.ok(mail.subject.includes('Q4 Budget Report'), 'subject should include document title');
      assert.ok(mail.html.includes('Q4 Budget Report'), 'HTML should include document title');
      assert.ok(mail.html.includes('wf-abc-123'), 'HTML should include workflow ID');
    });

    it('uses EMAIL_FROM env var as sender', async () => {
      setSmtpEnv();
      process.env.EMAIL_FROM = 'custom-from@docflow.com';

      await sendAssignmentEmail('approver@example.com', 'Doc Title', 'wf-1');

      assert.equal(sentMails[0].from, 'custom-from@docflow.com');
    });

    it('falls back to default sender when EMAIL_FROM is not set', async () => {
      setSmtpEnv();
      delete process.env.EMAIL_FROM;

      await sendAssignmentEmail('approver@example.com', 'Doc Title', 'wf-1');

      assert.ok(sentMails[0].from, 'should still have a from address');
    });

    it('skips sending and logs when SMTP is not configured', async () => {
      clearSmtpEnv();

      // Should not throw, should not send
      await sendAssignmentEmail('approver@example.com', 'Q4 Budget Report', 'wf-abc-123');

      assert.equal(sentMails.length, 0, 'no email should be sent without SMTP config');
    });

    it('skips sending when only some SMTP vars are set', async () => {
      process.env.SMTP_HOST = 'smtp.example.com';
      // Missing SMTP_PORT, SMTP_USER, SMTP_PASS

      await sendAssignmentEmail('approver@example.com', 'Doc', 'wf-1');

      assert.equal(sentMails.length, 0);
    });
  });

  // ─── sendStatusChangeEmail ────────────────────────────────────────────────

  describe('sendStatusChangeEmail', () => {
    it('sends approved status email with correct content', async () => {
      setSmtpEnv();

      await sendStatusChangeEmail('submitter@example.com', 'Annual Report', 'approved', null);

      assert.equal(sentMails.length, 1);
      const mail = sentMails[0];
      assert.equal(mail.to, 'submitter@example.com');
      assert.ok(mail.subject.includes('Annual Report'), 'subject should include document title');
      assert.ok(mail.subject.toLowerCase().includes('approved'), 'subject should reflect status');
      assert.ok(mail.html.includes('Annual Report'), 'HTML should include document title');
      assert.ok(mail.html.includes('Approved'), 'HTML should show human-readable status');
    });

    it('sends rejected status email', async () => {
      setSmtpEnv();

      await sendStatusChangeEmail('submitter@example.com', 'Policy Doc', 'rejected', 'Non-compliant');

      const mail = sentMails[0];
      assert.ok(mail.subject.toLowerCase().includes('rejected'));
      assert.ok(mail.html.includes('Rejected'));
      assert.ok(mail.html.includes('Non-compliant'), 'HTML should include comment');
    });

    it('sends changes_requested status email with comment', async () => {
      setSmtpEnv();

      await sendStatusChangeEmail('submitter@example.com', 'Draft Memo', 'changes_requested', 'Please revise section 3');

      const mail = sentMails[0];
      assert.ok(mail.html.includes('Changes Requested'), 'HTML should show human-readable status');
      assert.ok(mail.html.includes('Please revise section 3'), 'HTML should include comment');
    });

    it('omits comment block when comment is null', async () => {
      setSmtpEnv();

      await sendStatusChangeEmail('submitter@example.com', 'Doc', 'approved', null);

      const mail = sentMails[0];
      // Should not contain empty comment markup
      assert.ok(!mail.html.includes('<strong>Comment:</strong>'), 'should not show empty comment field');
    });

    it('skips sending and logs when SMTP is not configured', async () => {
      clearSmtpEnv();

      await sendStatusChangeEmail('submitter@example.com', 'Annual Report', 'approved', null);

      assert.equal(sentMails.length, 0, 'no email should be sent without SMTP config');
    });
  });
});
