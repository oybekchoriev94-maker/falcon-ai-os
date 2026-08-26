#!/usr/bin/env bash
# ============================================================
# 3-QADAM — Ikkala modelni haqiqiy klinika audiosida solishtirish
#
#   ./03-compare.sh uz          # o'zbekcha
#   ./03-compare.sh ru          # ruscha — ENG MUHIM SINOV
#   ./03-compare.sh uz prompt   # tibbiy prompt bilan
#
# Audio qayerdan: ./audio-uz/ va ./audio-ru/ papkalari.
# Aniqlikni raqamda ko'rish uchun har audio yoniga etalon matn:
#   audio-uz/001.wav + audio-uz/001.txt
# ============================================================
set -euo pipefail

LANG_CODE="${1:-uz}"
MODE="${2:-}"

MODEL_A="hostmepanda/whisper-large-v3-turbo-uzbek-ct2"   # hozirgi
MODEL_B="./models/rubaistt-v2-medium-ct2"                # nomzod
AUDIO="./audio-${LANG_CODE}"
OUT="natija-${LANG_CODE}${MODE:+-$MODE}.md"

[[ "$LANG_CODE" =~ ^(uz|ru)$ ]] || { echo "Til faqat uz yoki ru"; exit 1; }

if [[ -z "${VIRTUAL_ENV:-}" ]]; then
  echo "Virtual muhit yoqilmagan. Avval:  source ~/.venv-stt/bin/activate"
  exit 1
fi

[[ -d "$AUDIO" ]] || {
  echo "✗ $AUDIO papkasi yo'q."
  echo "  Yarating va haqiqiy klinika yozuvlarini soling:"
  echo "    mkdir -p $AUDIO"
  echo "    # 5-10 ta yozuv, har biri 30-120 soniya"
  exit 1
}
[[ -d "$MODEL_B" ]] || {
  echo "✗ $MODEL_B yo'q. Avval: ./02-convert-model.sh $MODEL_B float16"
  exit 1
}

N=$(find "$AUDIO" -maxdepth 1 -type f \
      \( -iname '*.wav' -o -iname '*.mp3' -o -iname '*.m4a' -o -iname '*.ogg' \
         -o -iname '*.flac' -o -iname '*.webm' \) | wc -l)
[[ $N -gt 0 ]] || { echo "✗ $AUDIO ichida audio yo'q"; exit 1; }
REFS=$(find "$AUDIO" -maxdepth 1 -name '*.txt' | wc -l)

echo "Audio: $N ta · Etalon matn: $REFS ta · Til: $LANG_CODE"
[[ $REFS -eq 0 ]] && echo "! Etalon yo'q — WER hisoblanmaydi, faqat matn va tezlik"

pip install --quiet --upgrade faster-whisper

ARGS=(--audio "$AUDIO" --lang "$LANG_CODE"
      --model-a "$MODEL_A" --model-b "$MODEL_B"
      --device cuda --compute float16 --out "$OUT")
[[ $REFS -gt 0 ]] && ARGS+=(--wer)

# Tibbiy prompt sinovi — hozirgi model buni ko'tarmaydi ("zg zg z"
# chiqaradi), rubaiSTT ko'tarsa tibbiy atamalarda yutuq bo'ladi.
if [[ "$MODE" == "prompt" ]]; then
  if [[ "$LANG_CODE" == "uz" ]]; then
    ARGS+=(--prompt "Tibbiy matn. Dorilar: paratsetamol, amoksitsillin, ibuprofen, omeprazol, metformin. Qon bosimi, harorat, jigar, buyrak, oshqozon.")
  else
    ARGS+=(--prompt "Медицинский текст. Лекарства: парацетамол, амоксициллин, ибупрофен, омепразол, метформин. Артериальное давление, температура, печень, почки.")
  fi
  echo "Prompt sinovi yoqildi"
fi

python compare.py "${ARGS[@]}"

echo ""
echo "============================================================"
echo "Hisobot: $OUT"
echo "Ko'rish:  less $OUT"
echo "============================================================"
