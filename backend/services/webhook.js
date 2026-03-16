'use strict';

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const prisma = require('../src/db/client');

const MAX_RETRIES = 3;
// Delays in ms before each attempt (attempt 0 = immediate, 1 = 1s, 2 = 2s)
const RETRY_DELAYS_MS = [0, 1000, 2000];

/**
 * Signs a payload string with HMAC-SHA256 using the webhook secret.
 * Returns a string in the format `sha256=<hex>`.
 *
 * @param {string} secret
 * @param {string} payload
 * @returns {string}
 */
function sign(secret, payload) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Returns true if the URL is permitted as a webhook target.
 * In production (NODE_ENV=production), only HTTPS URLs are allowed.
 * HTTP is also accepted in dev/test environments.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isUrlAllowed(url) {
  try {
    const parsed = new URL(url);
    if (process.env.NODE_ENV === 'production') {
      return parsed.protocol === 'https:';
    }
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Performs a single HTTP POST to the webhook URL.
 *
 * @param {string} url
 * @param {string} payloadStr - JSON-serialised payload
 * @param {string} signature - X-DocFlow-Signature header value
 * @returns {Promise<number>} HTTP status code
 */
async function postOnce(url, payloadStr, signature) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-DocFlow-Signature': signature,
    },
    body: payloadStr,
    signal: AbortSignal.timeout(10_000),
  });
  return response.status;
}

/**
 * Delivers an event payload to a single webhook endpoint with up to
 * MAX_RETRIES attempts and exponential back-off. Logs each delivery
 * attempt to the `webhook_deliveries` table.
 *
 * @param {{ id: string, url: string }} webhook
 * @param {string} event
 * @param {string} payloadStr
 * @param {string} signature
 */
async function deliverToWebhook(webhook, event, payloadStr, signature) {
  let statusCode = null;
  let attemptCount = 0;
  let deliveredAt = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }

    attemptCount = attempt + 1;
    try {
      statusCode = await postOnce(webhook.url, payloadStr, signature);
      if (statusCode >= 200 && statusCode < 300) {
        deliveredAt = new Date();
        break;
      }
    } catch (err) {
      // Network-level failure — treat as transient and keep retrying
      statusCode = null;
      console.error(
        `[WebhookService] Delivery attempt ${attemptCount} failed for webhook ${webhook.id}: ${err.message}`
      );
    }
  }

  try {
    await prisma.webhookDelivery.create({
      data: {
        id: uuidv4(),
        webhookId: webhook.id,
        event,
        statusCode,
        attemptCount,
        deliveredAt,
      },
    });
  } catch (err) {
    console.error(`[WebhookService] Failed to log delivery for webhook ${webhook.id}: ${err.message}`);
  }
}

/**
 * Dispatches a document lifecycle event to all active webhooks belonging to
 * the given user that subscribe to the event. Runs asynchronously via
 * setImmediate so the calling request handler is never blocked.
 *
 * @param {string} userId - The document owner's user ID
 * @param {string} event  - e.g. 'document.submitted', 'document.approved'
 * @param {object} document - Document object (matches public API response shape)
 */
function deliverEvent(userId, event, document) {
  setImmediate(async () => {
    try {
      const webhooks = await prisma.webhook.findMany({
        where: { userId, active: true, events: { has: event } },
      });

      if (webhooks.length === 0) return;

      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data: { document },
      };
      const payloadStr = JSON.stringify(payload);

      await Promise.all(
        webhooks
          .filter((wh) => isUrlAllowed(wh.url))
          .map((wh) => deliverToWebhook(wh, event, payloadStr, sign(wh.secret, payloadStr)))
      );
    } catch (err) {
      console.error(`[WebhookService] deliverEvent error (${event}): ${err.message}`);
    }
  });
}

module.exports = { deliverEvent, sign, isUrlAllowed, deliverToWebhook };
