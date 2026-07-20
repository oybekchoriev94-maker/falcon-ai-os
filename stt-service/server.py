import os
import sys
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form
from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("MODEL_NAME", "sardorb3k/agiuz-stt-v4-ct2")
MODEL_DIR = os.getenv("MODEL_DIR", "/cache")
DEVICE = os.getenv("DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("COMPUTE_TYPE", "int8")

model: WhisperModel | None = None

def download_model():
    from huggingface_hub import snapshot_download
    dest = os.path.join(MODEL_DIR, MODEL_NAME.replace("/", "--"))
    if os.path.exists(os.path.join(dest, "model.bin")):
        print(f"Model already cached at {dest}")
        return dest
    print(f"Downloading {MODEL_NAME} to {dest}...", flush=True)
    os.makedirs(MODEL_DIR, exist_ok=True)
    path = snapshot_download(
        MODEL_NAME,
        cache_dir=MODEL_DIR,
        local_dir=dest,
        local_dir_use_symlinks=False,
        resume_download=True,
        ignore_patterns=["*.h5", "*.ot"],
    )
    print(f"Model downloaded to {path}", flush=True)
    return path

@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    model_path = download_model()
    print(f"Loading model from {model_path} on {DEVICE} ({COMPUTE_TYPE})...", flush=True)
    model = WhisperModel(
        model_path,
        device=DEVICE,
        compute_type=COMPUTE_TYPE,
        download_root=None,
    )
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
    if "--download-only" in sys.argv:
        download_model()
        print("Download complete")
        sys.exit(0)
    uvicorn.run(app, host="0.0.0.0", port=8081)
