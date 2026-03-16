# DocFlow Platform — Troubleshooting

Common startup errors, log inspection, and administrative recovery procedures.

---

## Checking Application Logs

### pm2

```bash
pm2 logs docflow          # Tail live logs
pm2 logs docflow --lines 200  # Last 200 lines
pm2 logs docflow --err    # stderr only
```

Log files are stored at `~/.pm2/logs/docflow-out.log` and `~/.pm2/logs/docflow-error.log`.

### systemd

```bash
journalctl -u docflow -f           # Tail live logs
journalctl -u docflow --since today
journalctl -u docflow -n 200 --no-pager
```

### Direct (development / manual start)

Logs are printed to stdout/stderr. Redirect if needed:

```bash
node src/index.js >> /var/log/docflow.log 2>&1
```

---

## Common Startup Errors

### `Error: Environment variable not found: DATABASE_URL`

**Cause:** The `.env` file is missing or `DATABASE_URL` is not set.

**Fix:**
1. Confirm `backend/.env` exists: `ls -la /opt/docflow/backend/.env`
2. Confirm `DATABASE_URL` is present and not commented out.
3. Verify the connection string format: `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`
4. Test the connection: `psql "$DATABASE_URL" -c "SELECT 1;"`

---

### `Error: Can't reach database server` / `ECONNREFUSED`

**Cause:** PostgreSQL is not running, or the host/port in `DATABASE_URL` is wrong.

**Fix:**
1. Check if PostgreSQL is running: `systemctl status postgresql`
2. Verify the host and port: `pg_isready -h HOST -p PORT`
3. Check firewall rules if PostgreSQL is on a separate server.
4. Confirm the database user has access: `psql "$DATABASE_URL" -c "SELECT current_user;"`

---

### `PrismaClientInitializationError` / `Migration pending`

**Cause:** The Prisma client has not been generated, or database migrations have not been applied.

**Fix:**
```bash
cd /opt/docflow/backend
npm run db:generate    # Regenerate the Prisma client
npm run db:migrate     # Apply pending migrations
```

Then restart the application.

---

### `Error: JWT_SECRET is required`

**Cause:** `JWT_SECRET` is not set in the environment.

**Fix:** Add a strong secret to `backend/.env`:

```env
JWT_SECRET=your-long-random-secret-here
```

Generate a suitable value: `openssl rand -hex 32`

---

### `Error: LDAP_URL is set but connection failed`

**Cause:** The LDAP server is unreachable or the bind credentials are wrong.

**Fix:**
1. Test connectivity: `ldapsearch -H "$LDAP_URL" -x -b "" -s base`
2. Test bind: `ldapsearch -H "$LDAP_URL" -D "$LDAP_BIND_DN" -w "$LDAP_BIND_PASSWORD" -x -b "$LDAP_BASE_DN" "(objectClass=*)"`
3. For `ldaps://`, ensure the server certificate is trusted by the OS trust store.

---

### `Port already in use` / `EADDRINUSE`

**Cause:** Another process is already listening on `PORT` (default 3000).

**Fix:**
```bash
# Find what is using the port
lsof -i :3000

# Kill it or change PORT in .env
PORT=3001 node src/index.js
```

---

### `ENOMEM` or process crash on startup

**Cause:** Not enough RAM.

**Fix:**
- Increase server RAM.
- Limit Node.js heap: `NODE_OPTIONS=--max-old-space-size=2048 node src/index.js`

---

## Resetting an Admin Password

If all admin accounts are locked out:

### Option A — Direct database update

```bash
# Generate a bcrypt hash for the new password (cost factor 10)
node -e "const b=require('bcryptjs'); b.hash('NewPassword123!', 10).then(h=>console.log(h));"

# Apply it in psql
psql "$DATABASE_URL" -c "
  UPDATE users
  SET password = '\$2a\$10\$<paste-hash-here>'
  WHERE email = 'admin@corp.com';
"
```

Replace `\$2a\$10\$<paste-hash-here>` with the hash output and `admin@corp.com` with the target email.

### Option B — Create a new admin via database insert

```bash
node -e "const b=require('bcryptjs'); b.hash('TempPass1!', 10).then(h=>console.log(h));"

psql "$DATABASE_URL" <<SQL
INSERT INTO users (id, email, password, role, "createdAt", "updatedAt")
VALUES (
  gen_random_uuid(),
  'recovery-admin@corp.com',
  '\$2a\$10\$<hash>',
  'admin',
  NOW(),
  NOW()
);
SQL
```

Log in with the recovery account, change the password through the UI, then delete the recovery account.

---

## Checking Migration Status

To see which migrations have been applied:

```bash
cd /opt/docflow/backend
npx prisma migrate status
```

To check pending migrations without applying them, review the output of `migrate status`. If migrations are listed as "pending", run `npm run db:migrate` to apply them.

---

## Validating the Health Endpoint

```bash
curl -v http://localhost:3000/health
```

Expected response:

```
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

If this fails:
- Check that the Node.js process is running: `pm2 status` or `systemctl status docflow`
- Check port binding: `ss -tlnp | grep 3000`
- Check logs for startup errors (see above)

---

## Collecting Diagnostic Information for Support

When filing a support issue, include:

```bash
node --version
npm --version
psql --version
cd /opt/docflow/backend && npx prisma --version
pm2 logs docflow --lines 100 --nocolor 2>&1 | tail -100
# or: journalctl -u docflow -n 100 --no-pager
```
