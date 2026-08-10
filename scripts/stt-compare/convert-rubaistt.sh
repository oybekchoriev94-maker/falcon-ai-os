#!/usr/bin/env bash
# ============================================================
# rubaiSTT v2 medium -> CTranslate2 (faster-whisper formati)
#
# Nega kerak: model HuggingFace'da safetensors (transformers)
# formatida. Bizning stack faster-whisper = CTranslate2.
#
# DIQQAT: repoda tokenizer.json YO'Q (faqat vocab.json + merges.txt).
# faster-whisper uni kutadi, shuning uchun avval transformers bilan
# "fast" tokenizer yasab, keyin o'giramiz.
# ============================================================
set -euo pipefail

SRC="islomov/rubaistt_v2_medium"
OUT="${1:-./models/rubaistt-v2-medium-ct2}"
# GPU uchun float16, CPU uchun int8. Klinika kompyuterida GPU bor.
QUANT="${2:-float16}"

echo "==> Kerakli paketlar"
pip install --quiet --upgrade "ctranslate2>=4.0" "transformers>=4.40" torch sentencepiece

echo "==> Tokenizer tayyorlash (repoda tokenizer.json yo'q)"
TOKDIR="$(mktemp -d)"
python - "$SRC" "$TOKDIR" <<'PY'
import sys
from transformers import WhisperTokenizerFast, WhisperProcessor
src, out = sys.argv[1], sys.argv[2]
# Fast tokenizer vocab.json + merges.txt dan yasaladi va tokenizer.json
# sifatida saqlanadi — CTranslate2 aynan shuni qidiradi.
WhisperTokenizerFast.from_pretrained(src).save_pretrained(out)
WhisperProcessor.from_pretrained(src).save_pretrained(out)
print("tokenizer tayyor:", out)
PY

echo "==> CTranslate2 ga o'girish ($QUANT)"
ct2-transformers-converter \
  --model "$SRC" \
  --output_dir "$OUT" \
  --quantization "$QUANT" \
  --copy_files preprocessor_config.json tokenizer_config.json special_tokens_map.json \
  --force

# Tokenizer fayllarini natija papkasiga ko'chiramiz
cp -f "$TOKDIR/tokenizer.json" "$OUT/" 2>/dev/null || true
cp -f "$TOKDIR/preprocessor_config.json" "$OUT/" 2>/dev/null || true
rm -rf "$TOKDIR"

echo ""
echo "Tayyor: $OUT"
ls -la "$OUT"
echo ""
echo "Sinash:"
echo "  python compare.py --audio ./audio --lang uz --model-b $OUT"
