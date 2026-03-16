'use strict';

const { randomBytes } = require('crypto');
const ssoService = require('../services/ssoService');
const { logEvent } = require('../services/auditLog');

// ---------------------------------------------------------------------------
// GET /api/auth/sso/login
// ---------------------------------------------------------------------------
async function login(req, res, next) {
  if (!ssoService.isSsoConfigured()) {
    return res.status(501).json({ error: 'SSO is not configured' });
  }

  const provider = ssoService.getSsoProvider();

  if (provider === 'saml') {
    // Lazily register SAML strategy and delegate to passport-saml
    ssoService.ensureSamlStrategyRegistered();
    return ssoService.passport.authenticate('saml', { session: false })(req, res, next);
  }

  if (provider === 'oidc') {
    try {
      const state = randomBytes(16).toString('hex');
      const authUrl = await ssoService.buildOidcAuthUrl(state);
      // Store state in a short-lived cookie so we can verify on callback
      res.cookie('oidc_state', state, { httpOnly: true, maxAge: 5 * 60 * 1000 });
      return res.redirect(authUrl);
    } catch (err) {
      return next(err);
    }
  }

  return res.status(400).json({ error: `Unsupported SSO_PROVIDER: ${provider}` });
}

// ---------------------------------------------------------------------------
// POST /api/auth/sso/callback  (SAML)
// GET  /api/auth/sso/callback  (OIDC)
// ---------------------------------------------------------------------------
async function callback(req, res, next) {
  if (!ssoService.isSsoConfigured()) {
    return res.status(501).json({ error: 'SSO is not configured' });
  }

  const provider = ssoService.getSsoProvider();

  if (provider === 'saml') {
    ssoService.ensureSamlStrategyRegistered();
    return ssoService.passport.authenticate('saml', { session: false }, async (err, user) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ error: 'SAML authentication failed' });

      const token = ssoService.issueJwt(user);
      try {
        logEvent({ actorUserId: user.id, action: 'user.login', targetType: 'user', targetId: user.id, metadata: { method: 'saml' }, ipAddress: req.ip || null });
      } catch {}
      return res.status(200).json({ token });
    })(req, res, next);
  }

  if (provider === 'oidc') {
    try {
      const state = req.cookies && req.cookies.oidc_state;
      const params = req.query;
      const user = await ssoService.handleOidcCallback(params, state);
      const token = ssoService.issueJwt(user);
      res.clearCookie('oidc_state');
      try {
        logEvent({ actorUserId: user.id, action: 'user.login', targetType: 'user', targetId: user.id, metadata: { method: 'oidc' }, ipAddress: req.ip || null });
      } catch {}
      return res.status(200).json({ token });
    } catch (err) {
      return next(err);
    }
  }

  return res.status(400).json({ error: `Unsupported SSO_PROVIDER: ${provider}` });
}

// ---------------------------------------------------------------------------
// GET /api/auth/sso/metadata  (SAML SP metadata XML)
// ---------------------------------------------------------------------------
async function metadata(req, res, next) {
  if (!ssoService.isSsoConfigured()) {
    return res.status(501).json({ error: 'SSO is not configured' });
  }

  const provider = ssoService.getSsoProvider();

  if (provider !== 'saml') {
    return res.status(404).json({ error: 'Metadata endpoint is only available for SAML provider' });
  }

  try {
    const xml = ssoService.getSamlMetadata();
    res.set('Content-Type', 'application/xml');
    return res.send(xml);
  } catch (err) {
    return next(err);
  }
}

module.exports = { login, callback, metadata };
