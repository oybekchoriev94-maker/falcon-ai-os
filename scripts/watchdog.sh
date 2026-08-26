#!/usr/bin/env bash
set -uo pipefail

# ============================================================
# Falcon AI OS — Watchdog (PR #15)
#
# Har 5 daqiqada cron orqali ishlaydi va MUAMMONI MIJOZDAN OLDIN
# topadi. Node ilovasi yiqilgan taqdirda ham ishlaydi — shu sabab
# shell'da, app'dan mustaqil yozilgan.
#
# CRON:
#   */5 * * * * cd /opt/falcon-ai-os && ./scripts/watchdog.sh >> backups/watchdog.log 2>&1
#
# TEKSHIRUVLAR:
#   1) /api/health/ready — ilova + DB javob berayaptimi
#   2) Disk — 90% dan to'lsa ogohlantiradi
#   3) Backup — last-backup.json 26 soatdan eski bo'lmasligi kerak
#   4) Konteynerlar — birorta 'unhealthy' bo'lmasligi kerak
#
# ALERT: Telegram (ADMIN_TG_BOT_TOKEN + ADMIN_TG_CHAT_ID). Token
# bo'lmasa — faqat logga yoziladi (graceful degradation, hech narsa
# sinmaydi). Har muammo turi uchun 30 daqiqada bir alert (spam yo'q);
# muammo tuzalganda "tiklandi" xabari boradi.
# ============================================================

REPO_DIR="${FALCON_REPO_DIR:-/opt/falcon-ai-os}"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
# App porti tashqariga chiqarilmagan — tekshiruv Caddy orqali o'tadi
# (SERVER_IP saytiga). Shu tarzda Caddy ham tekshiriladi.
WATCHDOG_URL="${WATCHDOG_URL:-http://${SERVER_IP:-127.0.0.1}/api/health/ready}"
DISK_LIMIT="${WATCHDOG_DISK_LIMIT:-90}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-26}"
STATE_FILE="$BACKUP_DIR/.watchdog-state.json"
ALERT_COOLDOWN_SEC=1800
HOSTNAME_TAG="$(hostname)"

mkdir -p "$BACKUP_DIR"
[ -f "$STATE_FILE" ] || echo '{}' > "$STATE_FILE"

NOW=$(date +%s)

# ── Telegram yuborish (token yo'q bo'lsa faqat log) ─────────
send_alert() {
  local title="$1" body="$2"
  echo "[$(date '+%F %T')] ALERT [$title] $body"
  if [ -n "${ADMIN_TG_BOT_TOKEN:-}" ] && [ -n "${ADMIN_TG_CHAT_ID:-}" ]; then
    curl -s -m 10 -X POST \
      "https://api.telegram.org/bot${ADMIN_TG_BOT_TOKEN}/sendMessage" \
      -d chat_id="$ADMIN_TG_CHAT_ID" \
      -d text="⚠️ Falcon AI OS [$HOSTNAME_TAG]
$title

$body" > /dev/null || echo "  (Telegram yuborilmadi)"
  fi
}

# ── Anti-spam: har muammo turi uchun cooldown + tiklanish ────
raise() {   # raise <key> <title> <body>
  local key="$1" title="$2" body="$3"
  local last
  last=$(python3 - "$STATE_FILE" "$key" <<'PY' 2>/dev/null || echo 0
import json,sys
try:
    with open(sys.argv[1]) as f: st=json.load(f)
    print(int(st.get(sys.argv[2],{}).get("last_alert",0)))
except Exception: print(0)
PY
)
  if [ $((NOW - last)) -ge "$ALERT_COOLDOWN_SEC" ]; then
    send_alert "$title" "$body"
    python3 - "$STATE_FILE" "$key" "$NOW" <<'PY' 2>/dev/null || true
import json,sys
p,k,t=sys.argv[1],sys.argv[2],int(sys.argv[3])
try:
    with open(p) as f: st=json.load(f)
except Exception: st={}
st.setdefault(k,{})["last_alert"]=t; st[k]["active"]=True
with open(p,"w") as f: json.dump(st,f)
PY
  fi
}

recover() { # recover <key> <title>
  local key="$1" title="$2"
  local active
  active=$(python3 - "$STATE_FILE" "$key" <<'PY' 2>/dev/null || echo 0
import json,sys
try:
    with open(sys.argv[1]) as f: st=json.load(f)
    print(1 if st.get(sys.argv[2],{}).get("active") else 0)
except Exception: print(0)
PY
)
  if [ "$active" = "1" ]; then
    send_alert "✅ Tiklandi" "$title — muammo bartaraf etildi."
    python3 - "$STATE_FILE" "$key" <<'PY' 2>/dev/null || true
import json,sys
p,k=sys.argv[1],sys.argv[2]
try:
    with open(p) as f: st=json.load(f)
except Exception: st={}
st.setdefault(k,{})["active"]=False
with open(p,"w") as f: json.dump(st,f)
PY
  fi
}

PROBLEMS=0

# ── 1) Ilova tayyorligi ──────────────────────────────────────
if curl -sf -m 10 "$WATCHDOG_URL" > /dev/null; then
  recover "app" "Ilova va DB"
else
  PROBLEMS=1
  raise "app" "Ilova javob bermayapti" \
    "$WATCHDOG_URL so'roviga javob yo'q. Konteynerlar: 'docker compose ps' ni tekshiring."
fi

# ── 2) Disk ──────────────────────────────────────────────────
DISK_USE=$(df -P "$REPO_DIR" | awk 'NR==2 {gsub("%",""); print $5}')
if [ "${DISK_USE:-0}" -ge "$DISK_LIMIT" ]; then
  PROBLEMS=1
  raise "disk" "Disk to'lmoqda" "Disk ${DISK_USE}% to'lgan (chegara ${DISK_LIMIT}%). Loglar va eski backup'larni tozalang."
else
  recover "disk" "Disk hajmi"
fi

# ── 3) Backup yangiligi ──────────────────────────────────────
STATUS_FILE="$BACKUP_DIR/last-backup.json"
if [ ! -f "$STATUS_FILE" ]; then
  PROBLEMS=1
  raise "backup" "Backup sozlanmagan" "last-backup.json topilmadi. Cronga scripts/backup-pg.sh qo'shilmagan."
else
  AGE_OK=$(python3 - "$STATUS_FILE" "$BACKUP_MAX_AGE_HOURS" <<'PY' 2>/dev/null || echo "err"
import json,sys,datetime
try:
    with open(sys.argv[1]) as f: st=json.load(f)
    if st.get("ok") is False: print("failed"); raise SystemExit
    ts=datetime.datetime.fromisoformat(st["timestamp"].replace("Z","+00:00"))
    age_h=(datetime.datetime.now(datetime.timezone.utc)-ts).total_seconds()/3600
    print("ok" if age_h<=float(sys.argv[2]) else "stale")
except Exception: print("err")
PY
)
  case "$AGE_OK" in
    ok)     recover "backup" "Kunlik backup" ;;
    stale)  PROBLEMS=1; raise "backup" "Backup eskirgan" \
              "Oxirgi muvaffaqiyatli backup ${BACKUP_MAX_AGE_HOURS} soatdan eski. backups/backup.log ni tekshiring." ;;
    failed) PROBLEMS=1; raise "backup" "Backup XATO bilan tugagan" \
              "Oxirgi urinish muvaffaqiyatsiz (last-backup.json: ok=false). backups/backup.log ni tekshiring." ;;
    *)      PROBLEMS=1; raise "backup" "Backup statusi o'qilmadi" \
              "last-backup.json fayli yaroqsiz yoki vaqt formati noto'g'ri." ;;
  esac
fi

# ── 4) Konteyner salomatligi ─────────────────────────────────
cd "$REPO_DIR" 2>/dev/null || true
UNHEALTHY=$(docker compose ps --format json 2>/dev/null | \
  python3 -c 'import json,sys
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    try: d=json.loads(line)
    except Exception: continue
    if isinstance(d,list):
        for x in d:
            if x.get("Health","")=="unhealthy": print(x.get("Service"))
    elif d.get("Health","")=="unhealthy": print(d.get("Service"))' 2>/dev/null)
if [ -n "${UNHEALTHY:-}" ]; then
  PROBLEMS=1
  raise "containers" "Konteyner nosog'lom" "unhealthy: $UNHEALTHY. 'docker compose logs <servis>' ni tekshiring."
else
  recover "containers" "Konteynerlar"
fi

if [ "$PROBLEMS" = "0" ]; then
  echo "[$(date '+%F %T')] OK — hammasi sog'lom"
fi
