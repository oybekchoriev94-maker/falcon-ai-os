#!/bin/bash
# ============================================================
# Falcon AI OS — Local Models Setup Script
# RTX 5070 12GB | Qwen 2.5 7B + whisper.cpp + Edge-TTS
# Windows (Git-Bash) / Linux / WSL
# ============================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║     Falcon AI OS — Local Models Setup            ║"
echo "║     RTX 5070 12GB | i5-14400 | 32GB DDR5        ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ─────────────────────────────────────────────────
# 1. Ollama (LLM)
# ─────────────────────────────────────────────────
echo -e "\n${YELLOW}[1/6] Ollama — Local LLM${NC}"

if command -v ollama &> /dev/null; then
  echo -e "  ${GREEN}✅ Ollama allaqachon o'rnatilgan${NC}"
else
  echo -e "  ${CYAN}→ Ollama o'rnatilmoqda...${NC}"
  if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    # Windows (git-bash) — winget orqali
    winget install Ollama.Ollama 2>/dev/null || {
      echo -e "  ${RED}✗ winget muvaffaqiyatsiz. https://ollama.com/download dan qo'lda o'rnating${NC}"
      echo -e "  ${YELLOW}  Keyin skriptni qayta ishga tushiring.${NC}"
    }
  elif [[ "$OSTYPE" == "darwin"* ]]; then
    curl -fsSL https://ollama.com/install.sh | sh
  else
    curl -fsSL https://ollama.com/install.sh | sh
  fi
fi

# Ollama ishlayotganini tekshirish
echo -e "  ${CYAN}→ Qwen 2.5 7B modeli yuklanmoqda (6.5GB)...${NC}"
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo -e "  ${YELLOW}  ⚠ Ollama serveri ishga tushmagan. Skriptdan keyin qo'lda:${NC}"
  echo -e "  ${YELLOW}    ollama serve &${NC}"
fi
ollama pull qwen2.5:7b 2>/dev/null || echo -e "  ${YELLOW}  ⚠ 'ollama pull qwen2.5:7b' ni keyin qo'lda bajaring${NC}"

# ─────────────────────────────────────────────────
# 2. whisper.cpp (STT)
# ─────────────────────────────────────────────────
echo -e "\n${YELLOW}[2/6] whisper.cpp — Local STT (GPU/CUDA)${NC}"

WHISPER_DIR="$SCRIPT_DIR/whisper.cpp"

if [ -d "$WHISPER_DIR/build/bin" ] && [ -f "$WHISPER_DIR/build/bin/server" ]; then
  echo -e "  ${GREEN}✅ whisper.cpp allaqachon qurilgan${NC}"
elif [ -d "$WHISPER_DIR" ]; then
  echo -e "  ${CYAN}→ whisper.cpp qurilmoqda (CUDA)...${NC}"
  cd "$WHISPER_DIR"
  cmake -B build -DGGML_CUDA=ON
  cmake --build build --config Release -j
  cd "$SCRIPT_DIR"
else
  echo -e "  ${CYAN}→ whisper.cpp clone qilinmoqda...${NC}"
  git clone https://github.com/ggerganov/whisper.cpp.git
  cd whisper.cpp
  cmake -B build -DGGML_CUDA=ON
  cmake --build build --config Release -j
  cd "$SCRIPT_DIR"
fi

# Model yuklash
echo -e "  ${CYAN}→ Whisper large-v3-turbo modeli yuklanmoqda (~800MB)...${NC}"
if [ -f "$WHISPER_DIR/models/ggml-large-v3-turbo.bin" ]; then
  echo -e "  ${GREEN}  ✅ Model allaqachon mavjud${NC}"
else
  cd "$WHISPER_DIR"
  bash models/download-ggml-model.sh large-v3-turbo
  cd "$SCRIPT_DIR"
fi

# ─────────────────────────────────────────────────
# 3. Edge-TTS npm paketi
# ─────────────────────────────────────────────────
echo -e "\n${YELLOW}[3/6] Edge-TTS — Local TTS (O'zbek tili)${NC}"

if npm list edge-tts > /dev/null 2>&1; then
  echo -e "  ${GREEN}✅ edge-tts npm paketi o'rnatilgan${NC}"
else
  echo -e "  ${CYAN}→ edge-tts o'rnatilmoqda...${NC}"
  npm install edge-tts
  echo -e "  ${GREEN}  ✅ edge-tts o'rnatildi${NC}"
fi

# ─────────────────────────────────────────────────
# 4. Environment Configuration
# ─────────────────────────────────────────────────
echo -e "\n${YELLOW}[4/6] Environment Configuration (.env.local)${NC}"

if [ ! -f ".env.local" ]; then
  cat > .env.local << 'EOF'
# ============================================================
# Falcon AI OS — Local Mode Configuration
# LOCAL_ONLY=true  → cloud API kalitlarisiz ishlaydi
# LOCAL_ONLY=false → Ollama/whisper tushsa cloud ga o'tadi
# ============================================================
LOCAL_ONLY=true

# Ollama model (default: qwen2.5:7b)
OLLAMA_MODEL=qwen2.5:7b

# whisper.cpp server
WHISPER_CPP_URL=http://localhost:8081

# Edge-TTS server
EDGE_TTS_PORT=50081

# (Ixtiyoriy) Python edge-tts o'rnatilgan bo'lsa:
# pip install edge-tts
EOF
  echo -e "  ${GREEN}✅ .env.local yaratildi${NC}"
else
  echo -e "  ${YELLOW}  ⚠ .env.local allaqachon mavjud, o'zgartirilmadi${NC}"
fi

# ─────────────────────────────────────────────────
# 5. Start Services (shortcuts)
# ─────────────────────────────────────────────────
echo -e "\n${YELLOW}[5/6] Start Scripts${NC}"

# Windows .bat start fayli
cat > start-local-models.bat << 'BATBAT'
@echo off
echo ============================================
echo   Falcon AI OS — Local Models
echo   RTX 5070 12GB
echo ============================================
echo.

:: 1. Ollama
echo [1/3] Ollama (Qwen 2.5 7B)...
start /B "" "C:\Users\%USERNAME%\AppData\Local\Programs\Ollama\ollama.exe" serve > nul 2>&1
timeout /t 3 /nobreak > nul

:: 2. whisper.cpp
echo [2/3] whisper.cpp (large-v3-turbo / CUDA)...
start /B "" "%~dp0whisper.cpp\build\bin\server.exe" -m "%~dp0whisper.cpp\models\ggml-large-v3-turbo.bin" --port 8081 --host 0.0.0.0 -t 6 -p 4 > nul 2>&1
timeout /t 2 /nobreak > nul

:: 3. Edge-TTS
echo [3/3] Edge-TTS (O'zbekcha ovoz)...
start /B "" "%~dp0node_modules\.bin\node" "%~dp0ai\engines\edge-tts-server.js" > nul 2>&1

echo.
echo ✅ Barcha lokal modellar ishga tushdi!
echo    Ollama:  http://localhost:11434
echo    Whisper: http://localhost:8081
echo    TTS:     http://localhost:50081
echo.
echo ⏎ Falcon AI OS ni ishga tushiring: npm start
pause
BATBAT
echo -e "  ${GREEN}✅ start-local-models.bat yaratildi${NC}"

# ─────────────────────────────────────────────────
# 6. Summary
# ─────────────────────────────────────────────────
echo -e "\n${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║  ✅ O'RNATISH TUGADI!                            ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  📍 Modellar:                                    ║"
echo "║    Ollama       → qwen2.5:7b (6.5GB VRAM)       ║"
echo "║    whisper.cpp  → large-v3-turbo (1.5GB VRAM)   ║"
echo "║    Edge-TTS     → uzbek/russian (CPU)            ║"
echo "║                                                  ║"
echo "║  ⚡ Ishga tushirish:                              ║"
echo "║    1. start-local-models.bat (yoki .sh)          ║"
echo "║    2. npm start                                  ║"
echo "║                                                  ║"
echo "║  🔧 .env.local da LOCAL_ONLY=true                ║"
echo "║     (cloud API kalitlari shart emas!)            ║"
echo "║                                                  ║"
echo "║  🎯 GPU: RTX 5070 12GB                           ║"
echo "║     LLM: 6.5GB | STT: 1.5GB | Bo'sh: 4GB       ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
