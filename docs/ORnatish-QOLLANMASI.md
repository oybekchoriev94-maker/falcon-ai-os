# Falcon AI OS — O'rnatish qo'llanmasi

Tizim **ikki qismdan** iborat va ular bir-birisiz ham ishlaydi:

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  VPS (falconmedai.uz)       │         │  Klinika kompyuteri          │
│  • Backend + Next.js        │◄──HTTPS─┤  • Face ID agent (Python)    │
│  • Postgres, STT, Caddy     │  token  │  • USB kamera                │
│  • GitHub'dan avtomatik     │         │  • (ixtiyoriy) Ollama LLM,   │
│    deploy (CI/CD)           │         │    GPU STT/TTS               │
└─────────────────────────────┘         └──────────────────────────────┘
        ▲ Shifokorlar brauzerdan va Telegram'dan kiradi
```

**"Bitta GitHub bilan hammasini o'rnatsa bo'ladimi?"**

| Narsa | GitHub'dan keladimi | Izoh |
|---|---|---|
| Barcha kod (backend, frontend, agent) | ✅ Ha | `git clone` kifoya |
| Docker image'larni build qilish | ✅ Ha | CI/CD o'zi build qiladi |
| Python kutubxonalar (opencv, numpy) | ❌ Yo'q | `pip install` — PyPI'dan, **bir marta internet kerak** |
| Yuz tanish modellari (~10 MB) | ❌ Yo'q | Birinchi ishga tushirishda **avtomatik** yuklanadi |
| STT modeli (rubaistt-v2, ~740 MB) | ❌ Yo'q | `scripts/stt-compare/` orqali klinika GPU'sida konvertatsiya |
| Kamera drayveri | ❌ Yo'q | Ishlab chiqaruvchi saytidan |
| Parollar, API kalitlar (.env) | ❌ Yo'q | Xavfsizlik uchun GitHub'da **emas** — VPS'da qo'lda |

Xulosa: **kod — GitHub'dan, tashqi bog'liqliklar — internetdan bir marta.**
Keyin tizim internet uzilishiga chidamli (davomat navbatda saqlanadi).

---

## 1-qism: VPS server (GitHub orqali avtomatik)

### Yangi serverga o'rnatish (birinchi marta)

```bash
# 1. VPS'da klon
sudo apt install git docker.io docker-compose-plugin -y
git clone https://github.com/oybekchoriev94-maker/falcon-ai-os.git ~/falcon
cd ~/falcon

# 2. Maxfiy kalitlar (GROQ, Telegram, parollar...)
#    GitHub → repo → Settings → Secrets and variables → CI/CD secrets
#    (har birini VPS .env ga qo'lda yozing) yoki local: node apply-secrets.js
cp .env.example .env
nano .env

# 3. STT modeli papkasi (konvertatsiya qilingan int8 model shu yerda)
mkdir -p stt-models backups

# 4. Ishga tushirish — migratsiyalar o'zi yuradi (db-bootstrap)
docker compose up -d --build
docker compose logs -f app
```

Caddy HTTPS sertifikatni (Let's Encrypt) **o'zi** oladi — domen DNS'i
server IP'siga qaragan bo'lishi kifoya.

### Yangilanishni chiqarish (deploy)

**Avtomatik:** `main` branchga merge qilinsa GitHub Actions:
testlar → Docker build → VPS'ga SSH orqali deploy.

```bash
git checkout master
git pull
# GitHub'da: master → main ga Pull Request → Squash and merge
```

CI deploy ishlashi uchun repo Settings → Secrets'da **VPS_HOST,
VPS_USER, VPS_SSH_KEY** bo'lishi shart.

**Qo'lda** (CI nosoz bo'lsa):
```bash
bash deploy-vps.sh        # lokal Windows'dan ham ishlaydi (ssh orqali)
```

### VPS'dagi davriy ishlar (bir marta sozlanadi)

```bash
crontab -e
# Har kuni 03:00 da Postgres backup (backup holati Admin → Tizim holati tabida ko'rinadi)
0 3 * * * cd ~/falcon && ./scripts/backup-pg.sh >> ./backups/backup.log 2>&1
# Har 15 daqiqada backup eskirishini tekshirish
*/15 * * * * cd ~/falcon && ./scripts/watchdog.sh >> ./backups/watchdog.log 2>&1
```

Telegram ogohlantirish uchun `.env` da: `ADMIN_TG_BOT_TOKEN`, `ADMIN_TG_CHAT_ID`.

### Tekshirish

| Nima | Qayerda |
|---|---|
| Umumiy holat | `https://falconmedai.uz/api/health` |
| Chuqur holat (DB, backup, AI dvigatellari) | Panel → Admin → **Tizim holati** tabi |
| STT | `./scripts/stt-smoke-test.sh` |
| Loglar | `docker compose logs -f app` |

---

## 2-qism: Klinika kompyuteri — Face ID agenti

Bu qism **to'liq lokal**: yuz shablonlari kompyuterdan chiqmaydi,
serverga faqat `{ism, keldi/ketdi, vaqt}` boradi.

Batafsil: [`agent/attendance/README.md`](../agent/attendance/README.md).
Qisqacha (Windows):

### Kerak bo'ladigan dasturlar

1. **Python 3.10+** — [python.org](https://python.org) (o'rnatishda
   "Add to PATH"ni belgilang)
2. **Git** — [git-scm.com](https://git-scm.com)

### O'rnatish

```powershell
# 1. Kod
git clone https://github.com/oybekchoriev94-maker/falcon-ai-os.git C:\falcon
cd C:\falcon\agent\attendance

# 2. Muhit
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# 3. Kamerani O'LCHANG (eng muhim qadam!)
python measure-camera.py --device 0 --show
# Yuz 80px+ chiqishi shart. Kam bo'lsa — kamera joyini o'zgartiring.

# 4. Xodimlar suratlari → faces/ papkaga (har biriga 2-3 surat)
python enroll.py

# 5. Token: falconmedai.uz → Kiosk qurilmalari → Yangi qurilma → Turi: Davomat
# config.example.json nusxasini config.json qilib, tokenni yozing
copy config.example.json config.json
notepad config.json

# 6. Sinov va doimiy ishga tushirish
python agent.py --preview   # oynada ko'rinadi
python agent.py             # oynasiz
```

Doimiy ishlashi uchun: `Win+R` → `shell:startup` papkaga `pythonw.exe agent.py`
yorlig'ini qo'ying (README §7).

### Offline chidamlilik

Internet uzilsa agent **to'xtamaydi** — hodisalar `data/queue.jsonl`
da yig'iladi, aloqa tiklangach avtomatik jo'natiladi.

---

## 3-qism (ixtiyoriy): Klinika GPU'sida og'ir AI

Agar klinikada kuchli kompyuter (GPU, 8+ GB RAM) bo'lsa, og'ir
dvigatellarni VPS o'rniga **o'sha yerda** yurgizish mumkin:

| Dvigatel | Qayerda | Yoqish |
|---|---|---|
| LLM (Qwen) | Klinika PC — Ollama | `.env`: `OLLAMA_URL=http://<klinika-ip>:11434` |
| STT (rubaistt-v2) | Klinika GPU | `scripts/stt-compare/` bilan konvertatsiya → SSH reverse tunnel yoki Tailscale |
| TTS (OmniVoice) | Klinika GPU | `docker compose --profile tts up -d` yoki tunnel |

VPS'dagi zaxira STT doim tayyor turadi — klinika GPU'si o'chsa ham
ovozli diktant to'xtamaydi (`WHISPER_FALLBACK_URL`).

---

## Real test rejasi (o'rnatishdan keyin)

1. **Panel:** falconmedai.uz ga kiring → 4 rol (ceo/admin/doctor/
   receptionist) bilan asosiy sahifalar ochilishini ko'ring.
2. **Davomat:** agentni `--preview` bilan ishga tushiring, yuzingizni
   ko'rsating → Panel → Davomat sahifasida "Jonli" nishoni paydo bo'lishi kerak.
3. **Bemor check-in:** `faces/bemor_<ism>` ga surat qo'shib `enroll.py`,
   bemorni bugungi qabulga yozing → kamera orqali o'ting →
   Bemorlar → qabulda "Face ID orqali keldi" paydo bo'lishi kerak.
4. **OCR:** Panel → Hujjatlar → rasm yuklang yoki ovoz yozing →
   AI ajratma chiqishini va tahrirlab tasdiqlashni tekshiring.
5. **Ombor:** Ombor sahifasida kamera korrelyatsiyasi bo'limini oching,
   bir nechta amal qiling, bayroqchalarni tekshiring.
6. **Zaxira:** Admin → Tizim holati → DB, backup, dvigatellar holati.
