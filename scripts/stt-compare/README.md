# Lokal STT — klinika kompyuteriga o'rnatish va sinash

Mo'ljal: **i5-14400F · 8 GB RAM · RTX 2060 SUPER 8 GB · Ubuntu**

## Nima qilinadi

`islomov/rubaistt_v2_medium` (rubaiSTT v2) modelini klinika
kompyuteriga o'rnatib, hozirgi modelimiz bilan **haqiqiy klinika
yozuvlarida** solishtiramiz. Natija ijobiy bo'lsagina almashtiramiz.

## Nega darrov almashtirmaymiz

Hozirgi modelimiz — `hostmepanda/whisper-large-v3-turbo-uzbek-ct2`.
Uning **aniqligi hech qayerda e'lon qilinmagan** (88 yuklab olish,
1 like). Ya'ni o'z bazaviy darajamizni bilmaymiz.

Nomzod — rubaiSTT v2: WER ~17%, whitepaper va o'qitish skriptlari
ochiq, Apache-2.0, 1456 yuklab olish. Ishonchliroq. **Lekin** uchta
aniq xavf bor:

1. **Ruscha buzilishi mumkin** — faqat 475 soat *o'zbek* audiosida
   fine-tune qilingan. Bunday o'qitish boshqa tillarni "unuttiradi".
   Klinika esa ruschani faol ishlatadi.
2. **Shevа boshqa** — rubaiSTT **Toshkent** shevasiga sozlangan
   (README'da o'zlari yozishgan). Oqtosh — **Termiz, Surxondaryo**.
3. **Sekinroq** — medium'da 24 dekoder qatlami, turbo'da 4 ta.
   GPU'da muammo yo'q, CPU'da sezilarli.

---

# Ketma-ketlik

## 0-qadam · Fayllarni kompyuterga olish

```bash
git clone https://github.com/oybekchoriev94-maker/falcon-ai-os.git
cd falcon-ai-os/scripts/stt-compare
chmod +x *.sh
```

## 1-qadam · Tizimni tayyorlash

```bash
./01-ubuntu-setup.sh
```

Nima qiladi (har birini avval tekshiradi, bor bo'lsa o'tkazib yuboradi):

| | |
|---|---|
| NVIDIA drayveri | yo'q bo'lsa o'rnatadi → **qayta yuklash kerak** |
| Docker | rasmiy repodan |
| `docker` guruhi | sizni qo'shadi → **qayta kirish kerak** |
| nvidia-container-toolkit | Docker GPU'ni ko'rishi uchun |
| **8 GB swap** | 8 GB RAM'da model o'girishda OOM bo'lmasligi uchun |
| Python venv | `~/.venv-stt` |

> Skript ikki joyda to'xtashi mumkin — drayver o'rnatilgach (qayta
> yuklash) va docker guruhiga qo'shilgach (qayta kirish). Har safar
> aytadi. Shundan keyin **qayta ishga tushiring**, u qolgan joydan
> davom etadi.

Tekshirish:
```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.2.2-base-ubuntu22.04 nvidia-smi
```

## 2-qadam · Modelni yuklab olish va o'girish

```bash
source ~/.venv-stt/bin/activate
./02-convert-model.sh ./models/rubaistt-v2-medium-ct2 float16
```

- ~3 GB yuklab olinadi, o'girish **5-15 daqiqa**
- Natija ~1.5 GB (float16)
- Skript avval `tokenizer.json` yasaydi — repoda u yo'q, faster-whisper
  esa uni kutadi (aks holda o'girish xato beradi)

## 3-qadam · Audio yig'ish

Bu **eng muhim** qadam. Sun'iy yoki internetdan olingan namunalar
aldaydi — Termiz shevasi va tibbiy atamalar kerak.

```bash
mkdir -p audio-uz audio-ru
```

Kamida har papkaga **5-10 ta yozuv**, har biri 30-120 soniya:
- `audio-uz/` — o'zbekcha ko'rik, obhod
- `audio-ru/` — ruscha ko'rik

Aniqlikni **raqamda** ko'rish uchun har audio yoniga to'g'ri matn:

```
audio-uz/
  001.wav
  001.txt      <- shu yozuvning to'g'ri matni, qo'lda yozilgan
  002.wav
  002.txt
```

Etalonsiz ham ishlaydi — u holda matnlarni ko'z bilan solishtirasiz.

> **Maxfiylik:** bu yozuvlarda bemor ma'lumoti bor. Faqat shu
> kompyuterda saqlang. `.gitignore` ularni git'ga tushishdan
> to'sadi, lekin qo'lda ham tashqariga chiqarmang.

## 4-qadam · Solishtirish

```bash
source ~/.venv-stt/bin/activate

./03-compare.sh uz      # o'zbekcha
./03-compare.sh ru      # ruscha — ENG MUHIM SINOV
```

Natija: `natija-uz.md`, `natija-ru.md` — tezlik (xRT), WER/CER va har
audio uchun yonma-yon matnlar.

### Prompt sinovi (bonus)

Kodimizda yozib qo'yilgan: hozirgi model `initial_prompt` bilan
**buziladi** ("zg zg z" yoki bo'sh matn). Shuning uchun tibbiy
atamalar ro'yxatini modelga berib bo'lmaydi.

rubaiSTT buni ko'tarsa — tibbiy atamalar aniqligida sezilarli yutuq:

```bash
./03-compare.sh uz prompt
```

## 5-qadam · Qaror

| Natija | Nima qilamiz |
|---|---|
| B ruschada A dan yomon | **Ikki model:** `uz`→rubaiSTT, `ru`→turbo |
| B ikkala tilda yaxshi | To'liq almashtiramiz |
| Farq 2 punktdan kam | Hozirgisida qolamiz (turbo tezroq) |
| B ikkalasida yomon | Almashtirmaymiz |

Ikki modelli variant qiyin emas — kodda til allaqachon aniq uzatiladi
(`ai/engines/stt.js`), VRAM ham yetadi (2×2 GB, kartada 8 GB).

## 6-qadam · Xizmat sifatida ishga tushirish

**Faqat 5-qadam ijobiy bo'lsa.**

```bash
./04-serve-gpu.sh              # rubaiSTT
./04-serve-gpu.sh --current    # hozirgi model bilan solishtirish uchun
./04-serve-gpu.sh --stop
```

Tekshirish:
```bash
curl -F "file=@test.wav" -F "language=uz" http://127.0.0.1:8081/transcribe
docker logs -f falcon-stt
```

> Port **127.0.0.1** ga bog'langan — tarmoqqa ochiq emas. Bu ataylab:
> himoyasiz STT endpoint'ini ochib qo'yish xavfli.

---

# VPS'ni lokal STT'ga ulash

## Cloudflare Tunnel

Klinika kompyuterida:

```bash
# cloudflared o'rnatish
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] \
https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared

cloudflared tunnel login
cloudflared tunnel create oqtosh-stt
cloudflared tunnel route dns oqtosh-stt stt.falconmedai.uz
```

`~/.cloudflared/config.yml`:
```yaml
tunnel: oqtosh-stt
credentials-file: /home/USER/.cloudflared/<TUNNEL-ID>.json
ingress:
  - hostname: stt.falconmedai.uz
    service: http://127.0.0.1:8081
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

VPS'da:
```bash
WHISPER_URL=https://stt.falconmedai.uz
```

## ⚠ Xavfsizlik — buni o'tkazib yubormang

Tunnel `stt.falconmedai.uz` ni **internetga ochadi**. Himoyasiz
qoldirsangiz, istalgan kishi klinika GPU'sida transkripsiya qildira
oladi (va bemor audiosini yuborishi mumkin).

Kamida bittasini qiling:
- **Cloudflare Access** — service token bilan (tavsiya)
- yoki STT xizmatiga umumiy maxfiy sarlavha qo'shish

## ⚠ Audio yo'li haqida

Bu sxemada ovoz shunday yuradi:

```
Shifokor brauzeri (klinika) → VPS (Germaniya) → Cloudflare → klinika PC
```

Ishlaydi, lekin:
- Kechikish qo'shiladi
- **"Ovoz binodan chiqmaydi" afzalligi yo'qoladi**

To'liq lokal variant (brauzer to'g'ridan-to'g'ri lokal STT'ga, VPS'ga
faqat matn) alohida ish talab qiladi: sahifa HTTPS'da, lokal IP'ga
murojaat mixed-content bilan bloklanadi — lokal sertifikat kerak.
Buni keyingi bosqichda hal qilamiz.

---

# Resurs hisobi

| | Kerak | Bor |
|---|---|---|
| VRAM (medium float16) | ~2 GB | 8 GB — **yetarli** |
| RAM (Ubuntu + Docker + xizmat) | ~4-5 GB | **8 GB — tor** |
| RAM (model o'girishda, bir martalik) | ~4 GB | swap bilan **yetadi** |
| Disk | ~20 GB | tekshiring |

Kompyuter **faqat STT** bilan shug'ullansa yetadi. Bazani ham lokalga
ko'chirmoqchi bo'lsangiz — **32 GB kerak**.

# Muammo chiqsa

| Xato | Sabab / yechim |
|---|---|
| `could not select device driver "nvidia"` | toolkit sozlanmagan → `sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker` |
| O'girishda `Killed` | RAM yetmadi → swap yoqilganini tekshiring (`free -h`) |
| `tokenizer.json not found` | 02-skriptni to'liq ishga tushiring, u yasaydi |
| `CUDA out of memory` | boshqa GPU jarayonini yoping (`nvidia-smi`) |
| Konteyner ko'tarilmaydi | `docker logs falcon-stt` |
| Transkripsiya bo'm-bo'sh | mikrofon "Stereo Mix" emasligini tekshiring |
