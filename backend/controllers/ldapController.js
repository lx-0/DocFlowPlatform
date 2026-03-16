'use strict';

const ldapService = require('../services/ldapService');

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

  try {
    const { email: userEmail, ldapRole } = await ldapService.authenticate(email, password);
    const user = await ldapService.provisionLdapUser(userEmail, ldapRole);
    const token = ldapService.issueJwt(user);
    return res.status(200).json({ token });
  } catch (err) {
    if (err.code === 'INVALID_CREDENTIALS' || err.code === 'USER_NOT_FOUND') {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    return next(err);
  }
}

module.exports = { login };
