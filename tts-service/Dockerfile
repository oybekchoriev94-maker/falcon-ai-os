# ============================================================
# TTS xizmati (OmniVoice) — CPU varianti (zaxira / test)
#
# Asosiy variant GPU'da ishlaydi (Dockerfile.gpu) — klinikadagi
# kompyuterda, xuddi stt-service kabi. CPU'da OmniVoice sekin
# (RTF ~1+), lekin navbat e'loni qisqa bo'lgani uchun zaxira
# sifatida yetarli: GPU o'chsa ovoz BUTUNLAY to'xtamaydi.
#
# Model ilk ishga tushishda HuggingFace'dan tortiladi (~2-3GB).
# Keyin HF_HOME papkasi keshlanadi.
# ============================================================
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl libsndfile1 && rm -rf /var/lib/apt/lists/*

# Avval CPU-only PyTorch (kichik), keyin omnivoice — aks holda pip
# CUDA'li (~2.5GB) torch'ni tortib oladi.
RUN pip install --no-cache-dir torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir "omnivoice" soundfile fastapi uvicorn

WORKDIR /app
COPY server.py .

EXPOSE 8082

ENV DEVICE=cpu \
    HF_HOME=/cache/hf

CMD ["python", "server.py"]
