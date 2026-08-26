#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Falcon AI OS — PostgreSQL production backup (PR #15)
#
# Eski backup.sh SQLite uchun edi; production endi PostgreSQL'da.
# Bu skript VPS'da HOST'dan ishlaydi va docker orqali db konteynerida
# pg_dump bajaradi.
#
# CRON (har kuni 02:30 da):
#   crontab -e
#   30 2 * * * cd /opt/falcon-ai-os && ./scripts/backup-pg.sh >> backups/backup.log 2>&1
#
# XAVFSIZLIK:
#   - Custom format (-Fc): siqilgan + tanlab tiklash mumkin
#   - Har backup pg_restore --list bilan TEKSHIRILADI (yaroqsiz fayl
#     saqlanmaydi — "bor deb o'ylangan, lekin buzilgan" backup eng
#     yomon holat)
#   - Status fayli (last-backup.json) — /api/health/deep va watchdog
#     shu orqali "backup eskirgan" deb ogohlantiradi
#   - .env (sirlar) backup'ga KIRMAYDI — u alohida, shifrlangan
#     holda saqlanishi kerak (masalan age/gpg bilan, ofsayt nusxa)
# ============================================================

REPO_DIR="${FALCON_REPO_DIR:-/opt/falcon-ai-os}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
COMPOSE="docker compose -f $REPO_DIR/docker-compose.yml"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/falcon_${TIMESTAMP}.dump"
LOCK_DIR="$BACKUP_DIR/.backup.lock"
START_MS=$(date +%s%3N 2>/dev/null || echo 0)

mkdir -p "$BACKUP_DIR"

# Paralel backup'larni to'sish (flock har VPS'da bo'lmasligi mumkin —
# mkdir-lock portativroq)
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "[$(date '+%F %T')] Backup allaqachon ishlamoqda — o'tkazib yuborildi"
  exit 1
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

echo "[$(date '+%F %T')] Backup boshlandi -> $BACKUP_FILE"

# 1) Dump. -Fc = custom format (siqilgan, katalog sifatida o'qiladi).
if ! $COMPOSE exec -T db pg_dump -U falcon -d falcon_ai_os -Fc > "$BACKUP_FILE"; then
  echo "[$(date '+%F %T')] XATO: pg_dump bajarilmadi"
  rm -f "$BACKUP_FILE"
  printf '{"ok":false,"timestamp":"%s","error":"pg_dump failed"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$BACKUP_DIR/last-backup.json"
  exit 1
fi

# 2) Yaroqlilik tekshiruvi: arxiv ro'yxati o'qilishi shart. Buzilgan fayl
# "backup bor" degan soxta ishonch yaratmasin.
if ! cat "$BACKUP_FILE" | $COMPOSE exec -T db pg_restore --list > /dev/null 2>&1; then
  echo "[$(date '+%F %T')] XATO: backup fayli yaroqsiz (pg_restore --list o'qimadi)"
  rm -f "$BACKUP_FILE"
  printf '{"ok":false,"timestamp":"%s","error":"verify failed"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$BACKUP_DIR/last-backup.json"
  exit 1
fi

SIZE=$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")
END_MS=$(date +%s%3N 2>/dev/null || echo 0)
DURATION_MS=$((END_MS - START_MS))
[ "$DURATION_MS" -lt 0 ] && DURATION_MS=0

# 3) Status fayli — monitoring shuni o'qiydi
printf '{"ok":true,"timestamp":"%s","file":"%s","size_bytes":%s,"duration_ms":%s,"retention_days":%s}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$BACKUP_FILE" "$SIZE" "$DURATION_MS" "$RETENTION_DAYS" \
  > "$BACKUP_DIR/last-backup.json"

echo "[$(date '+%F %T')] OK: $(basename "$BACKUP_FILE") ($((SIZE / 1024)) KB, ${DURATION_MS}ms)"

# 4) Rotatsiya — eski backup'larni tozalash
find "$BACKUP_DIR" -name 'falcon_*.dump' -mtime +"$RETENTION_DAYS" -delete
echo "[$(date '+%F %T')] ${RETENTION_DAYS} kundan eski fayllar tozalandi"
