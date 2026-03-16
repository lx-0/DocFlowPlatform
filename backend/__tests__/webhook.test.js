'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const deliveryLog = [];

const mockPrisma = {
  webhookDelivery: {
    create: async (args) => {
      deliveryLog.push(args.data);
      return args.data;
    },
  },
  webhook: {
    findMany: async () => [],
  },
};

function installPrismaMock() {
  const key = require.resolve('../src/db/client');
  require.cache[key] = {
    id: key,
    filename: key,
    loaded: true,
    exports: mockPrisma,
  };
}

function removePrismaMock() {
  delete require.cache[require.resolve('../src/db/client')];
  delete require.cache[require.resolve('../services/webhook')];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WebhookService', () => {
  before(() => {
    installPrismaMock();
  });

  after(() => {
    removePrismaMock();
    delete globalThis.fetch;
  });

  // ─── sign() ────────────────────────────────────────────────────────────────

  describe('sign', () => {
    let sign;

    before(() => {
      sign = require('../services/webhook').sign;
    });

    it('returns a string prefixed with "sha256="', () => {
      const result = sign('mysecret', 'hello');
      assert.ok(result.startsWith('sha256='), 'should start with sha256=');
    });

    it('produces the expected HMAC-SHA256 hex digest', () => {
      const secret = 'test-secret-key';
      const payload = '{"event":"document.approved"}';
      const expected =
        'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
      assert.equal(sign(secret, payload), expected);
    });

    it('is deterministic for identical inputs', () => {
      assert.equal(sign('s', 'p'), sign('s', 'p'));
    });

    it('produces different signatures for different secrets', () => {
      assert.notEqual(sign('secret-a', 'payload'), sign('secret-b', 'payload'));
    });

    it('produces different signatures for different payloads', () => {
      assert.notEqual(sign('secret', 'payload-1'), sign('secret', 'payload-2'));
    });
  });

  // ─── isUrlAllowed() ────────────────────────────────────────────────────────

  describe('isUrlAllowed', () => {
    afterEach(() => {
      delete require.cache[require.resolve('../services/webhook')];
    });

    it('allows https:// URLs in any environment', () => {
      const { isUrlAllowed } = require('../services/webhook');
      assert.ok(isUrlAllowed('https://example.com/webhook'));
    });

    it('allows http:// URLs when NODE_ENV is not production', () => {
      const saved = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';
      const { isUrlAllowed } = require('../services/webhook');
      assert.ok(isUrlAllowed('http://localhost:4000/hook'));
      process.env.NODE_ENV = saved;
    });

    it('rejects http:// URLs when NODE_ENV=production', () => {
      const saved = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const { isUrlAllowed } = require('../services/webhook');
      assert.ok(!isUrlAllowed('http://example.com/hook'), 'http must be rejected in production');
      process.env.NODE_ENV = saved;
    });

    it('rejects malformed URLs', () => {
      const { isUrlAllowed } = require('../services/webhook');
      assert.ok(!isUrlAllowed('not-a-url'));
      assert.ok(!isUrlAllowed(''));
      assert.ok(!isUrlAllowed('ftp://example.com'));
    });
  });

  // ─── deliverToWebhook() — retry logic ─────────────────────────────────────

  describe('deliverToWebhook retry logic', () => {
    beforeEach(() => {
      deliveryLog.length = 0;
      delete require.cache[require.resolve('../services/webhook')];
    });

    afterEach(() => {
      delete globalThis.fetch;
      delete require.cache[require.resolve('../services/webhook')];
    });

    it('delivers on the first attempt and records attemptCount=1', async () => {
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls++;
        return { status: 200 };
      };

      const { deliverToWebhook } = require('../services/webhook');
      await deliverToWebhook(
        { id: 'wh-1', url: 'https://example.com/hook' },
        'document.approved',
        '{}',
        'sha256=sig'
      );

      assert.equal(fetchCalls, 1, 'should only call fetch once on success');
      assert.equal(deliveryLog.length, 1);
      assert.equal(deliveryLog[0].attemptCount, 1);
      assert.ok(deliveryLog[0].deliveredAt instanceof Date, 'deliveredAt should be set on success');
    });

    it('retries on 5xx and records all MAX_RETRIES attempts', async () => {
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls++;
        return { status: 500 };
      };

      const { deliverToWebhook } = require('../services/webhook');
      await deliverToWebhook(
        { id: 'wh-2', url: 'https://example.com/hook' },
        'document.rejected',
        '{}',
        'sha256=sig'
      );

      assert.equal(fetchCalls, 3, 'should retry up to MAX_RETRIES=3 times');
      assert.equal(deliveryLog.length, 1);
      assert.equal(deliveryLog[0].attemptCount, 3);
      assert.equal(deliveryLog[0].deliveredAt, null, 'deliveredAt should be null on failure');
    });

    it('stops retrying after first success even if earlier attempts failed', async () => {
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls++;
        // Fail on first attempt, succeed on second
        return { status: fetchCalls === 1 ? 503 : 200 };
      };

      const { deliverToWebhook } = require('../services/webhook');
      await deliverToWebhook(
        { id: 'wh-3', url: 'https://example.com/hook' },
        'document.submitted',
        '{}',
        'sha256=sig'
      );

      assert.equal(fetchCalls, 2, 'should stop after first successful response');
      assert.equal(deliveryLog[0].attemptCount, 2);
      assert.ok(deliveryLog[0].deliveredAt instanceof Date);
    });

    it('handles network errors (fetch throws) and retries', async () => {
      let fetchCalls = 0;
      globalThis.fetch = async () => {
        fetchCalls++;
        throw new Error('ECONNREFUSED');
      };

      const { deliverToWebhook } = require('../services/webhook');
      await deliverToWebhook(
        { id: 'wh-4', url: 'https://example.com/hook' },
        'document.approved',
        '{}',
        'sha256=sig'
      );

      assert.equal(fetchCalls, 3, 'should retry on network errors');
      assert.equal(deliveryLog[0].attemptCount, 3);
      assert.equal(deliveryLog[0].statusCode, null, 'statusCode should be null on network error');
    });

    it('records the correct webhook event name in the delivery log', async () => {
      globalThis.fetch = async () => ({ status: 200 });

      const { deliverToWebhook } = require('../services/webhook');
      await deliverToWebhook(
        { id: 'wh-5', url: 'https://example.com/hook' },
        'document.escalated',
        '{}',
        'sha256=sig'
      );

      assert.equal(deliveryLog[0].event, 'document.escalated');
      assert.equal(deliveryLog[0].webhookId, 'wh-5');
    });
  });
});
