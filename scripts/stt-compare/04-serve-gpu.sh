#!/usr/bin/env bash
# ============================================================
# 4-QADAM — Yangi modelni GPU'da YONMA-YON ishga tushirish
#
# MUHIM: mavjud STT'ga TEGMAYDI.
#   Eski (compose, CPU, turbo)  -> port 8081, konteyner "stt"
#   Yangi (GPU, rubaiSTT)       -> port 8082, konteyner "falcon-stt-gpu"
#
# Ikkalasi bir vaqtda ishlaydi. Klinika ishi to'xtamaydi, xohlagan
# paytda solishtirasiz, faqat natija ijobiy bo'lsa o'tasiz.
#
#   ./04-serve-gpu.sh              # yangi model, 8082-portda
#   ./04-serve-gpu.sh --stop
#   ./04-serve-gpu.sh --logs
#   PORT=8083 ./04-serve-gpu.sh    # boshqa port kerak bo'lsa
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAME="${NAME:-falcon-stt-gpu}"      # eski "stt" dan ATAYLAB boshqa
PORT="${PORT:-8082}"                # eski 8081 dan ATAYLAB boshqa
MODELS_DIR="$(pwd)/models"

case "${1:-}" in
  --stop)
    docker rm -f "$NAME" 2>/dev/null && echo "To'xtatildi: $NAME" || echo "Ishlamayotgan edi"
    echo "Eski STT (8081) tegilmadi."
    exit 0 ;;
  --logs)
    exec docker logs -f "$NAME" ;;
esac

# ── Eskisini buzmasligimizni tekshiramiz ────────────────────
if [[ "$PORT" == "8081" ]]; then
  echo "✗ 8081 — bu eski STT'ning porti. Boshqa port tanlang (sukut: 8082)."
  exit 1
fi
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  echo "✗ $PORT band. Boshqa port: PORT=8083 ./04-serve-gpu.sh"
  exit 1
fi
if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "! '$NAME' allaqachon bor — o'chirib qayta yaratamiz (eski STT'ga tegilmaydi)"
fi

[[ -d "$MODELS_DIR/rubaistt-v2-medium-ct2" ]] || {
  echo "✗ $MODELS_DIR/rubaistt-v2-medium-ct2 yo'q."
  echo "  Avval: ./02-convert-model.sh ./models/rubaistt-v2-medium-ct2 float16"
  exit 1
}

docker run --rm --gpus all nvidia/cuda:12.2.2-base-ubuntu22.04 nvidia-smi >/dev/null 2>&1 || {
  echo "✗ Docker GPU'ni ko'rmayapti. Avval: ./01-ubuntu-setup.sh"
  exit 1
}

echo "==> Konteyner qurish (CUDA)"
docker build -q -f "$REPO_ROOT/stt-service/Dockerfile.gpu" \
             -t falcon-stt:gpu "$REPO_ROOT/stt-service"

docker rm -f "$NAME" 2>/dev/null || true

echo "==> Ishga tushirish: $NAME, port $PORT (GPU)"
# 127.0.0.1 ga bog'laymiz — tarmoqqa OCHILMAYDI. Tashqi kirish faqat
# Cloudflare Tunnel + autentifikatsiya orqali bo'lishi kerak.
docker run -d --name "$NAME" \
  --gpus all \
  --restart unless-stopped \
  -p "127.0.0.1:${PORT}:8081" \
  -e MODEL_NAME=/models/rubaistt-v2-medium-ct2 \
  -e MODEL_DIR=/cache \
  -e DEVICE=cuda \
  -e COMPUTE_TYPE=float16 \
  -e STT_USE_PROMPT="${STT_USE_PROMPT:-true}" \
  -e STT_CONCURRENCY=2 \
  -e MAX_AUDIO_MB=25 \
  -v "$MODELS_DIR":/models:ro \
  -v falcon-stt-gpu-cache:/cache \
  falcon-stt:gpu >/dev/null

echo "==> Model VRAM'ga chiqishini kutamiz"
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo ""
    echo "✓ YANGI (GPU):  http://127.0.0.1:${PORT}  — $(curl -s http://127.0.0.1:${PORT}/health)"
    if curl -sf --max-time 3 http://127.0.0.1:8081/health >/dev/null 2>&1; then
      echo "✓ ESKI (CPU):   http://127.0.0.1:8081  — hali ham ishlayapti"
    else
      echo "! ESKI (8081):  javob bermadi — tekshiring: docker compose ps"
    fi
    nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader | sed 's/^/  VRAM: /'
    cat <<NEXT

------------------------------------------------------------
Ikkalasini bir audioda sinash:

  curl -F "file=@test.wav" -F "language=uz" http://127.0.0.1:8081/transcribe  # eski
  curl -F "file=@test.wav" -F "language=uz" http://127.0.0.1:${PORT}/transcribe  # yangi

Loglar:   ./04-serve-gpu.sh --logs
To'xtatish: ./04-serve-gpu.sh --stop   (eski tegilmaydi)

Klinika ishi 8081'da davom etyapti — hech narsa to'xtamadi.
------------------------------------------------------------
NEXT
    exit 0
  fi
  sleep 3
done

echo "✗ 3 daqiqada ko'tarilmadi. Loglar:"
docker logs --tail 40 "$NAME"
exit 1
