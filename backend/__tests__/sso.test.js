'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ─── DB mock ─────────────────────────────────────────────────────────────────

const mockUsers = new Map();
const mockRoles = new Map();

const mockPrisma = {
  user: {
    findUnique: async ({ where, include }) => {
      const user = where.id ? mockUsers.get(where.id) : [...mockUsers.values()].find(u => u.email === where.email);
      if (!user) return null;
      if (include && include.roleRef) {
        const roleRef = user.roleId ? mockRoles.get(user.roleId) : null;
        return { ...user, roleRef };
      }
      return { ...user };
    },
    create: async ({ data, include }) => {
      const user = { id: `user-${Date.now()}`, createdAt: new Date(), ...data };
      mockUsers.set(user.id, user);
      if (include && include.roleRef) {
        const roleRef = user.roleId ? mockRoles.get(user.roleId) : null;
        return { ...user, roleRef };
      }
      return { ...user };
    },
    update: async ({ where, data, include }) => {
      const user = mockUsers.get(where.id);
      if (!user) throw new Error('User not found');
      Object.assign(user, data);
      if (include && include.roleRef) {
        const roleRef = user.roleId ? mockRoles.get(user.roleId) : null;
        return { ...user, roleRef };
      }
      return { ...user };
    },
  },
  role: {
    findUnique: async ({ where }) => {
      return [...mockRoles.values()].find(r => r.name === where.name) || null;
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

  // Seed standard roles
  const roles = ['submitter', 'reviewer', 'admin'];
  roles.forEach((name, i) => {
    const id = `role-${i + 1}`;
    mockRoles.set(id, { id, name, description: null, createdAt: new Date(), updatedAt: new Date() });
  });
});

after(() => {
  delete require.cache[require.resolve('../src/db/client')];
  delete require.cache[require.resolve('../services/ssoService')];
  delete require.cache[require.resolve('../controllers/ssoController')];
});

beforeEach(() => {
  mockUsers.clear();
  // Clear SSO env vars before each test
  delete process.env.SSO_PROVIDER;
  delete process.env.SSO_ENTRY_POINT;
  delete process.env.SSO_ISSUER;
  delete process.env.SSO_CERT;
  delete process.env.SSO_CALLBACK_URL;
  delete process.env.SSO_CLIENT_ID;
  delete process.env.SSO_CLIENT_SECRET;
  delete process.env.SSO_ROLE_CLAIM;
  delete process.env.SAML_SLO_URL;
  delete process.env.OIDC_END_SESSION_URL;
  delete process.env.APP_URL;

  // Clear cached service module so env changes are picked up
  delete require.cache[require.resolve('../services/ssoService')];
  delete require.cache[require.resolve('../controllers/ssoController')];
});

// ─── Helper: fake res/req ─────────────────────────────────────────────────────

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    _headers: {},
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
    send(body) { this._body = body; return this; },
    set(k, v) { this._headers[k] = v; return this; },
    redirect(url) { this._redirectUrl = url; return this; },
    cookie() { return this; },
    clearCookie() { return this; },
  };
  return res;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SSO: isSsoConfigured', () => {
  it('returns false when SSO_PROVIDER is not set', () => {
    const { isSsoConfigured } = require('../services/ssoService');
    assert.equal(isSsoConfigured(), false);
  });

  it('returns true when SSO_PROVIDER is set', () => {
    process.env.SSO_PROVIDER = 'saml';
    delete require.cache[require.resolve('../services/ssoService')];
    const { isSsoConfigured } = require('../services/ssoService');
    assert.equal(isSsoConfigured(), true);
  });
});

describe('SSO: provisionUser', () => {
  it('creates a new user with default submitter role when no SSO role provided', async () => {
    const { provisionUser } = require('../services/ssoService');
    const user = await provisionUser('newuser@example.com', null);
    assert.equal(user.email, 'newuser@example.com');
    assert.equal(user.role, 'submitter');
  });

  it('creates a new user with the provided SSO role when role exists', async () => {
    const { provisionUser } = require('../services/ssoService');
    const user = await provisionUser('reviewer@example.com', 'reviewer');
    assert.equal(user.email, 'reviewer@example.com');
    assert.equal(user.role, 'reviewer');
  });

  it('returns existing user without role change when no SSO role provided', async () => {
    // Pre-create user
    const existing = await mockPrisma.user.create({ data: { email: 'existing@example.com', passwordHash: '', role: 'admin', roleId: 'role-3' } });
    const { provisionUser } = require('../services/ssoService');
    const user = await provisionUser('existing@example.com', null);
    assert.equal(user.id, existing.id);
    assert.equal(user.role, 'admin');
  });

  it('updates role of existing user when SSO role claim differs', async () => {
    const submitterRole = [...mockRoles.values()].find(r => r.name === 'submitter');
    await mockPrisma.user.create({ data: { email: 'promote@example.com', passwordHash: '', role: 'submitter', roleId: submitterRole.id } });
    const { provisionUser } = require('../services/ssoService');
    const user = await provisionUser('promote@example.com', 'reviewer');
    assert.equal(user.role, 'reviewer');
  });
});

describe('SSO: issueJwt', () => {
  it('returns a valid JWT containing userId, email, and role', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const { provisionUser, issueJwt } = require('../services/ssoService');
    const user = await provisionUser('jwt@example.com', null);
    const jwt = require('jsonwebtoken');
    const token = issueJwt(user);
    const decoded = jwt.verify(token, 'test-secret');
    assert.equal(decoded.email, 'jwt@example.com');
    assert.equal(decoded.role, 'submitter');
    assert.ok(decoded.userId);
  });
});

describe('SSO controller: /sso/login', () => {
  it('returns 501 when SSO is not configured', async () => {
    const ssoController = require('../controllers/ssoController');
    const req = { method: 'GET' };
    const res = makeRes();
    await ssoController.login(req, res, (err) => { throw err; });
    assert.equal(res._status, 501);
    assert.equal(res._body.error, 'SSO is not configured');
  });

  it('returns 400 for an unknown provider', async () => {
    process.env.SSO_PROVIDER = 'unknown';
    delete require.cache[require.resolve('../services/ssoService')];
    delete require.cache[require.resolve('../controllers/ssoController')];
    const ssoController = require('../controllers/ssoController');
    const req = { method: 'GET' };
    const res = makeRes();
    await ssoController.login(req, res, (err) => { throw err; });
    assert.equal(res._status, 400);
  });
});

describe('SSO controller: /sso/callback', () => {
  it('returns 501 when SSO is not configured', async () => {
    const ssoController = require('../controllers/ssoController');
    const req = { method: 'POST', body: {} };
    const res = makeRes();
    await ssoController.callback(req, res, (err) => { throw err; });
    assert.equal(res._status, 501);
    assert.equal(res._body.error, 'SSO is not configured');
  });
});

describe('SSO controller: /sso/metadata', () => {
  it('returns 501 when SSO is not configured', async () => {
    const ssoController = require('../controllers/ssoController');
    const req = { method: 'GET' };
    const res = makeRes();
    await ssoController.metadata(req, res, (err) => { throw err; });
    assert.equal(res._status, 501);
    assert.equal(res._body.error, 'SSO is not configured');
  });

  it('returns 404 for metadata endpoint when provider is OIDC', async () => {
    process.env.SSO_PROVIDER = 'oidc';
    process.env.SSO_ISSUER = 'https://accounts.example.com';
    process.env.SSO_CLIENT_ID = 'client-id';
    process.env.SSO_CLIENT_SECRET = 'client-secret';
    process.env.SSO_CALLBACK_URL = 'https://app.example.com/api/auth/sso/callback';
    delete require.cache[require.resolve('../services/ssoService')];
    delete require.cache[require.resolve('../controllers/ssoController')];
    const ssoController = require('../controllers/ssoController');
    const req = { method: 'GET' };
    const res = makeRes();
    await ssoController.metadata(req, res, (err) => { throw err; });
    assert.equal(res._status, 404);
  });
});

describe('SSO: getSsoProvider', () => {
  it('returns lowercased provider value', () => {
    process.env.SSO_PROVIDER = 'SAML';
    delete require.cache[require.resolve('../services/ssoService')];
    const { getSsoProvider } = require('../services/ssoService');
    assert.equal(getSsoProvider(), 'saml');
  });
});

describe('SSO: issueJwt with extraClaims', () => {
  it('embeds extra claims in the JWT', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const { provisionUser, issueJwt } = require('../services/ssoService');
    const user = await provisionUser('samluser@example.com', null);
    const jwtLib = require('jsonwebtoken');
    const token = issueJwt(user, { samlNameId: 'samluser@example.com', samlSessionIndex: 'sess-1' });
    const decoded = jwtLib.verify(token, 'test-secret');
    assert.equal(decoded.samlNameId, 'samluser@example.com');
    assert.equal(decoded.samlSessionIndex, 'sess-1');
  });

  it('works without extraClaims (backward compat)', async () => {
    process.env.JWT_SECRET = 'test-secret';
    const { provisionUser, issueJwt } = require('../services/ssoService');
    const user = await provisionUser('plain@example.com', null);
    const jwtLib = require('jsonwebtoken');
    const token = issueJwt(user);
    const decoded = jwtLib.verify(token, 'test-secret');
    assert.equal(decoded.email, 'plain@example.com');
    assert.ok(!decoded.samlNameId);
  });
});

describe('SSO: buildSamlSloRedirectUrl', () => {
  it('returns null when SAML_SLO_URL is not set', async () => {
    delete process.env.SAML_SLO_URL;
    const { buildSamlSloRedirectUrl } = require('../services/ssoService');
    const url = await buildSamlSloRedirectUrl('user@example.com', null);
    assert.equal(url, null);
  });
});

describe('SSO: buildOidcEndSessionUrl', () => {
  it('returns null when no end_session URL is available', async () => {
    delete process.env.OIDC_END_SESSION_URL;
    const { buildOidcEndSessionUrl } = require('../services/ssoService');
    const url = await buildOidcEndSessionUrl(null, null);
    assert.equal(url, null);
  });

  it('uses OIDC_END_SESSION_URL env override with id_token_hint and post_logout_redirect_uri', async () => {
    process.env.OIDC_END_SESSION_URL = 'https://idp.example.com/endsession';
    delete require.cache[require.resolve('../services/ssoService')];
    const { buildOidcEndSessionUrl } = require('../services/ssoService');
    const url = await buildOidcEndSessionUrl('my-id-token', 'https://app.example.com/login');
    assert.ok(url.startsWith('https://idp.example.com/endsession'));
    assert.ok(url.includes('id_token_hint=my-id-token'));
    assert.ok(url.includes('post_logout_redirect_uri='));
    delete process.env.OIDC_END_SESSION_URL;
  });

  it('omits id_token_hint when idToken is null', async () => {
    process.env.OIDC_END_SESSION_URL = 'https://idp.example.com/endsession';
    delete require.cache[require.resolve('../services/ssoService')];
    const { buildOidcEndSessionUrl } = require('../services/ssoService');
    const url = await buildOidcEndSessionUrl(null, 'https://app.example.com/login');
    assert.ok(!url.includes('id_token_hint'));
    delete process.env.OIDC_END_SESSION_URL;
  });
});

describe('SSO controller: /sso/logout', () => {
  it('returns 501 when SSO is not configured', async () => {
    const ssoController = require('../controllers/ssoController');
    const req = { method: 'GET', headers: {}, cookies: {} };
    const res = makeRes();
    await ssoController.logout(req, res, (err) => { throw err; });
    assert.equal(res._status, 501);
    assert.equal(res._body.error, 'SSO is not configured');
  });

  it('returns fallback redirectUrl when SAML SLO is not configured', async () => {
    process.env.SSO_PROVIDER = 'saml';
    delete process.env.SAML_SLO_URL;
    delete require.cache[require.resolve('../services/ssoService')];
    delete require.cache[require.resolve('../controllers/ssoController')];
    const ssoController = require('../controllers/ssoController');
    const req = { method: 'GET', headers: {}, cookies: {} };
    const res = makeRes();
    await ssoController.logout(req, res, (err) => { throw err; });
    assert.equal(res._status, 200);
    assert.ok(res._body.redirectUrl);
    assert.ok(res._body.redirectUrl.endsWith('/login'));
  });

  it('returns OIDC end_session URL with id_token_hint from cookie', async () => {
    process.env.SSO_PROVIDER = 'oidc';
    process.env.OIDC_END_SESSION_URL = 'https://idp.example.com/endsession';
    delete require.cache[require.resolve('../services/ssoService')];
    delete require.cache[require.resolve('../controllers/ssoController')];
    const ssoController = require('../controllers/ssoController');
    const req = { method: 'GET', headers: {}, cookies: { oidc_id_token: 'test-id-token' }, ip: '127.0.0.1' };
    const res = makeRes();
    await ssoController.logout(req, res, (err) => { throw err; });
    assert.equal(res._status, 200);
    assert.ok(res._body.redirectUrl.includes('id_token_hint=test-id-token'));
    delete process.env.OIDC_END_SESSION_URL;
  });

  it('returns fallback /login when OIDC has no end_session endpoint', async () => {
    process.env.SSO_PROVIDER = 'oidc';
    delete process.env.OIDC_END_SESSION_URL;
    delete require.cache[require.resolve('../services/ssoService')];
    delete require.cache[require.resolve('../controllers/ssoController')];
    const ssoController = require('../controllers/ssoController');
    const req = { method: 'GET', headers: {}, cookies: {}, ip: '127.0.0.1' };
    const res = makeRes();
    await ssoController.logout(req, res, (err) => { throw err; });
    assert.equal(res._status, 200);
    assert.ok(res._body.redirectUrl.endsWith('/login'));
  });
});
