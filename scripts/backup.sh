#!/bin/sh
# Falcon AI OS — SQLite daily hot backup
# Usage: crontab -e
#   0 2 * * * /app/scripts/backup.sh /data/klinika.sqlite /backup 30

set -euo pipefail

DB="${1:-/data/klinika.sqlite}"
BACKUP_DIR="${2:-/backup}"
RETENTION_DAYS="${3:-30}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/klinika_${TIMESTAMP}.db"
LOCK_FILE="${BACKUP_DIR}/.backup.lock"

mkdir -p "$BACKUP_DIR"

# Prevent concurrent backups
exec 200>"$LOCK_FILE"
flock -n 200 || { echo "Backup already running"; exit 1; }

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup: $DB → $BACKUP_FILE"

# Hot backup via SQLite online backup API
sqlite3 "$DB" ".backup '$BACKUP_FILE'"

# Verify integrity
sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;" | grep -q "ok" || {
  echo "BACKUP INTEGRITY FAILED"
  rm -f "$BACKUP_FILE"
  exit 1
}

# Compress
gzip -f "$BACKUP_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_FILE}.gz" | cut -f1))"

# Cleanup old backups
find "$BACKUP_DIR" -name "klinika_*.db.gz" -mtime +${RETENTION_DAYS} -delete
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Cleaned backups older than ${RETENTION_DAYS} days"

exec 200>&-
