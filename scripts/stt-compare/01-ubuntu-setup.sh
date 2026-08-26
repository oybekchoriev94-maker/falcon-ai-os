#!/usr/bin/env bash
# ============================================================
# 1-QADAM — Klinika kompyuterini STT uchun tayyorlash (Ubuntu)
#
# Mo'ljal: i5-14400F · 8 GB RAM · RTX 2060 SUPER 8 GB
#
# Bu skript IDEMPOTENT — bir necha marta ishga tushirsa bo'ladi,
# o'rnatilgan narsani qayta o'rnatmaydi. Har qadamda avval tekshiradi.
#
# Ishga tushirish:
#   chmod +x 01-ubuntu-setup.sh
#   ./01-ubuntu-setup.sh
# ============================================================
set -euo pipefail

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] && die "root bilan ishga tushirmang. Oddiy foydalanuvchi bo'ling — sudo kerak joyda o'zi so'raydi."
command -v sudo >/dev/null || die "sudo topilmadi"

# ── 0. Tizim haqida ─────────────────────────────────────────
say "0/6 · Tizim"
. /etc/os-release 2>/dev/null || die "/etc/os-release yo'q — bu Ubuntu emasmi?"
echo "   OS:   $PRETTY_NAME"
echo "   Yadro: $(uname -r)"
echo "   CPU:  $(nproc) yadro · $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs)"
echo "   RAM:  $(free -h | awk '/^Mem:/{print $2" (bo'\''sh: "$7")"}')"
echo "   Disk: $(df -h / | awk 'NR==2{print $4" bo'\''sh / "$2}')"

FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
[[ $FREE_GB -lt 20 ]] && warn "Diskda ${FREE_GB}GB bo'sh. Model + Docker uchun ~20GB tavsiya etiladi."

# ── 1. NVIDIA drayveri ──────────────────────────────────────
say "1/6 · NVIDIA drayveri"
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  ok "$(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | head -1)"
else
  warn "Drayver yo'q yoki ishlamayapti. O'rnatamiz."
  sudo apt-get update -qq
  sudo apt-get install -y ubuntu-drivers-common
  echo "   Tavsiya etilgan drayver:"
  ubuntu-drivers devices 2>/dev/null | grep -E 'recommended' || true
  sudo ubuntu-drivers autoinstall
  die "Drayver o'rnatildi. KOMPYUTERNI QAYTA YUKLANG (sudo reboot), so'ng shu skriptni qayta ishga tushiring."
fi

# ── 2. Docker ───────────────────────────────────────────────
say "2/6 · Docker"
if command -v docker >/dev/null 2>&1; then
  ok "docker $(docker --version | awk '{print $3}' | tr -d ,)"
else
  warn "Docker yo'q. Rasmiy repodan o'rnatamiz."
  sudo apt-get update -qq
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
       docker-buildx-plugin docker-compose-plugin
  ok "Docker o'rnatildi"
fi

if ! groups | grep -qw docker; then
  sudo usermod -aG docker "$USER"
  warn "Siz 'docker' guruhiga qo'shildingiz. Kuchga kirishi uchun tizimdan CHIQIB QAYTA KIRING"
  warn "(yoki: newgrp docker), so'ng skriptni qayta ishga tushiring."
  exit 0
fi
ok "docker guruhi joyida"

# ── 3. nvidia-container-toolkit ─────────────────────────────
say "3/6 · nvidia-container-toolkit (Docker GPU'ni ko'rishi uchun)"
if docker run --rm --gpus all nvidia/cuda:12.2.2-base-ubuntu22.04 nvidia-smi >/dev/null 2>&1; then
  ok "Docker GPU'ni ko'ryapti"
else
  warn "Toolkit yo'q yoki sozlanmagan. O'rnatamiz."
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list >/dev/null
  sudo apt-get update -qq
  sudo apt-get install -y nvidia-container-toolkit
  sudo nvidia-ctk runtime configure --runtime=docker
  sudo systemctl restart docker
  sleep 3
  docker run --rm --gpus all nvidia/cuda:12.2.2-base-ubuntu22.04 nvidia-smi >/dev/null 2>&1 \
    || die "Docker hali ham GPU'ni ko'rmayapti. 'sudo reboot' qilib qayta urinib ko'ring."
  ok "Docker GPU'ni ko'ryapti"
fi

# ── 4. Swap — 8 GB RAM uchun MAJBURIY ───────────────────────
# Modelni o'girishda transformers uni to'liq RAM'ga yuklaydi (~4 GB).
# 8 GB tizimda swapsiz OOM bo'lishi mumkin.
say "4/6 · Swap"
SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
if [[ $SWAP_MB -ge 7000 ]]; then
  ok "Swap ${SWAP_MB}MB — yetarli"
else
  warn "Swap ${SWAP_MB}MB. Model o'girishda 8GB RAM kam kelishi mumkin — 8GB swap qo'shamiz."
  if [[ -f /swapfile-stt ]]; then
    warn "/swapfile-stt allaqachon bor, qayta yaratmaymiz"
  else
    sudo fallocate -l 8G /swapfile-stt || sudo dd if=/dev/zero of=/swapfile-stt bs=1M count=8192
    sudo chmod 600 /swapfile-stt
    sudo mkswap /swapfile-stt
  fi
  sudo swapon /swapfile-stt 2>/dev/null || true
  grep -q '/swapfile-stt' /etc/fstab || \
    echo '/swapfile-stt none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  ok "Swap yoqildi: $(free -h | awk '/^Swap:/{print $2}')"
fi

# ── 5. Python muhiti (modelni o'girish uchun) ───────────────
say "5/6 · Python muhiti"
sudo apt-get install -y -qq python3 python3-pip python3-venv ffmpeg git
ok "python3 $(python3 --version | awk '{print $2}') · ffmpeg bor"

VENV="$HOME/.venv-stt"
if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
  ok "Virtual muhit yaratildi: $VENV"
else
  ok "Virtual muhit bor: $VENV"
fi

# ── 6. Yakuniy tekshiruv ────────────────────────────────────
say "6/6 · Yakuniy holat"
nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader | sed 's/^/   GPU: /'
echo "   Docker GPU: OK"
echo "   RAM+Swap:   $(free -h | awk '/^Mem:/{printf "%s RAM", $2} /^Swap:/{printf " + %s swap", $2}')"

cat <<'NEXT'

============================================================
TAYYOR. Keyingi qadam:

  source ~/.venv-stt/bin/activate
  ./02-convert-model.sh ./models/rubaistt-v2-medium-ct2 float16

Model ~3 GB yuklab olinadi, o'girish 5-15 daqiqa oladi.
============================================================
NEXT
