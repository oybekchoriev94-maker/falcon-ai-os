import os
import sys
import asyncio
import tempfile
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("MODEL_NAME", "hostmepanda/whisper-large-v3-turbo-uzbek-ct2")
MODEL_DIR = os.getenv("MODEL_DIR", "/cache")
DEVICE = os.getenv("DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("COMPUTE_TYPE", "int8")
BEAM_SIZE = int(os.getenv("BEAM_SIZE", "3"))
# CPU-og'ir ishni cheklash: bir vaqtda nechta transkripsiya bajarilsin
MAX_CONCURRENCY = int(os.getenv("STT_CONCURRENCY", "2"))
# Audio hajmi chegarasi (OOM/DoS himoyasi)
MAX_AUDIO_MB = int(os.getenv("MAX_AUDIO_MB", "25"))

model: WhisperModel | None = None
_sem: asyncio.Semaphore | None = None


def download_model():
    from huggingface_hub import snapshot_download
    dest = os.path.join(MODEL_DIR, MODEL_NAME.replace("/", "--"))
    if os.path.exists(os.path.join(dest, "model.bin")):
        print(f"Model already cached at {dest}", flush=True)
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
    global model, _sem
    _sem = asyncio.Semaphore(MAX_CONCURRENCY)
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


@app.get("/health")
async def health():
    ready = model is not None
    return JSONResponse(
        status_code=200 if ready else 503,
        content={"status": "ok" if ready else "loading", "model": MODEL_NAME, "device": DEVICE},
    )


def _run_transcribe(tmp_path: str, language: str, temperature: float, prompt: str) -> str:
    """Bloklovchi CPU ishi — alohida threadda bajariladi (event loop bloklanmasin)."""
    segments, _info = model.transcribe(
        tmp_path,
        language=language or "uz",
        task="transcribe",
        beam_size=BEAM_SIZE,
        temperature=temperature,
        vad_filter=True,
        # Tibbiy atamalar bo'yicha modelni yo'naltirish (avval e'tiborsiz qolar edi)
        initial_prompt=prompt or None,
    )
    return " ".join(s.text for s in segments).strip()


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    response_format: str = Form("json"),
    language: str = Form(None),
    temperature: float = Form(0.0),
    prompt: str = Form(""),
):
    if model is None:
        raise HTTPException(503, "Model hali yuklanmagan")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(400, "Bo'sh audio")
    if len(audio_bytes) > MAX_AUDIO_MB * 1024 * 1024:
        raise HTTPException(413, f"Audio juda katta (maksimum {MAX_AUDIO_MB} MB)")

    suffix = os.path.splitext(file.filename or ".webm")[1] or ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        # Konkurentlikni cheklab, bloklovchi ishni threadga topshiramiz
        async with _sem:
            text = await asyncio.to_thread(_run_transcribe, tmp_path, language, temperature, prompt)
        return {"text": text}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Transkripsiya xatosi: {e}")
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
