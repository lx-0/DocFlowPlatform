'use strict';

const bcrypt = require('bcryptjs');
const prisma = require('../src/db/client');

/**
 * API key authentication middleware.
 * Reads `Authorization: ApiKey <key>` header, validates against stored hash,
 * and attaches the owning user's context to req.user (same shape as JWT middleware).
 */
async function authenticateApiKey(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('ApiKey ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header. Use: ApiKey <key>' });
  }

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey) {
    return res.status(401).json({ error: 'Empty API key' });
  }

  try {
    // Fetch all active (non-revoked) keys for this comparison
    // We use a prefix-based lookup to avoid full-table scans in production —
    // here we rely on bcrypt compare since volume is low.
    const activeKeys = await prisma.apiKey.findMany({
      where: { revokedAt: null },
      include: { user: { select: { id: true, email: true, role: true, roleId: true } } },
    });

    let matched = null;
    for (const apiKey of activeKeys) {
      const ok = await bcrypt.compare(rawKey, apiKey.keyHash);
      if (ok) {
        matched = apiKey;
        break;
      }
    }

    if (!matched) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    // Update lastUsedAt asynchronously — don't block the request
    prisma.apiKey.update({
      where: { id: matched.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {});

    // Attach user context in the same shape as JWT middleware
    req.user = {
      userId: matched.user.id,
      email: matched.user.email,
      role: matched.user.role,
      roleId: matched.user.roleId,
    };
    req.apiKeyId = matched.id;

    next();
  } catch (err) {
    console.error('[apiKeyAuth] Error validating API key:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = { authenticateApiKey };
