'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── In-memory stores ─────────────────────────────────────────────────────────

let mockRules = [];
let mockWorkflows = new Map();
let mockSteps = new Map();
let mockUsers = new Map();
let emailsSent = [];
let inAppNotifications = [];
let auditEvents = [];
let webhookEvents = [];

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockPrisma = {
  routingRule: {
    findMany: async ({ where } = {}) => {
      return mockRules.filter(r => {
        if (where?.isActive !== undefined && r.isActive !== where.isActive) return false;
        if (where?.escalationEnabled !== undefined && r.escalationEnabled !== where.escalationEnabled) return false;
        if (where?.escalationDeadlineHours?.not === null && r.escalationDeadlineHours == null) return false;
        if (where?.backupApproverEmail?.not === null && r.backupApproverEmail == null) return false;
        return true;
      });
    },
  },

  approvalWorkflow: {
    findMany: async ({ where, include } = {}) => {
      return [...mockWorkflows.values()].filter(wf => {
        if (where?.status && wf.status !== where.status) return false;
        if (where?.queueName && wf.queueName !== where.queueName) return false;
        return true;
      }).map(wf => {
        const steps = [...mockSteps.values()].filter(s => s.workflowId === wf.id);
        const doc = wf._document;
        return { ...wf, steps, document: doc };
      });
    },
  },

  approvalStep: {
    update: async ({ where, data }) => {
      const step = mockSteps.get(where.id);
      if (!step) throw new Error('step not found');
      const updated = { ...step, ...data };
      mockSteps.set(where.id, updated);
      return updated;
    },
  },

  user: {
    findUnique: async ({ where }) => {
      if (where?.email) {
        return [...mockUsers.values()].find(u => u.email === where.email) ?? null;
      }
      if (where?.id) {
        return mockUsers.get(where.id) ?? null;
      }
      return null;
    },
  },

  notificationPreference: {
    findUnique: async () => null, // default: all enabled
  },
};

// ─── Service mocks ────────────────────────────────────────────────────────────

const mockEmail = {
  sendDocumentEscalated: async (to, doc, userId) => {
    emailsSent.push({ to, docId: doc.id, userId });
  },
};

const mockInApp = {
  notifyEscalated: async (userId, doc) => {
    inAppNotifications.push({ userId, docId: doc.id });
  },
};

const mockAuditLog = {
  logEvent: (params) => {
    auditEvents.push(params);
  },
};

const mockWebhook = {
  deliverEvent: (userId, event, payload) => {
    webhookEvents.push({ userId, event, payload });
  },
};

// ─── Module setup ─────────────────────────────────────────────────────────────

before(() => {
  require.cache[require.resolve('../src/db/client')] = {
    id: require.resolve('../src/db/client'),
    filename: require.resolve('../src/db/client'),
    loaded: true,
    exports: mockPrisma,
  };
  require.cache[require.resolve('../services/email')] = {
    id: require.resolve('../services/email'),
    filename: require.resolve('../services/email'),
    loaded: true,
    exports: mockEmail,
  };
  require.cache[require.resolve('../services/inAppNotification')] = {
    id: require.resolve('../services/inAppNotification'),
    filename: require.resolve('../services/inAppNotification'),
    loaded: true,
    exports: mockInApp,
  };
  require.cache[require.resolve('../services/auditLog')] = {
    id: require.resolve('../services/auditLog'),
    filename: require.resolve('../services/auditLog'),
    loaded: true,
    exports: mockAuditLog,
  };
  require.cache[require.resolve('../services/webhook')] = {
    id: require.resolve('../services/webhook'),
    filename: require.resolve('../services/webhook'),
    loaded: true,
    exports: mockWebhook,
  };
});

after(() => {
  for (const mod of [
    '../src/db/client',
    '../services/email',
    '../services/inAppNotification',
    '../services/auditLog',
    '../services/webhook',
    '../jobs/escalationJob',
  ]) {
    delete require.cache[require.resolve(mod)];
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(overrides = {}) {
  return {
    id: 'rule-1',
    name: 'Legal Review',
    targetQueue: 'legal-queue',
    isActive: true,
    escalationEnabled: true,
    escalationDeadlineHours: 24,
    backupApproverEmail: 'backup@example.com',
    ...overrides,
  };
}

function makeWorkflow(overrides = {}) {
  return {
    id: 'wf-1',
    documentId: 'doc-1',
    queueName: 'legal-queue',
    currentStep: 1,
    totalSteps: 2,
    status: 'pending',
    ...overrides,
  };
}

function makeStep(overrides = {}) {
  return {
    id: 'step-1',
    workflowId: 'wf-1',
    stepNumber: 1,
    assignedToUserId: null,
    action: null,
    comment: null,
    actedAt: null,
    startedAt: new Date(Date.now() - 30 * 60 * 60 * 1000), // 30h ago (overdue for 24h deadline)
    escalatedAt: null,
    ...overrides,
  };
}

function makeDocument(overrides = {}) {
  return {
    id: 'doc-1',
    originalFilename: 'contract.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    status: 'uploaded',
    routingStatus: 'in_approval',
    uploadedByUserId: 'submitter-user-id',
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: { title: 'Contract Agreement' },
    uploadedBy: { id: 'submitter-user-id', email: 'submitter@example.com' },
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('EscalationJob', () => {
  let runEscalation;

  before(() => {
    ({ runEscalation } = require('../jobs/escalationJob'));
  });

  beforeEach(() => {
    mockRules = [];
    mockWorkflows.clear();
    mockSteps.clear();
    mockUsers.clear();
    emailsSent = [];
    inAppNotifications = [];
    auditEvents = [];
    webhookEvents = [];
  });

  describe('runEscalation — no rules', () => {
    it('returns 0 escalated when no escalation rules exist', async () => {
      const result = await runEscalation(new Date());
      assert.equal(result.escalated, 0);
    });
  });

  describe('runEscalation — no overdue workflows', () => {
    it('skips steps where startedAt is within the deadline', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep({ startedAt: new Date(Date.now() - 1 * 60 * 60 * 1000) }); // 1h ago, within 24h deadline
      mockSteps.set(step.id, step);
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      const result = await runEscalation(new Date());
      assert.equal(result.escalated, 0);
    });

    it('skips steps that have no startedAt', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep({ startedAt: null });
      mockSteps.set(step.id, step);
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      const result = await runEscalation(new Date());
      assert.equal(result.escalated, 0);
    });

    it('skips steps already escalated', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep({ escalatedAt: new Date(Date.now() - 1000) });
      mockSteps.set(step.id, step);
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      const result = await runEscalation(new Date());
      assert.equal(result.escalated, 0);
    });
  });

  describe('runEscalation — overdue step escalated', () => {
    it('escalates an overdue step and returns count', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      mockUsers.set('backup-user-id', { id: 'backup-user-id', email: 'backup@example.com', role: 'user' });
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      const now = new Date();
      const result = await runEscalation(now);

      assert.equal(result.escalated, 1);
    });

    it('sets escalatedAt on the step', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      const now = new Date();
      await runEscalation(now);

      const updatedStep = mockSteps.get(step.id);
      assert.deepEqual(updatedStep.escalatedAt, now);
    });

    it('assigns backup approver userId to the step', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      mockUsers.set('backup-user-id', { id: 'backup-user-id', email: 'backup@example.com', role: 'user' });
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      await runEscalation(new Date());

      const updatedStep = mockSteps.get(step.id);
      assert.equal(updatedStep.assignedToUserId, 'backup-user-id');
    });

    it('sends escalation email to backup approver', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      await runEscalation(new Date());

      const toBackup = emailsSent.find(e => e.to === 'backup@example.com');
      assert.ok(toBackup, 'email sent to backup approver');
      assert.equal(toBackup.docId, 'doc-1');
    });

    it('sends escalation email to submitter', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      await runEscalation(new Date());

      const toSubmitter = emailsSent.find(e => e.to === 'submitter@example.com');
      assert.ok(toSubmitter, 'email sent to submitter');
    });

    it('creates in-app notifications for backup approver and submitter', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      mockUsers.set('backup-user-id', { id: 'backup-user-id', email: 'backup@example.com', role: 'user' });
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      await runEscalation(new Date());

      const backupNotif = inAppNotifications.find(n => n.userId === 'backup-user-id');
      assert.ok(backupNotif, 'in-app notification for backup approver');

      const submitterNotif = inAppNotifications.find(n => n.userId === 'submitter-user-id');
      assert.ok(submitterNotif, 'in-app notification for submitter');
    });

    it('logs a document.escalated audit event', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      await runEscalation(new Date());

      const auditEv = auditEvents.find(e => e.action === 'document.escalated');
      assert.ok(auditEv, 'audit event logged');
      assert.equal(auditEv.targetType, 'approval_workflow');
      assert.equal(auditEv.targetId, wf.id);
      assert.equal(auditEv.metadata.documentId, 'doc-1');
    });

    it('fires a document.escalated webhook event', async () => {
      mockRules = [makeRule()];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      await runEscalation(new Date());

      const hook = webhookEvents.find(e => e.event === 'document.escalated');
      assert.ok(hook, 'webhook event fired');
      assert.equal(hook.userId, 'submitter-user-id');
    });
  });

  describe('runEscalation — backup is the submitter', () => {
    it('does not send duplicate notifications when backup approver is the same user as submitter', async () => {
      mockRules = [makeRule({ backupApproverEmail: 'submitter@example.com' })];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      // backup user same as submitter
      mockUsers.set('submitter-user-id', { id: 'submitter-user-id', email: 'submitter@example.com', role: 'user' });
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      await runEscalation(new Date());

      // Only one email — to submitter/backup (same person)
      const emails = emailsSent.filter(e => e.to === 'submitter@example.com');
      assert.equal(emails.length, 1);
      // Only one in-app notification
      const notifs = inAppNotifications.filter(n => n.userId === 'submitter-user-id');
      assert.equal(notifs.length, 1);
    });
  });

  describe('runEscalation — escalation disabled', () => {
    it('skips rules where escalationEnabled is false', async () => {
      mockRules = [makeRule({ escalationEnabled: false })];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      const result = await runEscalation(new Date());
      assert.equal(result.escalated, 0);
    });

    it('skips rules where backupApproverEmail is null', async () => {
      mockRules = [makeRule({ backupApproverEmail: null })];
      const wf = makeWorkflow();
      const step = makeStep();
      mockSteps.set(step.id, step);
      mockWorkflows.set(wf.id, { ...wf, _document: makeDocument() });

      const result = await runEscalation(new Date());
      assert.equal(result.escalated, 0);
    });
  });

  describe('runEscalation — multiple workflows', () => {
    it('escalates all overdue workflows across matching rules', async () => {
      mockRules = [makeRule()];

      for (let i = 1; i <= 3; i++) {
        const wfId = `wf-${i}`;
        const docId = `doc-${i}`;
        const stepId = `step-${i}`;
        const wf = makeWorkflow({ id: wfId, documentId: docId });
        const doc = makeDocument({
          id: docId,
          uploadedByUserId: `submitter-${i}`,
          uploadedBy: { id: `submitter-${i}`, email: `submitter${i}@example.com` },
        });
        const step = makeStep({ id: stepId, workflowId: wfId });
        mockSteps.set(stepId, step);
        mockWorkflows.set(wfId, { ...wf, _document: doc });
      }

      const result = await runEscalation(new Date());
      assert.equal(result.escalated, 3);
    });
  });
});
