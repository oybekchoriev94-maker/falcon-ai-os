#!/usr/bin/env bash
# ============================================================
# STT tezkor tekshiruvi — deploydan keyin ishga tushiring.
#
# NEGA KERAK: STT buzilganini sezish qiyin. Konteyner "ishlayapti"
# ko'rinadi, /health "ok" deydi, lekin model noto'g'ri bo'lishi yoki
# jimlikdan so'z to'qib chiqarishi mumkin. Bu tekshiruv shularni
# aniq raqam bilan ko'rsatadi.
#
# Ishlatish (VPS'da, /opt/falcon-ai-os ichidan):
#   ./scripts/stt-smoke-test.sh
# ============================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

DC="docker compose"
FAIL=0
ok()   { echo "  ✓ $*"; }
bad()  { echo "  ✗ $*"; FAIL=1; }
warn() { echo "  ! $*"; }

echo ""
echo "════ STT tekshiruvi ════"

# ── 1) Konteyner ishlayaptimi ────────────────────────────────
echo ""
echo "1) Konteyner holati"
STATUS="$($DC ps --format '{{.Status}}' stt 2>/dev/null || echo '')"
if [[ -z "$STATUS" ]]; then
  bad "stt konteyneri umuman topilmadi"
  echo ""; echo "✗ TEKSHIRUV TO'XTATILDI"; exit 1
elif [[ "$STATUS" == *"healthy"* ]]; then
  ok "$STATUS"
else
  # "Up" lekin healthy emas — model hali yuklanayotgan bo'lishi mumkin
  warn "$STATUS  (sog'liq tekshiruvi hali o'tmagan)"
fi

# ── 2) Qaysi model yuklangan ─────────────────────────────────
# Port tashqariga chiqarilmagan, shuning uchun konteyner ICHIDAN so'raymiz.
echo ""
echo "2) Yuklangan model"
HEALTH="$($DC exec -T stt curl -sf --max-time 10 http://localhost:8081/health 2>/dev/null || echo '')"
if [[ -z "$HEALTH" ]]; then
  bad "/health javob bermadi — model hali yuklanmoqda yoki xizmat yiqilgan"
  echo "     Loglar:  docker compose logs stt --tail=40"
else
  ok "$HEALTH"
  case "$HEALTH" in
    *rubaistt*) ok "rubaiSTT — kutilgan model" ;;
    *) bad "KUTILMAGAN MODEL. docker-compose.yml dagi MODEL_NAME ni tekshiring" ;;
  esac
fi

# ── 3) Model fayli to'liqmi ──────────────────────────────────
# Yarim ko'chirilgan (scp uzilib qolgan) model eng yomon holat: papka
# bor, xizmat ishga tushadi, lekin transkripsiya tushunarsiz yiqiladi.
echo ""
echo "3) Model fayli"
if $DC exec -T stt test -f /models/rubaistt-v2-medium-ct2/model.bin 2>/dev/null; then
  SIZE="$($DC exec -T stt du -h /models/rubaistt-v2-medium-ct2/model.bin 2>/dev/null | cut -f1 | tr -d '\r')"
  ok "model.bin mavjud — $SIZE"
  # ~770MB = int8 (kutilgan), ~1.5GB = float16 (GPU uchun, xotira 2x)
  BYTES="$($DC exec -T stt stat -c %s /models/rubaistt-v2-medium-ct2/model.bin 2>/dev/null | tr -d '\r')"
  if [[ -n "$BYTES" && "$BYTES" -gt 1100000000 ]]; then
    warn "Hajm int8 uchun katta — bu float16 (GPU) nusxasi bo'lishi mumkin."
    warn "int8 taxminan 770MB bo'ladi va RAM'ni ~2 barobar kam oladi."
  fi
else
  bad "model.bin YO'Q — model ko'chirilmagan yoki scp uzilib qolgan"
fi

# ── 4) Jimlik testi — GALLYUTSINATSIYA REGRESSIYASI ──────────
# Bu shunchaki "ishlayaptimi" testi EMAS. Noto'g'ri sozlangan STT
# (vad_filter o'chiq) 3 soniyalik JIMLIKDAN "musiqa" degan so'z to'qib
# chiqargani production'da ISBOTLANGAN. Bunday matn to'g'ridan-to'g'ri
# bemorning tibbiy kartasiga yozilishi mumkin edi. Shuning uchun bo'sh
# audio BO'SH matn qaytarishi SHART.
echo ""
echo "4) Jimlik testi (soxta matn to'qimasligi)"
SILENCE_JSON="$($DC exec -T stt sh -c '
  ffmpeg -loglevel quiet -f lavfi -i anullsrc=r=16000:cl=mono -t 3 -y /tmp/_smoke.wav 2>/dev/null &&
  curl -s --max-time 120 -F "file=@/tmp/_smoke.wav" -F "language=uz" http://localhost:8081/transcribe;
  rm -f /tmp/_smoke.wav
' 2>/dev/null || echo '')"

if [[ -z "$SILENCE_JSON" ]]; then
  bad "Transkripsiya so'rovi javobsiz qoldi"
else
  # {"text":"","language":"uz"} — matn qismi bo'sh bo'lishi kerak
  TEXT="$(printf '%s' "$SILENCE_JSON" | sed -n 's/.*"text"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  if [[ -z "$TEXT" ]]; then
    ok "Jimlikdan bo'sh matn qaytdi — to'g'ri"
  else
    bad "JIMLIKDAN MATN TO'QILDI: \"$TEXT\""
    bad "Bu matn bemor kartasiga tushishi mumkin. vad_filter sozlamasini tekshiring."
  fi
fi

# ── 5) Xotira ────────────────────────────────────────────────
echo ""
echo "5) Xotira"
STATS="$(docker stats --no-stream --format '{{.MemUsage}} ({{.MemPerc}})' falcon-ai-os-stt-1 2>/dev/null || echo '')"
if [[ -z "$STATS" ]]; then
  warn "docker stats o'qib bo'lmadi"
else
  PERC="$(printf '%s' "$STATS" | sed -n 's/.*(\([0-9]*\)\.[0-9]*%).*/\1/p')"
  if [[ -n "$PERC" && "$PERC" -ge 90 ]]; then
    bad "$STATS — CHEGARAGA JUDA YAQIN"
    bad "Uzun diktant paytida OOM bilan o'chib qolishi mumkin."
  elif [[ -n "$PERC" && "$PERC" -ge 75 ]]; then
    warn "$STATS — kuzatib turing"
  else
    ok "$STATS"
  fi
  # Docker'ning MEM USAGE ko'rsatkichiga fayl keshi ham kiradi (u xotira
  # taqchil bo'lganda bo'shatiladi). Haqiqiy band xotira — `anon`.
  ANON="$($DC exec -T stt sh -c 'grep -m1 "^anon " /sys/fs/cgroup/memory.stat 2>/dev/null' 2>/dev/null | awk '{printf "%.2f", $2/1073741824}' || echo '')"
  [[ -n "$ANON" ]] && echo "     haqiqiy band (anon): ${ANON} GiB — qolgani fayl keshi, u bo'shatiladi"
fi

echo ""
if [[ "$FAIL" -eq 0 ]]; then
  echo "════ ✓ HAMMASI JOYIDA ════"
else
  echo "════ ✗ MUAMMO TOPILDI (yuqoriga qarang) ════"
fi
echo ""
exit "$FAIL"
