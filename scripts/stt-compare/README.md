# STT modelini solishtirish va lokalga ulash

## Nega bu kerak

Hozirgi modelimiz — `hostmepanda/whisper-large-v3-turbo-uzbek-ct2`. Uning
**aniqligi hech qayerda e'lon qilinmagan** (HuggingFace'da 88 ta yuklab
olish, 1 ta like). Ya'ni o'z bazaviy darajamizni bilmaymiz.

Nomzod — `islomov/rubaistt_v2_medium` (rubaiSTT v2). WER ~17% deb
aytilgan, whitepaper va o'qitish skriptlari ochiq, 1456 yuklab olish.
Apache-2.0.

Lekin uni ko'r-ko'rona almashtirib bo'lmaydi, chunki:

1. **Ruscha xavf ostida.** rubaiSTT faqat 475 soat **o'zbek** audiosida
   fine-tune qilingan. Bunday o'qitish boshqa tillarni "unuttiradi".
   Klinika esa ruschani faol ishlatadi (`ALLOWED_LANGUAGES = {uz, ru}`).
2. **Shevа boshqa.** rubaiSTT **Toshkent** shevasiga sozlangan
   (README'da alohida yozilgan). Oqtosh — **Termiz, Surxondaryo**.
3. **Sekinroq.** medium'da 24 ta dekoder qatlami, turbo'da 4 ta.
   VPS'da (2 yadro CPU) medium foydalanib bo'lmas darajada sekin.
   GPU'da esa muammo yo'q.

Shuning uchun: **avval o'lchaymiz, keyin qaror qilamiz.**

---

## 1-qadam: audio yig'ish

`audio/` papkasiga **haqiqiy klinika yozuvlari**ni qo'ying. Sun'iy yoki
internetdan olingan namunalar aldaydi — Termiz shevasi va tibbiy
atamalar kerak.

Kamida:
- 5-10 ta **o'zbekcha** yozuv (shifokor ko'rigi, obhod)
- 5-10 ta **ruscha** yozuv
- Har biri 30-120 soniya

Aniqlikni raqamda o'lchash uchun har audio yoniga **etalon matn** qo'ying:

```
audio/
  001.wav
  001.txt      <- shu yozuvning to'g'ri matni (qo'lda yozilgan)
  002.wav
  002.txt
```

Etalon bo'lmasa ham ishlaydi — u holda faqat matnlarni ko'z bilan
solishtirasiz va tezlik o'lchanadi.

> **Maxfiylik:** bu yozuvlarda bemor ma'lumoti bor. Faqat klinika
> kompyuterida saqlang, git'ga qo'ymang, tashqariga chiqarmang.

## 2-qadam: nomzod modelni tayyorlash

```bash
bash convert-rubaistt.sh ./models/rubaistt-v2-medium-ct2 float16
```

CPU'da sinamoqchi bo'lsangiz `float16` o'rniga `int8`.

## 3-qadam: solishtirish

O'zbekcha:
```bash
python compare.py --audio ./audio-uz --lang uz --wer --device cuda --compute float16
```

Ruscha — **eng muhim sinov**:
```bash
python compare.py --audio ./audio-ru --lang ru --wer --device cuda --compute float16
```

GPU yo'q bo'lsa: `--device cpu --compute int8` (sekin, sabr qiling).

Natija `natija.md` faylida: tezlik jadvali, WER/CER jadvali va har
audio uchun yonma-yon matnlar.

## 4-qadam: qaror

| Natija | Nima qilamiz |
|---|---|
| B ruschada A dan yomon | **Almashtirmaymiz** yoki faqat `uz` uchun ishlatamiz |
| B ikkala tilda yaxshi | To'liq almashtiramiz |
| Farq kam | Hozirgisida qolamiz (turbo tezroq) |
| B faqat o'zbekchada yaxshi | **Ikki model:** `uz`→rubaiSTT, `ru`→turbo |

Ikki modelli variant qiyin emas: kodda til allaqachon aniq uzatiladi
(`ai/engines/stt.js`), VRAM ham yetadi (2×2 GB, kartada 8 GB).

### Prompt sinovi

Kodimizda yozib qo'yilgan: hozirgi model `initial_prompt` bilan
**buziladi** ("zg zg z" yoki bo'sh matn). Shuning uchun tibbiy atamalar
ro'yxatini modelga berib bo'lmaydi.

rubaiSTT buni ko'tarishi mumkin — tekshirib ko'ring:

```bash
python compare.py --audio ./audio-uz --lang uz --wer \
  --prompt "Tibbiy matn. Dorilar: paratsetamol, amoksitsillin, omeprazol. Qon bosimi, jigar, buyrak."
```

Agar ishlasa — tibbiy atamalar aniqligida sezilarli yutuq.

---

## Lokal STT'ni ulash (o'lchov ijobiy bo'lsa)

### Klinika kompyuterida

```bash
# GPU ishlayaptimi
docker run --rm --gpus all nvidia/cuda:12.2.2-base-ubuntu22.04 nvidia-smi

# STT konteynerini GPU bilan qurish
docker build -f stt-service/Dockerfile.gpu -t falcon-stt:gpu ./stt-service

docker run -d --name falcon-stt --gpus all -p 8081:8081 \
  -e MODEL_NAME=/models/rubaistt-v2-medium-ct2 \
  -e DEVICE=cuda -e COMPUTE_TYPE=float16 \
  -e STT_USE_PROMPT=true \
  -v /opt/models:/models \
  falcon-stt:gpu

curl -sf http://localhost:8081/health
```

### VPS'ni unga yo'naltirish

Cloudflare Tunnel klinikadagi 8081-portni `stt.falconmedai.uz` sifatida
ochadi, keyin VPS'da:

```bash
WHISPER_URL=https://stt.falconmedai.uz
```

**Xavfsizlik:** bu manzil internetdan ochiq bo'ladi. Himoyasiz
qoldirmang — Cloudflare Access yoki umumiy maxfiy sarlavha qo'ying,
aks holda istalgan kishi klinika GPU'sida transkripsiya qildira oladi.

### Diqqat: audio yo'li

Bu sxemada ovoz **klinika → VPS (Germaniya) → Cloudflare → klinika**
yo'lini bosib o'tadi. Ishlaydi, lekin "ovoz binodan chiqmaydi" degan
afzallik yo'qoladi va kechikish qo'shiladi.

To'liq lokal variant (brauzer to'g'ridan-to'g'ri lokal STT'ga murojaat
qiladi, VPS'ga faqat matn boradi) alohida ish talab qiladi: sahifa
HTTPS'da bo'lgani uchun lokal manzilga murojaat mixed-content bilan
bloklanadi, lokal sertifikat kerak.

## Resurs hisobi (klinika kompyuteri)

| | Kerak | Bor |
|---|---|---|
| VRAM (medium float16) | ~2 GB | 8 GB — **yetarli** |
| RAM (Ubuntu + Docker + model yuklash) | ~4-5 GB | **8 GB — tor** |

Kompyuter faqat STT bilan shug'ullansa yetadi. Bazani ham lokalga
ko'chirmoqchi bo'lsangiz — **32 GB** kerak.
