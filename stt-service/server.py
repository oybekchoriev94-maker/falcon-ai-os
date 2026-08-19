import os
import sys
import asyncio
import tempfile
from contextlib import asynccontextmanager

import hmac

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("MODEL_NAME", "hostmepanda/whisper-large-v3-turbo-uzbek-ct2")
MODEL_DIR = os.getenv("MODEL_DIR", "/cache")
DEVICE = os.getenv("DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("COMPUTE_TYPE", "int8")
BEAM_SIZE = int(os.getenv("BEAM_SIZE", "3"))
# DIQQAT: bu fine-tuned model initial_prompt bilan ishlamaydi — prompt berilsa
# chiqish buziladi (bo'sh matn yoki "zg zg z" kabi takrorlanish). Production'da
# tekshirilgan. Shuning uchun sukut bo'yicha o'chirilgan; boshqa model
# ishlatilsa STT_USE_PROMPT=true bilan yoqish mumkin.
USE_PROMPT = os.getenv("STT_USE_PROMPT", "false").lower() == "true"
# Til siyosati: klinika faqat o'zbek va rus tillarida ishlaydi.
# Boshqa til so'ralsa rad etamiz (model uni "o'zbekcha" deb axlat matn chiqaradi).
ALLOWED_LANGUAGES = {"uz", "ru"}
DEFAULT_LANGUAGE = "uz"
# CPU-og'ir ishni cheklash: bir vaqtda nechta transkripsiya bajarilsin
MAX_CONCURRENCY = int(os.getenv("STT_CONCURRENCY", "2"))
# Audio hajmi chegarasi (OOM/DoS himoyasi)
MAX_AUDIO_MB = int(os.getenv("MAX_AUDIO_MB", "25"))

# Autentifikatsiya.
# Docker tarmog'i ichida (VPS'dagi holat) kerak emas — xizmat tashqariga
# chiqmaydi. LEKIN klinika kompyuteridagi STT Cloudflare Tunnel orqali
# internetga ochilsa, himoyasiz qolsa istalgan kishi bemor audiosini
# yuborib, klinika GPU'sidan foydalana oladi.
# Shuning uchun: STT_AUTH_TOKEN o'rnatilgan bo'lsa — majburiy tekshiriladi.
AUTH_TOKEN = os.getenv("STT_AUTH_TOKEN", "").strip()


def _check_auth(authorization: str | None):
    """Token o'rnatilmagan bo'lsa tekshirmaymiz (lokal Docker tarmog'i).
    O'rnatilgan bo'lsa — Bearer mos kelishi shart."""
    if not AUTH_TOKEN:
        return
    supplied = ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    # compare_digest — vaqt bo'yicha hujumga qarshi
    if not hmac.compare_digest(supplied, AUTH_TOKEN):
        raise HTTPException(401, "Ruxsat yo'q")

model: WhisperModel | None = None
_sem: asyncio.Semaphore | None = None


def _convert_to_ct2(repo_id: str, out_dir: str):
    """Xom (transformers/safetensors) Whisper checkpointini CTranslate2
    formatiga o'giradi — faster-whisper faqat shu formatni tushunadi.

    NEGA KERAK: ko'p Whisper fine-tune'lari (masalan rubaiSTT) HuggingFace'da
    faqat transformers formatida e'lon qilinadi, CT2 versiyasi yo'q. Buni
    ilgari qo'lda, klinika kompyuterida `scripts/stt-compare/02-convert-model.sh`
    orqali qilingan edi va natija faqat o'sha kompyuterda qolgan edi — VPS
    boshqa model kerak bo'lganda hech narsaga tayana olmasdi. Endi xizmat
    o'zi birinchi ishga tushishda o'giradi va natijani keshlaydi (MODEL_DIR),
    keyingi qayta ishga tushirishlar bir zumda bo'ladi.
    """
    import subprocess
    import shutil
    from transformers import WhisperTokenizerFast, WhisperProcessor

    print(f"'{repo_id}' CT2 formatida emas — birinchi marta o'girilmoqda "
          f"(bir necha daqiqa davom etishi mumkin)...", flush=True)

    tokdir = tempfile.mkdtemp()
    try:
        # Ko'p fine-tune repolarda tokenizer.json yo'q (faqat vocab.json +
        # merges.txt) — CTranslate2 esa aynan tokenizer.json'ni kutadi.
        WhisperTokenizerFast.from_pretrained(repo_id).save_pretrained(tokdir)
        WhisperProcessor.from_pretrained(repo_id).save_pretrained(tokdir)

        # CPU'da int8, GPU'da float16 — DEVICE ga qarab (RAM/VRAM tejash).
        quant = "int8" if DEVICE == "cpu" else "float16"
        subprocess.run(
            [
                "ct2-transformers-converter", "--model", repo_id,
                "--output_dir", out_dir, "--quantization", quant, "--force",
                "--copy_files", "preprocessor_config.json",
                "tokenizer_config.json", "special_tokens_map.json",
            ],
            check=True,
        )
        for f in ("tokenizer.json", "preprocessor_config.json"):
            src = os.path.join(tokdir, f)
            if os.path.exists(src):
                shutil.copy(src, out_dir)
    finally:
        shutil.rmtree(tokdir, ignore_errors=True)

    print(f"O'girish tugadi: {out_dir}", flush=True)


def download_model():
    # MODEL_NAME allaqachon lokal papka bo'lsa — yuklab olish shart emas.
    # Busiz `/models/rubaistt-...` kabi yo'l HuggingFace repo nomi deb
    # qabul qilinib, xizmat ishga tushmasdan yiqilardi. Aynan shu sababdan
    # klinika kompyuterida server.py qo'lda tuzatilgan va git'dan uzilib
    # qolgan edi (u yerdagi versiyada endpoint nomi ham boshqacha edi).
    if os.path.isdir(MODEL_NAME):
        print(f"Using local model directory: {MODEL_NAME}", flush=True)
        return MODEL_NAME

    os.makedirs(MODEL_DIR, exist_ok=True)
    dest = os.path.join(MODEL_DIR, MODEL_NAME.replace("/", "--"))
    ct2_dest = dest + "-ct2"

    # Avvalgi ishga tushirishda o'girilgan bo'lsa — qayta o'girmaymiz.
    if os.path.exists(os.path.join(ct2_dest, "model.bin")):
        print(f"CT2 model keshdan olindi: {ct2_dest}", flush=True)
        return ct2_dest
    if os.path.exists(os.path.join(dest, "model.bin")):
        print(f"Model keshdan olindi: {dest}", flush=True)
        return dest

    # Repo CT2 formatida bo'lishi mumkin (masalan hostmepanda'niki) —
    # avval shuni tekshiramiz, aks holda bitta modelni ikki marta
    # (xom + o'girilgan) yuklab olib, joy va vaqtni isrof qilardik.
    from huggingface_hub import HfApi, snapshot_download
    try:
        files = {f.rfilename for f in HfApi().model_info(MODEL_NAME).siblings}
    except Exception as e:
        raise RuntimeError(f"HuggingFace'dan '{MODEL_NAME}' haqida ma'lumot olib bo'lmadi: {e}")

    if "model.bin" in files:
        print(f"Downloading {MODEL_NAME} (CT2) to {dest}...", flush=True)
        path = snapshot_download(
            MODEL_NAME, cache_dir=MODEL_DIR, local_dir=dest,
            local_dir_use_symlinks=False, resume_download=True,
            ignore_patterns=["*.h5", "*.ot"],
        )
        print(f"Model downloaded to {path}", flush=True)
        return path

    # Xom (transformers) checkpoint — CT2'ga o'giramiz.
    _convert_to_ct2(MODEL_NAME, ct2_dest)
    return ct2_dest


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
        # Faqat STT_USE_PROMPT=true bo'lsa (yuqoridagi izohga qarang)
        initial_prompt=(prompt or None) if USE_PROMPT else None,
    )
    return " ".join(s.text for s in segments).strip()


# Ikkita yo'l bir xil ishlovchiga boradi:
#   /v1/audio/transcriptions — asosiy (OpenAI API bilan mos, ilova shuni ishlatadi)
#   /transcribe              — eski nom. README va 04-serve-gpu.sh shuni yozgan,
#                              klinikadagi qo'lda tuzatilgan versiyada ham shu edi.
# Faqat bittasini qoldirsak, ikki tomondan biri 404 oladi — bu allaqachon
# production'da sodir bo'lgan (ilova /v1/... yuborardi, klinika /transcribe kutardi).
@app.post("/v1/audio/transcriptions")
@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    response_format: str = Form("json"),
    language: str = Form(None),
    temperature: float = Form(0.0),
    prompt: str = Form(""),
    authorization: str | None = Header(default=None),
):
    _check_auth(authorization)

    if model is None:
        raise HTTPException(503, "Model hali yuklanmagan")

    lang = (language or DEFAULT_LANGUAGE).strip().lower()[:2]
    if lang not in ALLOWED_LANGUAGES:
        raise HTTPException(
            400,
            f"'{language}' tili qo'llab-quvvatlanmaydi. Faqat: {', '.join(sorted(ALLOWED_LANGUAGES))}",
        )

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
            text = await asyncio.to_thread(_run_transcribe, tmp_path, lang, temperature, prompt)
        return {"text": text, "language": lang}
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
