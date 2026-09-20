#!/usr/bin/env bash
# ============================================================
# STT tezligini HAQIQIY nutq bilan o'lchash.
#
# NEGA KERAK: jimlik bilan o'lchash noto'g'ri natija beradi —
# VAD (ovoz aniqlagich) jim qismlarni butunlay o'tkazib yuboradi
# va model deyarli ishlamaydi. Shuning uchun bu skript avval TTS
# orqali haqiqiy o'zbekcha jumla yasaydi, keyin o'shani STT'ga
# yuboradi.
#
# Ketma-ket bir necha so'rov yuboriladi: birinchisi "sovuq"
# (jarayon xotiradan siqib chiqarilgan bo'lishi mumkin), keyingilari
# "issiq". Farq katta bo'lsa — xotira (RAM/swap) muammosi bor.
#
# Ishlatish (VPS'da, tunnel orqali klinika GPU'siga boradi):
#   ./scripts/stt-bench.sh
#
# Boshqa manzilni sinash uchun:
#   STT_URL=http://127.0.0.1:8081 ./scripts/stt-bench.sh
# ============================================================
set -uo pipefail

STT_URL="${STT_URL:-http://localhost:8081}"
TTS_URL="${TTS_URL:-http://localhost:8082}"
TTS_TOKEN="${TTS_AUTH_TOKEN:-}"
RUNS="${RUNS:-4}"

TEXT="Bemor bosh og'rig'i va qon bosimi ko'tarilganidan shikoyat qilmoqda. \
Qon bosimi bir yuz qirq to'qsonga teng. Paratsetamol va qon bosimi dorisini tavsiya qildim."

WAV=/tmp/stt-bench.wav
OUT=/tmp/stt-bench-out.json

echo ""
echo "════ STT tezlik o'lchovi ════"
echo ""
echo "1) Holat"
HEALTH=$(curl -s -m 10 "$STT_URL/health" || true)
if [ -z "$HEALTH" ]; then
  echo "  ✗ STT javob bermadi: $STT_URL"
  exit 1
fi
echo "  ✓ $HEALTH"

echo ""
echo "2) Test audio (TTS orqali haqiqiy nutq)"
if [ -f "$WAV" ]; then
  echo "  • oldingi fayl ishlatiladi: $WAV"
else
  printf '{"text":"%s","voice":"registratura","language":"uz"}' "$TEXT" > /tmp/stt-bench-req.json
  curl -s -X POST "$TTS_URL/synthesize" \
    -H "Content-Type: application/json" \
    ${TTS_TOKEN:+-H "Authorization: Bearer $TTS_TOKEN"} \
    --data @/tmp/stt-bench-req.json -o "$WAV"
  rm -f /tmp/stt-bench-req.json
fi

if [ ! -s "$WAV" ]; then
  echo "  ✗ TTS audio yaratmadi. TTS_URL / TTS_AUTH_TOKEN ni tekshiring."
  exit 1
fi
SIZE=$(stat -c%s "$WAV")
DUR=$(awk "BEGIN{printf \"%.1f\", ($SIZE-44)/(24000*2)}")
echo "  ✓ $SIZE bayt (~${DUR}s nutq)"

echo ""
echo "3) Ketma-ket $RUNS ta so'rov"
TOTAL=0
for i in $(seq 1 "$RUNS"); do
  START=$(date +%s.%N)
  curl -s -X POST "$STT_URL/v1/audio/transcriptions" \
    -F "file=@$WAV" -F "language=uz" -o "$OUT"
  END=$(date +%s.%N)
  T=$(awk "BEGIN{printf \"%.2f\", $END-$START}")
  RT=$(awk "BEGIN{printf \"%.2f\", $T/$DUR}")
  if [ "$i" = "1" ]; then NOTE="  (birinchi — sovuq bo'lishi mumkin)"; else NOTE=""; fi
  echo "  $i-so'rov: ${T}s   (nutq davomiyligiga nisbatan ${RT}x)$NOTE"
  TOTAL=$(awk "BEGIN{print $TOTAL+$T}")
done
AVG=$(awk "BEGIN{printf \"%.2f\", $TOTAL/$RUNS}")
echo "  o'rtacha: ${AVG}s"

echo ""
echo "4) Tanilgan matn"
sed -n 's/.*"text":"\([^"]*\)".*/  \1/p' "$OUT" | head -c 500
echo ""
echo ""
echo "IZOH: 1-so'rov keyingilaridan 2+ barobar sekin bo'lsa —"
echo "      xotira tanqisligi (swap) bor. free -h bilan tekshiring."
echo ""
rm -f "$OUT"
