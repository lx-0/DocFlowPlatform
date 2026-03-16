# DocFlow Platform — Backup and Recovery

This guide covers what to back up, how to do it, and how to restore DocFlow from a backup.

---

## What to Back Up

DocFlow's persistent state lives in two places:

| Data | Location | Notes |
|:-----|:---------|:------|
| PostgreSQL database | `DATABASE_URL` | Documents, users, roles, workflows, audit logs |
| Uploaded files | `UPLOAD_DIR` (default: `backend/uploads/`) | Original and formatted document files |

Both must be backed up together. A database backup without the corresponding files (or vice versa) will leave the system in an inconsistent state after recovery.

---

## Database Backup

### Manual Backup with pg_dump

```bash
pg_dump \
  --dbname="postgresql://USER:PASSWORD@HOST:5432/docflow" \
  --format=custom \
  --compress=9 \
  --file="/var/backups/docflow/db-$(date +%Y%m%d-%H%M%S).pgdump"
```

The `--format=custom` option produces a compressed binary dump that supports parallel restore and selective table restore.

### Automated Backup via Cron

Create `/etc/cron.d/docflow-backup`:

```cron
# Daily backup at 02:00, keep 30 days
0 2 * * * docflow /usr/local/bin/docflow-backup.sh >> /var/log/docflow-backup.log 2>&1
```

Create `/usr/local/bin/docflow-backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/docflow"
RETAIN_DAYS=30
DATE=$(date +%Y%m%d-%H%M%S)

# Load DATABASE_URL from the app's .env if not already in environment
if [ -z "${DATABASE_URL:-}" ]; then
  source /opt/docflow/backend/.env
fi

mkdir -p "$BACKUP_DIR"

# Database
pg_dump \
  --dbname="$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --file="$BACKUP_DIR/db-$DATE.pgdump"

# Uploaded files
UPLOAD_DIR="${UPLOAD_DIR:-/opt/docflow/backend/uploads}"
tar -czf "$BACKUP_DIR/uploads-$DATE.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"

# Remove backups older than RETAIN_DAYS
find "$BACKUP_DIR" -name "*.pgdump" -mtime +$RETAIN_DAYS -delete
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +$RETAIN_DAYS -delete

echo "$DATE backup complete"
```

```bash
chmod +x /usr/local/bin/docflow-backup.sh
```

### Off-Site Storage

Copy backups to an off-site location after creation. Options:

- **S3**: `aws s3 cp "$BACKUP_DIR/db-$DATE.pgdump" s3://your-bucket/docflow-backups/`
- **rsync**: `rsync -az "$BACKUP_DIR/" backup-server:/mnt/docflow-backups/`

---

## File Backup

The `UPLOAD_DIR` directory contains all uploaded and processed documents. Back it up alongside each database dump so the two are in sync.

The cron script above handles this automatically. For additional safety, consider:

- **Snapshots**: Take filesystem or volume snapshots if your infrastructure supports it (AWS EBS, Azure Managed Disk, LVM).
- **Replication**: Use a replicated NFS or distributed filesystem for real-time redundancy.

---

## Recovery

### Step 1 — Stop the Application

```bash
# pm2
pm2 stop docflow

# systemd
systemctl stop docflow
```

### Step 2 — Restore the Database

```bash
# Drop and recreate the database (adjust credentials as needed)
psql -U postgres -c "DROP DATABASE IF EXISTS docflow;"
psql -U postgres -c "CREATE DATABASE docflow OWNER docflow_user;"

# Restore from the dump file
pg_restore \
  --dbname="postgresql://USER:PASSWORD@HOST:5432/docflow" \
  --no-owner \
  --role=docflow_user \
  /var/backups/docflow/db-YYYYMMDD-HHMMSS.pgdump
```

### Step 3 — Restore Uploaded Files

```bash
UPLOAD_DIR="${UPLOAD_DIR:-/opt/docflow/backend/uploads}"
PARENT_DIR=$(dirname "$UPLOAD_DIR")

# Remove existing uploads directory
rm -rf "$UPLOAD_DIR"

# Extract backup
tar -xzf /var/backups/docflow/uploads-YYYYMMDD-HHMMSS.tar.gz -C "$PARENT_DIR"

# Fix ownership
chown -R docflow:docflow "$UPLOAD_DIR"
```

### Step 4 — Run Any Pending Migrations

If restoring to a newer version of the application code:

```bash
cd /opt/docflow/backend
npm run db:migrate
```

### Step 5 — Start the Application

```bash
# pm2
pm2 start docflow

# systemd
systemctl start docflow
```

### Step 6 — Verify

```bash
curl -f http://localhost:3000/health
```

Log in and confirm that recently submitted documents appear and their files are accessible.

---

## Recovery Time Objectives

| Operation | Typical Duration |
|:----------|:----------------|
| Database restore (small, < 1 GB) | 5–15 minutes |
| Database restore (large, 10+ GB) | 30–90 minutes |
| File restore (depends on volume size) | Varies |

Test your recovery procedure in a staging environment at least once per quarter to verify backup integrity and measure actual RTO.
