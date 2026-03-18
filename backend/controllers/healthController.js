const fs = require('fs');
const path = require('path');
const prisma = require('../src/db/client');

const UPLOAD_DIR = path.join(__dirname, '../uploads');

async function checkDb() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return 'ok';
  } catch {
    return 'error';
  }
}

function checkStorage() {
  try {
    const testFile = path.join(UPLOAD_DIR, '.health-probe');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
    return 'ok';
  } catch {
    return 'error';
  }
}

function checkEmail() {
  const host = process.env.SMTP_HOST || '';
  return host ? 'ok' : 'unconfigured';
}

async function getHealth(req, res) {
  const [db, storage, email] = await Promise.all([
    checkDb(),
    Promise.resolve(checkStorage()),
    Promise.resolve(checkEmail()),
  ]);

  const degraded = db === 'error' || storage === 'error';
  const status = degraded ? 'degraded' : 'ok';

  res.status(degraded ? 503 : 200).json({
    status,
    db,
    storage,
    email,
    timestamp: new Date().toISOString(),
  });
}

function getLive(req, res) {
  res.status(200).json({ status: 'ok' });
}

module.exports = { getHealth, getLive };
