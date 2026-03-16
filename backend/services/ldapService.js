'use strict';

/**
 * LDAP Service — supports Active Directory and OpenLDAP authentication.
 *
 * Configuration via environment variables:
 *   LDAP_URL            — LDAP server URL (e.g. ldap://ad.corp.com)
 *   LDAP_BASE_DN        — Base DN for user search (e.g. DC=corp,DC=com)
 *   LDAP_BIND_DN        — Service account DN for initial bind
 *   LDAP_BIND_PASSWORD  — Service account password
 *   LDAP_USER_FILTER    — Search filter template (default: (mail={email}))
 *   LDAP_ROLE_ATTRIBUTE — LDAP attribute carrying group/role (e.g. memberOf)
 *   LDAP_ROLE_MAP       — JSON mapping LDAP group DN to DocFlow role name
 *                         e.g. '{"CN=DocAdmins,DC=corp,DC=com":"admin"}'
 */

const ldap = require('ldapjs');
const jwt = require('jsonwebtoken');
const prisma = require('../src/db/client');

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function isLdapConfigured() {
  return !!process.env.LDAP_URL;
}

function getLdapRoleMap() {
  try {
    return JSON.parse(process.env.LDAP_ROLE_MAP || '{}');
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Connection pool — reuse one service-account client, recreate on error
// ---------------------------------------------------------------------------

let _serviceClient = null;

function _buildServiceClient() {
  const client = ldap.createClient({ url: process.env.LDAP_URL });
  client.on('error', () => {
    _serviceClient = null;
  });
  return client;
}

function getServiceClient() {
  if (!_serviceClient) {
    _serviceClient = _buildServiceClient();
  }
  return _serviceClient;
}

// Exposed so tests can reset the singleton when swapping LDAP_URL
function _resetServiceClient() {
  if (_serviceClient) {
    try { _serviceClient.destroy(); } catch (_) {}
  }
  _serviceClient = null;
}

// ---------------------------------------------------------------------------
// Promise wrappers for ldapjs callbacks
// ---------------------------------------------------------------------------

function bindAsync(client, dn, password) {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function searchAsync(client, baseDn, options) {
  return new Promise((resolve, reject) => {
    client.search(baseDn, options, (err, res) => {
      if (err) return reject(err);
      const entries = [];
      res.on('searchEntry', (entry) => {
        // In ldapjs 3.x, entry.object is undefined; attributes are in entry.attributes.
        // Build a plain object keyed by attribute type.
        const obj = { dn: String(entry.dn) };
        for (const attr of entry.attributes || []) {
          const vals = attr.values || attr.vals || [];
          obj[attr.type] = vals.length === 1 ? vals[0] : vals;
        }
        entries.push(obj);
      });
      res.on('error', (e) => reject(e));
      res.on('end', () => resolve(entries));
    });
  });
}

// ---------------------------------------------------------------------------
// User provisioning — mirrors ssoService.provisionUser pattern
// ---------------------------------------------------------------------------

async function provisionLdapUser(email, ldapRole) {
  let user = await prisma.user.findUnique({ where: { email }, include: { roleRef: true } });

  if (!user) {
    const roleName = ldapRole || 'submitter';
    const roleRecord = await prisma.role.findUnique({ where: { name: roleName } });
    const roleId = roleRecord ? roleRecord.id : null;
    user = await prisma.user.create({
      data: { email, passwordHash: '', role: roleName, roleId },
      include: { roleRef: true },
    });
  } else if (ldapRole) {
    const roleRecord = await prisma.role.findUnique({ where: { name: ldapRole } });
    if (roleRecord && user.roleId !== roleRecord.id) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { role: ldapRole, roleId: roleRecord.id },
        include: { roleRef: true },
      });
    }
  }

  return user;
}

function issueJwt(user) {
  const roleName = user.roleRef ? user.roleRef.name : user.role;
  const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
  return jwt.sign(
    { userId: user.id, email: user.email, role: roleName },
    process.env.JWT_SECRET,
    { expiresIn }
  );
}

// ---------------------------------------------------------------------------
// Core LDAP authenticate
// ---------------------------------------------------------------------------

/**
 * Authenticates a user against the LDAP directory.
 * Returns { email, ldapRole } on success.
 * Throws with .code === 'USER_NOT_FOUND' or 'INVALID_CREDENTIALS' on failure.
 */
async function authenticate(email, password) {
  const serviceClient = getServiceClient();

  // 1. Bind with service account
  await bindAsync(serviceClient, process.env.LDAP_BIND_DN, process.env.LDAP_BIND_PASSWORD);

  // 2. Search for user by email — escape special LDAP filter chars in the value
  const safeEmail = email.replace(/[\\*()\x00/]/g, '');
  const filterTemplate = process.env.LDAP_USER_FILTER || '(mail={email})';
  const filter = filterTemplate.replace('{email}', safeEmail);

  const roleAttr = process.env.LDAP_ROLE_ATTRIBUTE;

  const entries = await searchAsync(serviceClient, process.env.LDAP_BASE_DN, {
    filter,
    scope: 'sub',
  });

  if (entries.length === 0) {
    const err = new Error('User not found in LDAP directory');
    err.code = 'USER_NOT_FOUND';
    throw err;
  }

  const userEntry = entries[0];
  const userDn = userEntry.dn;

  // 3. Verify credentials by binding as the user — use a short-lived client
  const userClient = ldap.createClient({ url: process.env.LDAP_URL });
  try {
    await bindAsync(userClient, userDn, password);
  } catch {
    const err = new Error('Invalid credentials');
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  } finally {
    userClient.destroy();
  }

  // 4. Map LDAP group attribute → DocFlow role
  let ldapRole = null;
  if (roleAttr && userEntry[roleAttr]) {
    const roleMap = getLdapRoleMap();
    const groupVal = Array.isArray(userEntry[roleAttr])
      ? userEntry[roleAttr][0]
      : userEntry[roleAttr];
    ldapRole = roleMap[groupVal] || null;
  }

  return { email, ldapRole };
}

module.exports = {
  isLdapConfigured,
  getLdapRoleMap,
  authenticate,
  provisionLdapUser,
  issueJwt,
  _resetServiceClient,
};
