const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../src/db/client');

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

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    include: { roleRef: true },
  });
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
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

  return res.status(200).json({ token });
}

module.exports = { register, login };
