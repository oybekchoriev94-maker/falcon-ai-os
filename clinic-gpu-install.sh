#!/usr/bin/env bash
# ============================================================
# Falcon AI OS — klinika GPU kompyuteri uchun BITTA o'rnatuvchi.
#
# Shu bitta skript ikkala GPU xizmatini sozlaydi:
#   1. Vision Edge  — NVR kamera nazorati (vision-edge-client/)
#   2. Omni Voice TTS — navbat ovoz e'loni (tts-service/)
#
# Talab: Ubuntu 22.04+, NVIDIA GPU (masalan RTX 2060 SUPER),
# repo shu kompyuterda `git clone` qilingan bo'lishi kerak.
#
# Ishlatish:
#   cd falcon-ai-os
#   sudo bash clinic-gpu-install.sh
#
# Skript FAQAT tizim darajasidagi o'rnatish va bo'sh konfiguratsiya
# fayllarini tayyorlaydi — haqiqiy qiymatlarni (NVR IP, kamera
# ro'yxati, edge signing key) siz alohida to'ldirasiz (quyida
# skript oxirida aniq ko'rsatiladi).
# ============================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Bu skript root huquqi bilan ishga tushirilishi kerak: sudo bash clinic-gpu-install.sh"
  exit 1
fi

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REAL_USER="${SUDO_USER:-$(whoami)}"
REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)

log()  { echo -e "\n\033[1;36m==> $1\033[0m"; }
warn() { echo -e "\033[1;33m! $1\033[0m"; }
fail() { echo -e "\033[1;31mXATO: $1\033[0m"; exit 1; }

# ── 0. GPU tekshiruvi ────────────────────────────────────────
log "NVIDIA GPU tekshirilmoqda..."
if ! command -v nvidia-smi &> /dev/null; then
  fail "nvidia-smi topilmadi. Avval NVIDIA drayverni o'rnating (ubuntu-drivers autoinstall), so'ng qayta ishga tushiring."
fi
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader

# ── 1. Tizim paketlari ───────────────────────────────────────
log "Tizim paketlari o'rnatilmoqda (apt)..."
apt-get update -qq
apt-get install -y --no-install-recommends \
  python3 python3-venv python3-pip ffmpeg curl ca-certificates gnupg lsb-release

if ! command -v docker &> /dev/null; then
  log "Docker o'rnatilmoqda..."
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "$REAL_USER"
  warn "Docker guruhiga qo'shildingiz — to'liq kuchga kirishi uchun qayta login qiling."
fi

# ── 2. nvidia-container-toolkit (Docker'ga GPU kirishi) ──────
if ! docker info 2>/dev/null | grep -qi nvidia; then
  log "nvidia-container-toolkit o'rnatilmoqda..."
  distribution=$(. /etc/os-release; echo "$ID$VERSION_ID")
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update -qq
  apt-get install -y nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
  log "Tekshirish: docker run --rm --gpus all nvidia/cuda:12.8.0-base-ubuntu22.04 nvidia-smi"
fi

# ── 3. Vision Edge — Python venv ─────────────────────────────
log "Vision Edge sozlanmoqda..."
cd "$REPO_DIR/vision-edge-client"
sudo -u "$REAL_USER" python3 -m venv venv
sudo -u "$REAL_USER" venv/bin/pip install --upgrade pip -q
sudo -u "$REAL_USER" venv/bin/pip install -r requirements.txt -q
sudo -u "$REAL_USER" venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cu121 -q
[[ -f .env ]] || sudo -u "$REAL_USER" cp .env.example .env
[[ -f cameras.yaml ]] || sudo -u "$REAL_USER" cp cameras.example.yaml cameras.yaml
mkdir -p /var/lib/falcon-vision-edge
chown "$REAL_USER":"$REAL_USER" /var/lib/falcon-vision-edge

id -u falcon-edge &>/dev/null || useradd -r -s /usr/sbin/nologin falcon-edge
chown -R falcon-edge:falcon-edge "$REPO_DIR/vision-edge-client" /var/lib/falcon-vision-edge
sed "s#/opt/falcon-vision-edge#$REPO_DIR/vision-edge-client#g" \
  "$REPO_DIR/vision-edge-client/falcon-vision-edge.service" > /etc/systemd/system/falcon-vision-edge.service
log "Vision Edge tayyor (hali ishga tushirilmagan — .env/cameras.yaml to'ldirilishi kerak)"

# ── 4. Omni Voice TTS — Docker GPU konteyner ─────────────────
log "Omni Voice TTS sozlanmoqda..."
cd "$REPO_DIR/tts-service"
[[ -f .env ]] || cp .env.example .env
TTS_TOKEN=$(openssl rand -hex 24)
if grep -q '^TTS_AUTH_TOKEN=$' .env; then
  sed -i "s#^TTS_AUTH_TOKEN=.*#TTS_AUTH_TOKEN=$TTS_TOKEN#" .env
fi
chown "$REAL_USER":"$REAL_USER" .env
docker compose build
docker compose up -d
log "Omni Voice TTS ishga tushdi (http://127.0.0.1:8082, faqat lokal)"

# ── 5. Vision Edge systemd (avtomatik ishga tushirilmaydi — .env kerak) ──
systemctl daemon-reload
systemctl enable falcon-vision-edge

# ── Yakuniy hisobot ───────────────────────────────────────────
cat <<EOF

============================================================
 O'RNATISH TUGADI — QOLGAN QO'LDA BAJARILADIGAN QADAMLAR
============================================================

1) VISION EDGE — kamera nazorati:
   a) VPS admin panelida (yoki scripts/provision-edge-node.js orqali)
      Edge node yarating, key_id/signing_key oling.
   b) To'ldiring: $REPO_DIR/vision-edge-client/.env
      (FALCON_KEY_ID, FALCON_SIGNING_KEY, NVR_HOST, NVR_USER, NVR_PASSWORD)
   c) To'ldiring: $REPO_DIR/vision-edge-client/cameras.yaml
   d) Ishga tushiring: systemctl start falcon-vision-edge
      Kuzatish:          journalctl -u falcon-vision-edge -f

2) OMNI VOICE TTS — navbat ovoz e'loni:
   a) Bu token faqat hozir ko'rsatiladi, saqlab qo'ying:
        TTS_AUTH_TOKEN=$TTS_TOKEN
   b) Cloudflare Tunnel o'rnating (tashqi internetdan xavfsiz kirish uchun):
        curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | gpg --dearmor -o /usr/share/keyrings/cloudflare-main.gpg
        echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \\
          | tee /etc/apt/sources.list.d/cloudflared.list
        apt-get update && apt-get install -y cloudflared
        cloudflared tunnel login
        cloudflared tunnel create falcon-tts
        # DNS: cloudflared tunnel route dns falcon-tts tts.SIZNING-DOMENINGIZ.uz
        # Config (~/.cloudflared/config.yml): ingress -> service: http://127.0.0.1:8082
        cloudflared service install
   c) VPS'da .env ga qo'shing:
        TTS_URL=https://tts.SIZNING-DOMENINGIZ.uz
        TTS_AUTH_TOKEN=$TTS_TOKEN
      va 'docker compose up -d --force-recreate app' bilan qayta ishga tushiring.

3) FACE ID (agar shu kompyuterda emas, alohida Windows kompyuterda
   bo'lsa) — alohida o'rnatiladi:
      agent/attendance/install.ps1  (Windows PC'da)

Batafsil: docs/ORnatish-QOLLANMASI.md, vision-edge-client/README.md
============================================================
EOF
