'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockWorkflows = new Map();
const mockSteps = new Map();
const mockDocuments = new Map();

let _idCounter = 1;
function nextId() { return String(_idCounter++); }

function buildWorkflow(data) {
  return {
    id: data.id ?? nextId(),
    documentId: data.documentId,
    queueName: data.queueName,
    currentStep: data.currentStep ?? 1,
    totalSteps: data.totalSteps,
    status: data.status ?? 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const mockPrisma = {
  approvalWorkflow: {
    create: async ({ data, include }) => {
      const wf = buildWorkflow({
        id: nextId(),
        documentId: data.documentId,
        queueName: data.queueName,
        currentStep: data.currentStep ?? 1,
        totalSteps: data.totalSteps,
        status: data.status ?? 'pending',
      });
      mockWorkflows.set(wf.id, wf);

      // create nested steps
      const createdSteps = (data.steps?.create ?? []).map(s => {
        const step = { id: nextId(), workflowId: wf.id, stepNumber: s.stepNumber, assignedToUserId: null, action: null, comment: null, actedAt: null };
        mockSteps.set(step.id, step);
        return step;
      });

      return include?.steps ? { ...wf, steps: createdSteps } : wf;
    },

    findUnique: async ({ where, include }) => {
      const wf = mockWorkflows.get(where.id);
      if (!wf) return null;
      if (include?.steps) {
        const steps = [...mockSteps.values()].filter(s => s.workflowId === wf.id);
        return { ...wf, steps };
      }
      return { ...wf };
    },

    update: async ({ where, data, include }) => {
      const wf = mockWorkflows.get(where.id);
      if (!wf) throw new Error('not found');
      const updated = { ...wf, ...data, updatedAt: new Date() };
      mockWorkflows.set(where.id, updated);
      if (include?.steps) {
        const steps = [...mockSteps.values()].filter(s => s.workflowId === updated.id);
        return { ...updated, steps };
      }
      return updated;
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

  document: {
    update: async ({ where, data }) => {
      const existing = mockDocuments.get(where.id) || { id: where.id };
      const updated = { ...existing, ...data };
      mockDocuments.set(where.id, updated);
      return updated;
    },
  },
};

before(() => {
  require.cache[require.resolve('../src/db/client')] = {
    id: require.resolve('../src/db/client'),
    filename: require.resolve('../src/db/client'),
    loaded: true,
    exports: mockPrisma,
  };
});

after(() => {
  delete require.cache[require.resolve('../src/db/client')];
  delete require.cache[require.resolve('../services/workflowService')];
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkflowService', () => {
  let createWorkflow, actOnStep;

  before(() => {
    ({ createWorkflow, actOnStep } = require('../services/workflowService'));
  });

  beforeEach(() => {
    mockWorkflows.clear();
    mockSteps.clear();
    mockDocuments.clear();
    _idCounter = 1;
  });

  // ─── createWorkflow ────────────────────────────────────────────────────────

  describe('createWorkflow', () => {
    it('creates workflow with correct step count', async () => {
      const wf = await createWorkflow('doc-1', 'legal-queue', 3);

      assert.equal(wf.documentId, 'doc-1');
      assert.equal(wf.queueName, 'legal-queue');
      assert.equal(wf.totalSteps, 3);
      assert.equal(wf.currentStep, 1);
      assert.equal(wf.status, 'pending');
      assert.equal(wf.steps.length, 3);
      assert.deepEqual(wf.steps.map(s => s.stepNumber), [1, 2, 3]);
    });

    it('sets document routingStatus to in_approval', async () => {
      await createWorkflow('doc-2', 'hr-queue', 1);

      assert.equal(mockDocuments.get('doc-2').routingStatus, 'in_approval');
    });

    it('creates single-step workflow', async () => {
      const wf = await createWorkflow('doc-3', 'finance-queue', 1);
      assert.equal(wf.steps.length, 1);
      assert.equal(wf.steps[0].stepNumber, 1);
    });
  });

  // ─── actOnStep: approve advances ──────────────────────────────────────────

  describe('actOnStep — approve advances', () => {
    it('advances to next step when approved and not final step', async () => {
      const wf = await createWorkflow('doc-10', 'legal-queue', 2);

      const updated = await actOnStep(wf.id, 1, 'user-1', 'approved', null);

      assert.equal(updated.currentStep, 2);
      assert.equal(updated.status, 'pending');
      assert.equal(mockDocuments.get('doc-10').routingStatus, 'in_approval');
    });

    it('sets workflow to approved on final step approval', async () => {
      const wf = await createWorkflow('doc-11', 'legal-queue', 1);

      const updated = await actOnStep(wf.id, 1, 'user-1', 'approved', null);

      assert.equal(updated.status, 'approved');
      assert.equal(mockDocuments.get('doc-11').routingStatus, 'approved');
    });

    it('records step action, userId, and actedAt', async () => {
      const wf = await createWorkflow('doc-12', 'hr-queue', 1);
      await actOnStep(wf.id, 1, 'user-99', 'approved', 'LGTM');

      const step = [...mockSteps.values()].find(s => s.workflowId === wf.id && s.stepNumber === 1);
      assert.equal(step.action, 'approved');
      assert.equal(step.assignedToUserId, 'user-99');
      assert.equal(step.comment, 'LGTM');
      assert.ok(step.actedAt instanceof Date);
    });
  });

  // ─── actOnStep: reject terminates ─────────────────────────────────────────

  describe('actOnStep — reject terminates', () => {
    it('terminates workflow on rejected action', async () => {
      const wf = await createWorkflow('doc-20', 'finance-queue', 3);

      const updated = await actOnStep(wf.id, 1, 'user-2', 'rejected', 'Not compliant');

      assert.equal(updated.status, 'rejected');
      assert.equal(mockDocuments.get('doc-20').routingStatus, 'rejected');
    });

    it('terminates workflow on changes_requested action', async () => {
      const wf = await createWorkflow('doc-21', 'finance-queue', 3);

      const updated = await actOnStep(wf.id, 1, 'user-2', 'changes_requested', 'Need revisions');

      assert.equal(updated.status, 'changes_requested');
      // document remains in_approval (still being worked on)
      assert.equal(mockDocuments.get('doc-21').routingStatus, 'in_approval');
    });
  });

  // ─── actOnStep: invalid step rejected ─────────────────────────────────────

  describe('actOnStep — invalid step rejected', () => {
    it('throws INVALID_STEP when stepNumber does not match currentStep', async () => {
      const wf = await createWorkflow('doc-30', 'legal-queue', 3);

      await assert.rejects(
        () => actOnStep(wf.id, 2, 'user-1', 'approved', null),
        (err) => {
          assert.equal(err.code, 'INVALID_STEP');
          return true;
        }
      );
    });

    it('throws INVALID_STATE when workflow is already completed', async () => {
      const wf = await createWorkflow('doc-31', 'legal-queue', 1);
      await actOnStep(wf.id, 1, 'user-1', 'approved', null);

      await assert.rejects(
        () => actOnStep(wf.id, 1, 'user-1', 'approved', null),
        (err) => {
          assert.equal(err.code, 'INVALID_STATE');
          return true;
        }
      );
    });

    it('throws NOT_FOUND for unknown workflowId', async () => {
      await assert.rejects(
        () => actOnStep('nonexistent-id', 1, 'user-1', 'approved', null),
        (err) => {
          assert.equal(err.code, 'NOT_FOUND');
          return true;
        }
      );
    });
  });

  // ─── multi-step full approval flow ────────────────────────────────────────

  describe('multi-step full approval flow', () => {
    it('progresses through all steps and ends approved', async () => {
      const wf = await createWorkflow('doc-40', 'legal-queue', 3);

      let result = await actOnStep(wf.id, 1, 'user-1', 'approved', null);
      assert.equal(result.currentStep, 2);
      assert.equal(result.status, 'pending');

      result = await actOnStep(wf.id, 2, 'user-2', 'approved', null);
      assert.equal(result.currentStep, 3);
      assert.equal(result.status, 'pending');

      result = await actOnStep(wf.id, 3, 'user-3', 'approved', 'All good');
      assert.equal(result.status, 'approved');
      assert.equal(mockDocuments.get('doc-40').routingStatus, 'approved');
    });
  });
});
