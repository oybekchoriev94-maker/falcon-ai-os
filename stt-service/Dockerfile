FROM python:3.11-slim

RUN pip install --no-cache-dir faster-whisper fastapi uvicorn python-multipart

WORKDIR /app
COPY server.py .

EXPOSE 8081

CMD ["python", "server.py"]
