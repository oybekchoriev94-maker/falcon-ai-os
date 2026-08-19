FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir faster-whisper fastapi uvicorn python-multipart

# HuggingFace'dagi XOM (transformers/safetensors) Whisper checkpointlarni
# CTranslate2 formatiga bir martalik o'girish uchun (server.py:_convert_to_ct2).
# Bu MODEL_NAME ni istalgan Whisper fine-tune'ga (masalan rubaiSTT) o'zgartirib,
# qayta build qilmasdan almashtirish imkonini beradi. CPU-only torch —
# konvertatsiya faqat vazn formatini almashtiradi, GPU shart emas.
RUN pip install --no-cache-dir "ctranslate2>=4.0" "transformers>=4.40" sentencepiece \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

WORKDIR /app
COPY server.py .

EXPOSE 8081

CMD ["python", "server.py"]
