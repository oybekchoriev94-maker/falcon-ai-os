FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=120s \
  CMD curl -sf http://localhost:8082/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8082"]
