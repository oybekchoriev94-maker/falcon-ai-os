#!/bin/bash
# ============================================================
# Falcon AI OS — Start Local Models (Linux/Mac)
# ============================================================
echo -e "\n[1/3] Ollama (Qwen 2.5 7B)..."
ollama serve > /dev/null 2>&1 &
sleep 3

echo "[2/3] whisper.cpp (large-v3-turbo / CUDA)..."
./whisper.cpp/build/bin/server \
  -m ./whisper.cpp/models/ggml-large-v3-turbo.bin \
  --port 8081 --host 0.0.0.0 -t 6 -p 4 > /dev/null 2>&1 &
sleep 2

echo "[3/3] Edge-TTS (O'zbekcha ovoz)..."
node ./ai/engines/edge-tts-server.js > /dev/null 2>&1 &

echo -e "\n✅ Lokal modellar ishga tushdi!"
echo "   Ollama:  http://localhost:11434"
echo "   Whisper: http://localhost:8081"
echo "   TTS:     http://localhost:50081"
echo -e "\nFalcon AI OS ni ishga tushiring: npm start"
