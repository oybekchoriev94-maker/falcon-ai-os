FROM python:3.11-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 curl unzip && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download and extract buffalo_l model
RUN MODEL_DIR=/root/.insightface/models/buffalo_l && \
    mkdir -p $MODEL_DIR && \
    curl -sL -o /tmp/buffalo_l.zip \
      https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip && \
    unzip -o /tmp/buffalo_l.zip -d $MODEL_DIR && \
    rm /tmp/buffalo_l.zip && \
    ls -la $MODEL_DIR && \
    echo "Model files: $(ls $MODEL_DIR)"

COPY server.py .

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
  CMD curl -sf http://localhost:8082/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8082"]

EXPOSE 8082

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=120s \
  CMD curl -sf http://localhost:8082/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8082"]
