#!/usr/bin/env bash
# ============================================================
# 4-QADAM — STT'ni GPU'da xizmat sifatida ishga tushirish
#
# FAQAT 3-qadamdagi o'lchov natijasi ijobiy bo'lsa bajaring.
#
#   ./04-serve-gpu.sh                 # rubaiSTT (nomzod)
#   ./04-serve-gpu.sh --current       # hozirgi model (turbo)
#   ./04-serve-gpu.sh --stop
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="falcon-stt"
PORT=8081
MODELS_DIR="$(pwd)/models"

if [[ "${1:-}" == "--stop" ]]; then
  docker rm -f "$NAME" 2>/dev/null && echo "To'xtatildi" || echo "Ishlamayotgan edi"
  exit 0
fi

# Sukut bo'yicha nomzod model; --current bilan hozirgisi
if [[ "${1:-}" == "--current" ]]; then
  MODEL_ENV="hostmepanda/whisper-large-v3-turbo-uzbek-ct2"
  USE_PROMPT=false
  echo "Model: hozirgi (turbo, HuggingFace'dan yuklanadi)"
else
  [[ -d "$MODELS_DIR/rubaistt-v2-medium-ct2" ]] || {
    echo "✗ $MODELS_DIR/rubaistt-v2-medium-ct2 yo'q. Avval 02-convert-model.sh"
    exit 1
  }
  MODEL_ENV="/models/rubaistt-v2-medium-ct2"
  # 3-qadamda prompt ishlagani tasdiqlangan bo'lsa true qoldiring
  USE_PROMPT="${STT_USE_PROMPT:-true}"
  echo "Model: rubaiSTT v2 medium (lokal)"
fi

echo "==> Konteyner qurish (CUDA)"
docker build -f "$REPO_ROOT/stt-service/Dockerfile.gpu" \
             -t falcon-stt:gpu "$REPO_ROOT/stt-service"

echo "==> Eskisini to'xtatish"
docker rm -f "$NAME" 2>/dev/null || true

echo "==> Ishga tushirish"
# 127.0.0.1 ga bog'laymiz — port to'g'ridan-to'g'ri tarmoqqa OCHILMAYDI.
# Tashqaridan kirish faqat Cloudflare Tunnel orqali, autentifikatsiya bilan.
docker run -d --name "$NAME" \
  --gpus all \
  --restart unless-stopped \
  -p 127.0.0.1:${PORT}:8081 \
  -e MODEL_NAME="$MODEL_ENV" \
  -e MODEL_DIR=/cache \
  -e DEVICE=cuda \
  -e COMPUTE_TYPE=float16 \
  -e STT_USE_PROMPT="$USE_PROMPT" \
  -e STT_CONCURRENCY=2 \
  -e MAX_AUDIO_MB=25 \
  -v "$MODELS_DIR":/models:ro \
  -v falcon-stt-cache:/cache \
  falcon-stt:gpu

echo "==> Yuklanishini kutamiz (model VRAM'ga chiqadi)"
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo ""
    echo "✓ Tayyor: http://127.0.0.1:${PORT}"
    curl -s "http://127.0.0.1:${PORT}/health"; echo
    nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader | sed 's/^/  VRAM: /'
    cat <<'NEXT'

------------------------------------------------------------
Sinash (audio bilan):
  curl -F "file=@test.wav" -F "language=uz" http://127.0.0.1:8081/transcribe

Loglar:
  docker logs -f falcon-stt

VPS'ni bunga ulash uchun Cloudflare Tunnel kerak — README'ga qarang.
DIQQAT: port 127.0.0.1 ga bog'langan, tarmoqqa ochiq EMAS. Tunnelsiz
tashqaridan kirib bo'lmaydi — bu ataylab shunday.
------------------------------------------------------------
NEXT
    exit 0
  fi
  sleep 3
done

echo "✗ 3 daqiqada ko'tarilmadi. Loglar:"
docker logs --tail 40 "$NAME"
exit 1
