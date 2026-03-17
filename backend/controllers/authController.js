const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../src/db/client');
const { logEvent } = require('../services/auditLog');

async function register(req, res) {
  const { email, password, role } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: 'Email already in use' });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // Resolve roleId from role name if provided
  let roleId = null;
  const roleName = role || 'submitter';
  const roleRecord = await prisma.role.findUnique({ where: { name: roleName } });
  if (roleRecord) {
    roleId = roleRecord.id;
  }

  const user = await prisma.user.create({
    data: { email, passwordHash, role: roleName, roleId },
    select: { id: true, email: true, role: true, createdAt: true },
  });

  return res.status(201).json({ user });
}

async function login(req, res) {
  const { email, password } = req.body;
  const ipAddress = req.ip || null;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { roleRef: true },
  });
  if (!user) {
    try {
      logEvent({ action: 'user.login_failed', targetType: 'user', targetId: email, metadata: { email, reason: 'user_not_found' }, ipAddress });
    } catch {}
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    try {
      logEvent({ action: 'user.login_failed', targetType: 'user', targetId: user.id, metadata: { email, reason: 'invalid_password' }, ipAddress });
    } catch {}
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Resolve role name: prefer the RBAC Role record, fall back to legacy role string
  const roleName = user.roleRef ? user.roleRef.name : user.role;

  const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: roleName },
    process.env.JWT_SECRET,
    { expiresIn }
  );

  try {
    logEvent({ actorUserId: user.id, action: 'user.login', targetType: 'user', targetId: user.id, metadata: { method: 'local' }, ipAddress });
  } catch {}

  return res.status(200).json({ token });
}

async function logout(req, res) {
  // JWT is stateless — there is nothing to revoke server-side.
  // This endpoint exists for audit logging and to give clients a clean signout path.
  try {
    const authHeader = req.headers.authorization;
    let userId = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
        userId = decoded.userId;
      } catch {}
    }
    logEvent({ actorUserId: userId, action: 'user.logout', targetType: 'user', targetId: userId || 'unknown', metadata: { method: 'local' }, ipAddress: req.ip || null });
  } catch {}

  return res.status(200).json({ message: 'Logged out' });
}

module.exports = { register, login, logout };
