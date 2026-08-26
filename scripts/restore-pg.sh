#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Falcon AI OS — Disaster Recovery: bazani backup'dan tiklash
#
# ISHLATISH:
#   ./scripts/restore-pg.sh                     # eng yangi backup
#   ./scripts/restore-pg.sh backups/falcon_20260826_023000.dump
#   ./scripts/restore-pg.sh --yes <fayl>        # tasdiqsiz (skript uchun)
#
# OG'OHLANTIRISH: bu joriy bazani O'CHIRIB, backup holatiga qaytaradi.
# --clean --if-exists rejimi: mavjud obyektlar o'chirilib, backup'dagi
# holat yoziladi. RLS siyosatlari va role'lar dump ichida bor.
#
# TARTIB (DR runbook):
#   1. MUMKIN BO'LSA hozirgi holatdan ham backup oling:
#        ./scripts/backup-pg.sh   (tiklash oldidan dalil qoladi)
#   2. ./scripts/restore-pg.sh <fayl>
#   3. Skript app'ni to'xtatadi, tiklaydi, migration'larni qayta
#      o'tkazadi va qayta ishga tushiradi
#   4. Tekshiruv: curl https://DOMAIN/api/health/deep va asosiy
#      oqimlar (kirish, navbat, qabul)
# ============================================================

REPO_DIR="${FALCON_REPO_DIR:-/opt/falcon-ai-os}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
COMPOSE="docker compose -f $REPO_DIR/docker-compose.yml"
cd "$REPO_DIR"

AUTO_YES=0
FILE=""
for arg in "$@"; do
  case "$arg" in
    --yes) AUTO_YES=1 ;;
    *) FILE="$arg" ;;
  esac
done

# Eng yangi backup tanlanadi
if [ -z "$FILE" ]; then
  FILE=$(ls -t "$BACKUP_DIR"/falcon_*.dump 2>/dev/null | head -1 || true)
  if [ -z "$FILE" ]; then
    echo "XATO: $BACKUP_DIR da bitta ham falcon_*.dump topilmadi"
    exit 1
  fi
fi
if [ ! -f "$FILE" ]; then
  echo "XATO: fayl topilmadi: $FILE"
  exit 1
fi

echo "=============================================="
echo " DISASTER RECOVERY — baza tiklanmoqda"
echo " Fayl: $FILE"
echo " Joriy BAZA O'CHIRILIB shu holatga qaytariladi!"
echo "=============================================="

if [ "$AUTO_YES" -ne 1 ]; then
  read -r -p "Davom etilsinmi? Tasdiq uchun 'TIKLASH' deb yozing: " ANSWER
  if [ "$ANSWER" != "TIKLASH" ]; then
    echo "Bekor qilindi."
    exit 1
  fi
fi

echo "[1/5] Fayl yaroqliligi tekshirilmoqda..."
cat "$FILE" | $COMPOSE exec -T db pg_restore --list > /dev/null \
  || { echo "XATO: backup fayli yaroqsiz"; exit 1; }

echo "[2/5] Ilova to'xtatilmoqda (yozuv bo'lmasligi uchun)..."
$COMPOSE stop app frontend caddy || true

echo "[3/5] Baza tiklanmoqda..."
# --no-owner: role parollari farq qilishi mumkin; obyektlar falcon'ga o'tadi.
cat "$FILE" | $COMPOSE exec -T db pg_restore \
  -U falcon -d falcon_ai_os --clean --if-exists --no-owner 2>&1 | \
  grep -v 'does not exist, skipping' || true

echo "[4/5] Migration va role provisioning qayta ishga tushirilmoqda..."
$COMPOSE run --rm db-bootstrap

echo "[5/5] Ilova qayta ishga tushirilmoqda..."
$COMPOSE up -d --wait --wait-timeout 600

echo ""
echo "Tiklash tugadi. Tekshiring:"
echo "  curl -s http://localhost:3000/api/health/deep | head"
echo "  $COMPOSE ps"
