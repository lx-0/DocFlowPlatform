'use strict';

/**
 * SSO Service — supports SAML 2.0 and OIDC.
 *
 * Configuration via environment variables:
 *   SSO_PROVIDER           — 'saml' | 'oidc'  (required to enable SSO)
 *   SSO_ENTRY_POINT        — IdP SSO URL (SAML) / authorization endpoint (OIDC)
 *   SSO_ISSUER             — SP entity ID (SAML) / OIDC issuer URL
 *   SSO_CERT               — IdP public certificate PEM (SAML)
 *   SSO_CLIENT_ID          — OIDC client ID
 *   SSO_CLIENT_SECRET      — OIDC client secret
 *   SSO_CALLBACK_URL       — ACS URL (SAML) / redirect URI (OIDC)
 *   SSO_ROLE_CLAIM         — claim name in IdP assertion that carries the role
 *   SAML_SLO_URL           — SAML IdP Single Logout endpoint (optional; enables SLO)
 *   OIDC_END_SESSION_URL   — OIDC end_session_endpoint override (optional; auto-discovered otherwise)
 *   APP_URL                — Base URL of DocFlow (e.g. https://docflow.corp.com); used for post-logout redirect
 */

const passport = require('passport');
const { Strategy: SamlStrategy } = require('@node-saml/passport-saml');
const { Issuer } = require('openid-client');
const jwt = require('jsonwebtoken');
const prisma = require('../src/db/client');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSsoConfigured() {
  return !!process.env.SSO_PROVIDER;
}

function getSsoProvider() {
  return (process.env.SSO_PROVIDER || '').toLowerCase();
}

/**
 * Provision or retrieve a user from the DB based on SSO profile data.
 * Returns the user record with resolved role name.
 */
async function provisionUser(email, ssoRole) {
  let user = await prisma.user.findUnique({ where: { email }, include: { roleRef: true } });

  if (!user) {
    // Determine role: use mapped SSO role if present, otherwise default to 'submitter'
    const roleName = ssoRole || 'submitter';
    const roleRecord = await prisma.role.findUnique({ where: { name: roleName } });
    const roleId = roleRecord ? roleRecord.id : null;

    user = await prisma.user.create({
      data: { email, passwordHash: '', role: roleName, roleId },
      include: { roleRef: true },
    });
  } else if (ssoRole) {
    // Update role if SSO claim provides a new one
    const roleRecord = await prisma.role.findUnique({ where: { name: ssoRole } });
    if (roleRecord && user.roleId !== roleRecord.id) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: ssoRole, roleId: roleRecord.id },
        include: { roleRef: true },
      });
    }
  }

  return user;
}

/**
 * Issue a JWT for a provisioned user.
 * @param {object} user - Provisioned user record.
 * @param {object} [extraClaims={}] - Additional claims to embed (e.g. samlNameId, samlSessionIndex).
 */
function issueJwt(user, extraClaims = {}) {
  const roleName = user.roleRef ? user.roleRef.name : user.role;
  const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
  return jwt.sign(
    { userId: user.id, email: user.email, role: roleName, ...extraClaims },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

// ---------------------------------------------------------------------------
// SAML 2.0
// ---------------------------------------------------------------------------

function buildSamlStrategy() {
  const samlConfig = {
    entryPoint: process.env.SSO_ENTRY_POINT,
    issuer: process.env.SSO_ISSUER,
    cert: process.env.SSO_CERT,
    callbackUrl: process.env.SSO_CALLBACK_URL,
    logoutUrl: process.env.SAML_SLO_URL || undefined,
    wantAssertionsSigned: true,
  };

  return new SamlStrategy(samlConfig, async (profile, done) => {
    try {
      const email = profile.email || profile.nameID;
      if (!email) return done(new Error('No email in SAML assertion'));

      const roleClaimKey = process.env.SSO_ROLE_CLAIM;
      const ssoRole = roleClaimKey ? profile[roleClaimKey] : null;

      const user = await provisionUser(email, ssoRole);
      // Attach SAML session info for SLO use — the controller embeds these in the DocFlow JWT
      user._samlNameId = profile.nameID || email;
      user._samlSessionIndex = profile.sessionIndex || null;
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  });
}

/**
 * Build a SAML SP-initiated Single Logout redirect URL.
 * Returns null if SAML_SLO_URL is not configured.
 *
 * @param {string} nameId - The user's SAML NameID (usually email).
 * @param {string|null} sessionIndex - The SAML session index from the login assertion.
 * @returns {Promise<string|null>}
 */
async function buildSamlSloRedirectUrl(nameId, sessionIndex) {
  const sloUrl = process.env.SAML_SLO_URL;
  if (!sloUrl) return null;

  try {
    const strategy = buildSamlStrategy();
    const fakeReq = {
      user: {
        nameID: nameId,
        nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:emailAddress',
        sessionIndex: sessionIndex || undefined,
      },
    };
    return await new Promise((resolve, reject) => {
      strategy.logout(fakeReq, (err, url) => {
        if (err) reject(err);
        else resolve(url);
      });
    });
  } catch {
    // Fallback: return the raw SLO URL if passport-saml can't build a signed request
    return sloUrl;
  }
}

/**
 * Returns the SAML SP metadata XML.
 */
function getSamlMetadata() {
  const strategy = buildSamlStrategy();
  return strategy.generateServiceProviderMetadata(null, null);
}

// ---------------------------------------------------------------------------
// OIDC
// ---------------------------------------------------------------------------

let _oidcClient = null;

async function getOidcClient() {
  if (_oidcClient) return _oidcClient;

  const issuerUrl = process.env.SSO_ISSUER;
  const issuer = await Issuer.discover(issuerUrl);
  _oidcClient = new issuer.Client({
    client_id: process.env.SSO_CLIENT_ID,
    client_secret: process.env.SSO_CLIENT_SECRET,
    redirect_uris: [process.env.SSO_CALLBACK_URL],
    response_types: ['code'],
  });
  return _oidcClient;
}

async function buildOidcAuthUrl(state) {
  const client = await getOidcClient();
  return client.authorizationUrl({ scope: 'openid email profile', state });
}

/**
 * Handle OIDC authorization-code callback.
 * Returns the provisioned user and the raw id_token (for SLO use).
 *
 * @returns {Promise<{ user: object, idToken: string|null }>}
 */
async function handleOidcCallback(params, state) {
  const client = await getOidcClient();
  const tokenSet = await client.oauthCallback(process.env.SSO_CALLBACK_URL, params, { state });
  const userinfo = await client.userinfo(tokenSet.access_token);

  const email = userinfo.email;
  if (!email) throw new Error('No email in OIDC userinfo');

  const roleClaimKey = process.env.SSO_ROLE_CLAIM;
  const ssoRole = roleClaimKey ? userinfo[roleClaimKey] : null;

  const user = await provisionUser(email, ssoRole);
  return { user, idToken: tokenSet.id_token || null };
}

/**
 * Build an OIDC end_session URL for SP-initiated logout.
 * Uses OIDC_END_SESSION_URL env override or auto-discovers from OIDC metadata.
 * Returns null if no end_session_endpoint is available.
 *
 * @param {string|null} idToken - The id_token issued at login (used as id_token_hint).
 * @param {string|null} postLogoutRedirectUri - Where to redirect after IdP logout.
 * @returns {Promise<string|null>}
 */
async function buildOidcEndSessionUrl(idToken, postLogoutRedirectUri) {
  let baseUrl = process.env.OIDC_END_SESSION_URL || null;

  if (!baseUrl) {
    try {
      const client = await getOidcClient();
      baseUrl = client.issuer.end_session_endpoint || null;
    } catch {
      return null;
    }
  }

  if (!baseUrl) return null;

  const url = new URL(baseUrl);
  if (idToken) url.searchParams.set('id_token_hint', idToken);
  if (postLogoutRedirectUri) url.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
  return url.toString();
}

// ---------------------------------------------------------------------------
// Passport setup (used for SAML)
// ---------------------------------------------------------------------------

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await prisma.user.findUnique({ where: { id }, include: { roleRef: true } });
    done(null, user);
  } catch (err) {
    done(err);
  }
});

/**
 * Lazily register the SAML strategy with passport on first use.
 * This avoids errors at require-time when SSO env vars are partially set.
 */
let _samlStrategyRegistered = false;
function ensureSamlStrategyRegistered() {
  if (!_samlStrategyRegistered) {
    passport.use('saml', buildSamlStrategy());
    _samlStrategyRegistered = true;
  }
}

module.exports = {
  isSsoConfigured,
  getSsoProvider,
  provisionUser,
  issueJwt,
  getSamlMetadata,
  buildSamlStrategy,
  ensureSamlStrategyRegistered,
  buildSamlSloRedirectUrl,
  buildOidcAuthUrl,
  handleOidcCallback,
  buildOidcEndSessionUrl,
  passport,
};
