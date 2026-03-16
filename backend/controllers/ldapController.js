'use strict';

const ldapService = require('../services/ldapService');
const { logEvent } = require('../services/auditLog');

// ---------------------------------------------------------------------------
// POST /api/auth/ldap/login
// ---------------------------------------------------------------------------
async function login(req, res, next) {
  if (!ldapService.isLdapConfigured()) {
    return res.status(501).json({ error: 'LDAP is not configured' });
  }

  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  const ipAddress = req.ip || null;

  try {
    const { email: userEmail, ldapRole } = await ldapService.authenticate(email, password);
    const user = await ldapService.provisionLdapUser(userEmail, ldapRole);
    const token = ldapService.issueJwt(user);
    try {
      logEvent({ actorUserId: user.id, action: 'user.login', targetType: 'user', targetId: user.id, metadata: { method: 'ldap' }, ipAddress });
    } catch {}
    return res.status(200).json({ token });
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS' || err.code === 'USER_NOT_FOUND') {
      try {
        logEvent({ action: 'user.login_failed', targetType: 'user', targetId: email, metadata: { email, method: 'ldap', reason: err.code.toLowerCase() }, ipAddress });
      } catch {}
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    return next(err);
  }
}

module.exports = { login };
