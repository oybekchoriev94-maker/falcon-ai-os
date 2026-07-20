import os
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form
from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("MODEL_NAME", "sardorb3k/agiuz-stt-v4-ct2")
MODEL_DIR = os.getenv("MODEL_DIR", "/cache")
DEVICE = os.getenv("DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("COMPUTE_TYPE", "int8")

model: WhisperModel | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    print(f"Loading {MODEL_NAME} on {DEVICE} ({COMPUTE_TYPE})...", flush=True)
    model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE, download_root=MODEL_DIR)
    print("STT model ready", flush=True)
    yield
    model = None

app = FastAPI(lifespan=lifespan)

@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    response_format: str = Form("json"),
    language: str = Form(None),
    temperature: float = Form(0.0),
    prompt: str = Form(""),
):
    audio_bytes = await file.read()
    suffix = os.path.splitext(file.filename or ".webm")[1] or ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        segments, info = model.transcribe(
            tmp_path,
            language=language or "uz",
            task="transcribe",
            beam_size=3,
            temperature=temperature,
            vad_filter=True,
        )
        text = " ".join(s.text for s in segments)
        return {"text": text}
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8081)
