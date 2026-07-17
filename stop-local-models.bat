@echo off
:: ============================================================
:: Falcon AI OS — Stop Local Models
:: ============================================='=================
echo.
echo [x] Ollama to'xtatilmoqda...
taskkill /F /IM ollama.exe > nul 2>&1

echo [x] whisper.cpp to'xtatilmoqda...
taskkill /F /IM server.exe > nul 2>&1

echo [x] Edge-TTS to'xtatilmoqda...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq edge-tts" > nul 2>&1

echo.
echo ✅ Barcha lokal modellar to'xtatildi.
pause
