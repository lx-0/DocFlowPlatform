'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const ldap = require('ldapjs');

// ─── DB mock ─────────────────────────────────────────────────────────────────

const mockUsers = new Map();
const mockRoles = new Map();

const mockPrisma = {
  user: {
    findUnique: async ({ where, include }) => {
      const user = where.id
        ? mockUsers.get(where.id)
        : [...mockUsers.values()].find((u) => u.email === where.email);
      if (!user) return null;
      if (include && include.roleRef) {
        const roleRef = user.roleId ? mockRoles.get(user.roleId) : null;
        return { ...user, roleRef };
      }
      return { ...user };
    },
    create: async ({ data, include }) => {
      const user = { id: `user-${Date.now()}-${Math.random()}`, createdAt: new Date(), ...data };
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
      return [...mockRoles.values()].find((r) => r.name === where.name) || null;
    },
  },
};

// ─── LDAP test server ─────────────────────────────────────────────────────────

const BASE_DN = 'dc=example,dc=com';
const SERVICE_DN = `cn=service,${BASE_DN}`;
const SERVICE_PASS = 'service-secret';

const ALICE_DN = `cn=alice,${BASE_DN}`;
const ALICE_EMAIL = 'alice@example.com';
const ALICE_PASS = 'alice-pass';
const ALICE_GROUP = 'CN=DocAdmins,DC=corp,DC=com';

let testServer;
let serverPort;

before(async () => {
  // Inject DB mock before any service module is loaded
  require.cache[require.resolve('../src/db/client')] = {
    id: require.resolve('../src/db/client'),
    filename: require.resolve('../src/db/client'),
    loaded: true,
    exports: mockPrisma,
  };

  // Seed standard roles
  ['submitter', 'reviewer', 'admin'].forEach((name, i) => {
    const id = `role-${i + 1}`;
    mockRoles.set(id, { id, name, description: null, createdAt: new Date(), updatedAt: new Date() });
  });

  // Spin up in-process LDAP test server
  testServer = ldap.createServer();

  // Handle all bind requests under BASE_DN (including service account and user DNs)
  testServer.bind(BASE_DN, (req, res, next) => {
    const dn = req.dn.toString();
    const creds = req.credentials;

    if (dn === SERVICE_DN) {
      if (creds === SERVICE_PASS) { res.end(); return next(); }
      return next(new ldap.InvalidCredentialsError('service bind failed'));
    }

    if (dn === ALICE_DN) {
      if (creds === ALICE_PASS) { res.end(); return next(); }
      return next(new ldap.InvalidCredentialsError('wrong password'));
    }

    return next(new ldap.InvalidCredentialsError('unknown user'));
  });

  // Handle search requests under BASE_DN
  testServer.search(BASE_DN, (req, res, next) => {
    const filter = req.filter.toString();

    if (filter.includes(ALICE_EMAIL)) {
      res.send({
        dn: ALICE_DN,
        attributes: {
          mail: ALICE_EMAIL,
          memberOf: ALICE_GROUP,
        },
      });
    }
    // Unknown emails produce zero results — user-not-found case

    res.end();
    return next();
  });

  await new Promise((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  serverPort = testServer.address().port;
});

after(async () => {
  // Destroy the pooled LDAP client before shutting down the server
  const ldapSvcPath = require.resolve('../services/ldapService');
  if (require.cache[ldapSvcPath]) {
    require(ldapSvcPath)._resetServiceClient();
    delete require.cache[ldapSvcPath];
  }
  delete require.cache[require.resolve('../src/db/client')];
  delete require.cache[require.resolve('../controllers/ldapController')];
  await new Promise((resolve) => testServer.close(resolve));
});

beforeEach(() => {
  mockUsers.clear();

  // Reset LDAP env vars
  delete process.env.LDAP_URL;
  delete process.env.LDAP_BASE_DN;
  delete process.env.LDAP_BIND_DN;
  delete process.env.LDAP_BIND_PASSWORD;
  delete process.env.LDAP_USER_FILTER;
  delete process.env.LDAP_ROLE_ATTRIBUTE;
  delete process.env.LDAP_ROLE_MAP;

  // Clear cached modules so env changes are picked up
  const ldapSvcPath = require.resolve('../services/ldapService');
  const ldapCtrlPath = require.resolve('../controllers/ldapController');
  if (require.cache[ldapSvcPath]) {
    require(ldapSvcPath)._resetServiceClient();
    delete require.cache[ldapSvcPath];
  }
  delete require.cache[ldapCtrlPath];
});

// ─── Helper: fake res ─────────────────────────────────────────────────────────

function makeRes() {
  const res = {
    _status: 200,
    _body: null,
    status(code) { this._status = code; return this; },
    json(body) { this._body = body; return this; },
  };
  return res;
}

function setLdapEnv(overrides = {}) {
  process.env.LDAP_URL = `ldap://127.0.0.1:${serverPort}`;
  process.env.LDAP_BASE_DN = BASE_DN;
  process.env.LDAP_BIND_DN = SERVICE_DN;
  process.env.LDAP_BIND_PASSWORD = SERVICE_PASS;
  Object.assign(process.env, overrides);
}

// ─── isLdapConfigured ────────────────────────────────────────────────────────

describe('LDAP: isLdapConfigured', () => {
  it('returns false when LDAP_URL is not set', () => {
    const { isLdapConfigured } = require('../services/ldapService');
    assert.equal(isLdapConfigured(), false);
  });

  it('returns true when LDAP_URL is set', () => {
    process.env.LDAP_URL = 'ldap://localhost';
    delete require.cache[require.resolve('../services/ldapService')];
    const { isLdapConfigured } = require('../services/ldapService');
    assert.equal(isLdapConfigured(), true);
  });
});

// ─── authenticate: success ────────────────────────────────────────────────────

describe('LDAP: authenticate — success', () => {
  it('returns email and ldapRole when credentials are correct', async () => {
    setLdapEnv({
      LDAP_ROLE_ATTRIBUTE: 'memberOf',
      LDAP_ROLE_MAP: JSON.stringify({ [ALICE_GROUP]: 'admin' }),
    });
    const { authenticate } = require('../services/ldapService');
    const result = await authenticate(ALICE_EMAIL, ALICE_PASS);
    assert.equal(result.email, ALICE_EMAIL);
    assert.equal(result.ldapRole, 'admin');
  });

  it('returns null ldapRole when LDAP_ROLE_ATTRIBUTE is not set', async () => {
    setLdapEnv();
    const { authenticate } = require('../services/ldapService');
    const result = await authenticate(ALICE_EMAIL, ALICE_PASS);
    assert.equal(result.email, ALICE_EMAIL);
    assert.equal(result.ldapRole, null);
  });
});

// ─── authenticate: wrong password ────────────────────────────────────────────

describe('LDAP: authenticate — wrong password', () => {
  it('throws with code INVALID_CREDENTIALS on wrong password', async () => {
    setLdapEnv();
    const { authenticate } = require('../services/ldapService');
    await assert.rejects(
      () => authenticate(ALICE_EMAIL, 'wrong-password'),
      (err) => {
        assert.equal(err.code, 'INVALID_CREDENTIALS');
        return true;
      }
    );
  });
});

// ─── authenticate: user not found ────────────────────────────────────────────

describe('LDAP: authenticate — user not found', () => {
  it('throws with code USER_NOT_FOUND when email does not exist in LDAP', async () => {
    setLdapEnv();
    const { authenticate } = require('../services/ldapService');
    await assert.rejects(
      () => authenticate('nobody@example.com', 'any-pass'),
      (err) => {
        assert.equal(err.code, 'USER_NOT_FOUND');
        return true;
      }
    );
  });
});

// ─── provisionLdapUser ────────────────────────────────────────────────────────

describe('LDAP: provisionLdapUser', () => {
  it('creates a new user with default submitter role when no ldapRole given', async () => {
    setLdapEnv();
    const { provisionLdapUser } = require('../services/ldapService');
    const user = await provisionLdapUser('newuser@example.com', null);
    assert.equal(user.email, 'newuser@example.com');
    assert.equal(user.role, 'submitter');
  });

  it('creates a new user with the mapped ldapRole when role exists', async () => {
    setLdapEnv();
    const { provisionLdapUser } = require('../services/ldapService');
    const user = await provisionLdapUser('admin@example.com', 'admin');
    assert.equal(user.email, 'admin@example.com');
    assert.equal(user.role, 'admin');
  });
});

// ─── issueJwt ─────────────────────────────────────────────────────────────────

describe('LDAP: issueJwt', () => {
  it('returns a valid JWT with userId, email, and role', async () => {
    process.env.JWT_SECRET = 'test-secret';
    setLdapEnv();
    const { provisionLdapUser, issueJwt } = require('../services/ldapService');
    const user = await provisionLdapUser('jwt@example.com', null);
    const jwtLib = require('jsonwebtoken');
    const token = issueJwt(user);
    const decoded = jwtLib.verify(token, 'test-secret');
    assert.equal(decoded.email, 'jwt@example.com');
    assert.equal(decoded.role, 'submitter');
    assert.ok(decoded.userId);
  });
});

// ─── LDAP controller: POST /ldap/login ───────────────────────────────────────

describe('LDAP controller: /ldap/login', () => {
  it('returns 501 when LDAP is not configured', async () => {
    const ldapController = require('../controllers/ldapController');
    const req = { body: { email: 'a@b.com', password: 'pw' } };
    const res = makeRes();
    await ldapController.login(req, res, (err) => { throw err; });
    assert.equal(res._status, 501);
    assert.equal(res._body.error, 'LDAP is not configured');
  });

  it('returns 400 when email or password is missing', async () => {
    setLdapEnv();
    const ldapController = require('../controllers/ldapController');
    const req = { body: { email: 'a@b.com' } }; // missing password
    const res = makeRes();
    await ldapController.login(req, res, (err) => { throw err; });
    assert.equal(res._status, 400);
    assert.match(res._body.error, /password/);
  });

  it('returns 200 with token on successful LDAP login', async () => {
    process.env.JWT_SECRET = 'test-secret';
    setLdapEnv();
    const ldapController = require('../controllers/ldapController');
    const req = { body: { email: ALICE_EMAIL, password: ALICE_PASS } };
    const res = makeRes();
    await ldapController.login(req, res, (err) => { throw err; });
    assert.equal(res._status, 200);
    assert.ok(res._body.token);
    const jwtLib = require('jsonwebtoken');
    const decoded = jwtLib.verify(res._body.token, 'test-secret');
    assert.equal(decoded.email, ALICE_EMAIL);
  });

  it('returns 401 on wrong password', async () => {
    process.env.JWT_SECRET = 'test-secret';
    setLdapEnv();
    const ldapController = require('../controllers/ldapController');
    const req = { body: { email: ALICE_EMAIL, password: 'wrong' } };
    const res = makeRes();
    await ldapController.login(req, res, (err) => { throw err; });
    assert.equal(res._status, 401);
  });

  it('returns 401 when user not found in LDAP', async () => {
    process.env.JWT_SECRET = 'test-secret';
    setLdapEnv();
    const ldapController = require('../controllers/ldapController');
    const req = { body: { email: 'ghost@example.com', password: 'pw' } };
    const res = makeRes();
    await ldapController.login(req, res, (err) => { throw err; });
    assert.equal(res._status, 401);
  });
});
