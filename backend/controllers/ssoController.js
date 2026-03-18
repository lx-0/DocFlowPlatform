'use strict';

const { randomBytes } = require('crypto');
const jwt = require('jsonwebtoken');
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

      const extraClaims = {};
      if (user._samlNameId) extraClaims.samlNameId = user._samlNameId;
      if (user._samlSessionIndex) extraClaims.samlSessionIndex = user._samlSessionIndex;

      const token = ssoService.issueJwt(user, extraClaims);
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
      const { user, idToken } = await ssoService.handleOidcCallback(params, state);
      const token = ssoService.issueJwt(user);
      res.clearCookie('oidc_state');
      // Store id_token in an httpOnly cookie so it can be used as id_token_hint on logout
      if (idToken) {
        res.cookie('oidc_id_token', idToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
      }
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

// ---------------------------------------------------------------------------
// GET /api/auth/sso/logout
//
// Initiates SP-initiated Single Logout (SLO):
//   - SAML: builds a signed LogoutRequest redirect to the IdP SLO endpoint.
//   - OIDC: redirects to the IdP end_session_endpoint with id_token_hint.
//   - Fallback (no SLO configured): returns { redirectUrl: '/login' } so the
//     client can perform a local-only logout (current pre-SLO behaviour).
//
// The client is expected to:
//   1. Clear its local session (localStorage token, etc.).
//   2. Navigate to the returned redirectUrl.
// ---------------------------------------------------------------------------
async function logout(req, res, next) {
  if (!ssoService.isSsoConfigured()) {
    return res.status(501).json({ error: 'SSO is not configured' });
  }

  const provider = ssoService.getSsoProvider();
  const appLoginUrl = process.env.APP_URL ? `${process.env.APP_URL}/login` : '/login';

  if (provider === 'saml') {
    if (!process.env.SAML_SLO_URL) {
      // SLO not configured — fall back to local logout
      return res.json({ redirectUrl: appLoginUrl });
    }

    // Extract SAML session info from the DocFlow JWT so we can build the SLO request
    let nameId, sessionIndex;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
        nameId = decoded.samlNameId || decoded.email;
        sessionIndex = decoded.samlSessionIndex || null;
      } catch {
        // Invalid token — still allow logout, just without session hints
      }
    }

    try {
      const sloUrl = await ssoService.buildSamlSloRedirectUrl(nameId, sessionIndex);
      try {
        logEvent({ action: 'user.logout', targetType: 'user', targetId: nameId || 'unknown', metadata: { method: 'saml_slo' }, ipAddress: req.ip || null });
      } catch {}
      return res.json({ redirectUrl: sloUrl || appLoginUrl });
    } catch (err) {
      return next(err);
    }
  }

  if (provider === 'oidc') {
    const idToken = req.cookies && req.cookies.oidc_id_token;
    const postLogoutRedirectUri = process.env.APP_URL ? `${process.env.APP_URL}/login` : null;

    try {
      const endSessionUrl = await ssoService.buildOidcEndSessionUrl(idToken, postLogoutRedirectUri);
      // Clear the stored id_token cookie
      res.clearCookie('oidc_id_token');
      try {
        logEvent({ action: 'user.logout', targetType: 'session', targetId: 'oidc', metadata: { method: 'oidc_end_session' }, ipAddress: req.ip || null });
      } catch {}
      return res.json({ redirectUrl: endSessionUrl || appLoginUrl });
    } catch (err) {
      return next(err);
    }
  }

  return res.json({ redirectUrl: appLoginUrl });
}

module.exports = { login, callback, metadata, logout };
