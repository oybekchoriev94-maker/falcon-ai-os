# ============================================================
# Falcon AI OS — TTS xizmati (OmniVoice)
#
# Navbat chaqiruvini OVOZ bilan o'qib berish uchun: kiosk TV
# /api/kiosk/queue/announce matnini oladi, shu xizmatga yuboradi,
# 24kHz WAV qaytadi va kutish zali karnayida chalinadi.
#
# stt-service bilan bir xil pattern:
#   - TTS_AUTH_TOKEN o'rnatilgan bo'lsa majburiy tekshiriladi
#     (Cloudflare Tunnel orqali ochilganda GPU himoyasi uchun)
#   - Model yuklanmasa xizmat ISHGA TUSHMAYDI (jim ishlamaydi)
#   - Til siyosati: faqat ruxsat etilgan tillar (uz, ru)
#
# OmniVoice (k2-fsa) — 600+ tilli zero-shot TTS. Ro'yxatda
# Uzbek (uz, #605) va Northern Uzbek (uzn, #429) bor. Eng stabil
# rejim — voice cloning: 3-10 soniyalik o'zbekcha reference audio
# bir marta yuklanadi (/voices), keyin hamma e'lonlar o'sha ovozda.
# ============================================================

import os
import io
import hmac
import tempfile
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

MODEL_NAME = os.getenv("TTS_MODEL", "k2-fsa/OmniVoice")
DEVICE = os.getenv("DEVICE", "")          # bo'sh = avtomatik (cuda -> cpu)
VOICES_DIR = Path(os.getenv("VOICES_DIR", "/voices"))
AUTH_TOKEN = os.getenv("TTS_AUTH_TOKEN", "").strip()
MAX_TEXT_LEN = int(os.getenv("MAX_TEXT_LEN", "500"))
MAX_REF_AUDIO_MB = 10
# Til siyosati: klinika navbati o'zbek va rus tillarida o'qiladi.
# (OmniVoice 600+ tilni biladi, lekin e'lonlar uchun aniq til kerak —
# language_id berilmasa model tili avtomatik aniqlanadi.)
ALLOWED_LANGUAGES = {"uz", "ru"}
DEFAULT_LANGUAGE = "uz"

# OmniVoice audio chiqishi 24kHz mono — WAV boshida shu yoziladi
SAMPLE_RATE = 24000

_model = None
_loaded_device = ""


def _load_model():
    """Modelni yuklaydi. Xato bo'lsa ANIQ xabar bilan yiqiladi —
    stt-service'dagi "jim ishlab ketgan noto'g'ri model" darsidan."""
    global _model, _loaded_device
    import torch
    from omnivoice import OmniVoice

    device = DEVICE
    if not device:
        device = "cuda:0" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if device.startswith("cuda") else torch.float32
    print(f"[TTS] Model yuklanmoqda: {MODEL_NAME} ({device}, {dtype})")
    _model = OmniVoice.from_pretrained(MODEL_NAME, device_map=device, dtype=dtype)
    _loaded_device = device
    print("[TTS] Model tayyor")


@asynccontextmanager
async def lifespan(app: FastAPI):
    _load_model()
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="Falcon TTS (OmniVoice)", lifespan=lifespan)


def _check_auth(authorization: str | None):
    if not AUTH_TOKEN:
        return
    supplied = ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    if not hmac.compare_digest(supplied, AUTH_TOKEN):
        raise HTTPException(status_code=401, detail="Token noto'g'ri")


def _list_voices():
    if not VOICES_DIR.exists():
        return []
    return sorted(p.stem for p in VOICES_DIR.glob("*.pt"))


class SynthRequest(BaseModel):
    text: str
    voice: str | None = None          # /voices orqali saqlangan ovoz nomi
    language: str | None = None
    speed: float = 1.0
    num_step: int = 32


class VoiceRequest(BaseModel):
    name: str                          # lotin harflari/raqamlar, masalan 'registratura'
    ref_audio_base64: str             # 3-10 soniyalik WAV
    ref_text: str | None = None       # bo'sh bo'lsa Whisper avtomatik aniqlaydi


@app.get("/health")
async def health():
    return JSONResponse({
        "success": True,
        "status": "ok",
        "model": MODEL_NAME,
        "device": _loaded_device,
        "voices": _list_voices(),
    })


@app.post("/voices")
async def save_voice(req: VoiceRequest, authorization: str | None = Header(default=None)):
    """Reference audiodan ovoz klonini yaratib saqlaydi (.pt prompt).
    Keyin /synthesize da voice='nomi' berilsa o'sha ovozda o'qiladi."""
    _check_auth(authorization)
    name = "".join(c for c in req.name if c.isalnum() or c in "-_").lower()
    if not name:
        raise HTTPException(status_code=400, detail="name kerak (lotin harflari)")
    audio_bytes = _decode_audio(req.ref_audio_base64)

    # Bloklovchi ish (model inferens) — thread'ga chiqaramiz.
    # API fayl yo'lini kutadi — vaqtinchalik WAV faylga yozamiz.
    import asyncio
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name
    try:
        prompt = await asyncio.to_thread(
            _model.create_voice_clone_prompt,
            ref_audio=tmp_path,
            ref_text=req.ref_text,
        )
    finally:
        os.unlink(tmp_path)
    out = VOICES_DIR / f"{name}.pt"
    prompt.save(str(out))
    return JSONResponse({"success": True, voice: name, voices: _list_voices()})


def _decode_audio(b64: str) -> bytes:
    import base64
    try:
        data = base64.b64decode(b64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="ref_audio_base64 noto'g'ri")
    if len(data) > MAX_REF_AUDIO_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio juda katta")
    if len(data) < 1000:
        raise HTTPException(status_code=400, detail="Audio juda qisqa (3-10 soniya kerak)")
    return data


@app.post("/synthesize")
async def synthesize(req: SynthRequest, authorization: str | None = Header(default=None)):
    """Matn -> 24kHz mono WAV. Navbat e'lonlari uchun asosiy endpoint."""
    _check_auth(authorization)
    text = (req.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text kerak")
    if len(text) > MAX_TEXT_LEN:
        raise HTTPException(status_code=400, detail=f"text juda uzun (max {MAX_TEXT_LEN})")

    language = (req.language or DEFAULT_LANGUAGE).lower()
    if language not in ALLOWED_LANGUAGES:
        raise HTTPException(status_code=400, detail="Faqat uz/ru tillari qo'llab-quvvatlanadi")

    kwargs = {"text": text, "speed": max(0.5, min(2.0, req.speed)),
              "num_step": max(8, min(64, req.num_step))}

    if req.voice:
        name = "".join(c for c in req.voice if c.isalnum() or c in "-_").lower()
        path = VOICES_DIR / f"{name}.pt"
        if not path.exists():
            raise HTTPException(status_code=404, detail=f"Ovoz topilmadi: {name}")
        from omnivoice import VoiceClonePrompt
        kwargs["voice_clone_prompt"] = VoiceClonePrompt.load(str(path))

    import asyncio
    audio = await asyncio.to_thread(_model.generate, **kwargs)
    if not audio or len(audio) == 0:
        raise HTTPException(status_code=500, detail="Model bo'sh audio qaytardi")

    import numpy as np
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, np.asarray(audio[0], dtype=np.float32), SAMPLE_RATE, format="WAV")
    return Response(content=buf.getvalue(), media_type="audio/wav")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8082"))
    uvicorn.run(app, host="0.0.0.0", port=port)
