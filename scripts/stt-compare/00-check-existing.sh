#!/usr/bin/env bash
# ============================================================
# 0-QADAM — Kompyuterda NIMA BOR ekanini aniqlash
#
# Hech narsani o'zgartirmaydi, faqat o'qiydi. Klinika kompyuterida
# allaqachon STT o'rnatilgan bo'lsa, uni buzmaslik uchun avval
# holatni bilishimiz kerak.
#
#   ./00-check-existing.sh
#
# Natijani menga yuboring — keyingi qadamni shunga qarab aytaman.
# ============================================================
set -uo pipefail   # -e YO'Q: tekshiruv xato bersa ham davom etsin

say() { printf '\n\033[1;36m── %s ─────────────────────────\033[0m\n' "$*"; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
no()  { printf '  \033[33m–\033[0m %s\n' "$*"; }

say "TIZIM"
. /etc/os-release 2>/dev/null && echo "  OS:   $PRETTY_NAME"
echo "  CPU:  $(nproc) yadro"
free -h | awk '/^Mem:/{print "  RAM:  "$2" (bo'"'"'sh "$7")"}'
free -h | awk '/^Swap:/{print "  Swap: "$2}'
df -h / | awk 'NR==2{print "  Disk: "$4" bo'"'"'sh / "$2}'

say "GPU"
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version \
             --format=csv,noheader | sed 's/^/  /'
else
  no "nvidia-smi yo'q yoki ishlamayapti — GPU sozlanmagan"
fi

say "DOCKER"
if command -v docker >/dev/null 2>&1; then
  ok "$(docker --version)"
  if docker info >/dev/null 2>&1; then
    ok "docker ishlayapti (ruxsat bor)"
  else
    no "docker'ga ruxsat yo'q — 'sudo usermod -aG docker $USER' kerakmi?"
  fi
  if docker run --rm --gpus all nvidia/cuda:12.2.2-base-ubuntu22.04 \
       nvidia-smi >/dev/null 2>&1; then
    ok "Docker GPU'ni KO'RYAPTI (nvidia-container-toolkit bor)"
  else
    no "Docker GPU'ni ko'rmayapti — toolkit yo'q yoki sozlanmagan"
  fi
else
  no "Docker yo'q"
fi

say "ISHLAYOTGAN KONTEYNERLAR"
docker ps --format '  {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null \
  || no "o'qib bo'lmadi"

say "STT KONTEYNERI"
STT=$(docker ps -a --filter 'name=stt' --format '{{.Names}}' 2>/dev/null)
if [[ -n "$STT" ]]; then
  for c in $STT; do
    echo "  Konteyner: $c"
    docker inspect "$c" --format '    Holat:  {{.State.Status}}
    Image:  {{.Config.Image}}
    Port:   {{range $p, $v := .NetworkSettings.Ports}}{{$p}} -> {{range $v}}{{.HostIp}}:{{.HostPort}}{{end}} {{end}}
    GPU:    {{if .HostConfig.DeviceRequests}}BOR{{else}}yo'"'"'q (CPU){{end}}' 2>/dev/null
    echo "    Muhit:"
    docker inspect "$c" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
      | grep -E '^(MODEL_NAME|MODEL_DIR|DEVICE|COMPUTE_TYPE|STT_)' | sed 's/^/      /'
  done
else
  no "'stt' nomli konteyner yo'q"
fi

say "PORTLAR (8081, 8082)"
for p in 8081 8082; do
  if curl -sf --max-time 3 "http://127.0.0.1:$p/health" >/dev/null 2>&1; then
    printf '  \033[32m✓\033[0m %s BAND — javob: ' "$p"
    curl -s --max-time 3 "http://127.0.0.1:$p/health"; echo
  elif ss -ltn 2>/dev/null | grep -q ":$p "; then
    no "$p band, lekin /health javob bermadi"
  else
    ok "$p bo'sh"
  fi
done

say "MODEL KESHI"
for v in $(docker volume ls -q 2>/dev/null | grep -iE 'stt|cache'); do
  # :ro — o'lchash uchun yozish huquqi kerak emas, tasodifan
  # tegib ketmasligi uchun faqat o'qishga ulaymiz
  SZ=$(docker run --rm -v "$v":/v:ro alpine du -sh /v 2>/dev/null | cut -f1)
  echo "  volume $v — ${SZ:-?}"
done
[[ -d /opt/models ]] && echo "  /opt/models: $(du -sh /opt/models 2>/dev/null | cut -f1)"
[[ -d ./models ]]    && echo "  ./models:    $(du -sh ./models 2>/dev/null | cut -f1)"

say "DOCKER COMPOSE STACK"
for d in /opt/falcon-ai-os "$HOME/falcon-ai-os" .; do
  if [[ -f "$d/docker-compose.yml" ]]; then
    echo "  Topildi: $d/docker-compose.yml"
    (cd "$d" && docker compose ps --format '    {{.Name}}\t{{.Service}}\t{{.Status}}' 2>/dev/null)
    break
  fi
done

say "CLOUDFLARE TUNNEL"
if command -v cloudflared >/dev/null 2>&1; then
  ok "$(cloudflared --version 2>&1 | head -1)"
  systemctl is-active cloudflared >/dev/null 2>&1 \
    && ok "xizmat ishlayapti" || no "xizmat ishlamayapti"
  [[ -f "$HOME/.cloudflared/config.yml" ]] && {
    echo "  config.yml:"; sed 's/^/    /' "$HOME/.cloudflared/config.yml"; }
else
  no "cloudflared yo'q"
fi

cat <<'END'

============================================================
Shu natijani menga yuboring.

Reja: yangi model ESKISINI BUZMASDAN, alohida konteynerda
8082-portda GPU'da ko'tariladi. Ikkalasi bir vaqtda ishlaydi,
solishtiramiz, keyin qaysinisi yaxshi bo'lsa o'shanga o'tamiz.
============================================================
END
