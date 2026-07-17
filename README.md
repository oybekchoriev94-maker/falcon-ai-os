# Falcon AI OS v2.0

> Klinikalar uchun yaxlit AI ekotizim — Face ID, AI Receptionist, Smart Inventory, B2B Referral, Billing.  
> **100% lokal ishlash rejimi** (RTX 5070 12GB / Ollama + whisper.cpp + Edge-TTS)

---

## 📋 Mundarija

- [Imkoniyatlar](#-imkoniyatlar)
- [Arxitektura](#-arxitektura)
- [Tez boshlash — Lokal modellar bilan](#-tez-boshlash--lokal-modellar-bilan)
- [O'rnatish (birinchi marta)](#-o%CA%BCrnatish-birinchi-marta)
  - [1. Ollama — LLM](#1-ollama--llm)
  - [2. whisper.cpp — STT](#2-whispercpp--stt)
  - [3. Edge-TTS — Ovoz](#3-edge-tts--ovoz)
- [Ishga tushirish](#-ishga-tushirish)
- [Cloud rejim (API kalitlari bilan)](#-cloud-rejim-api-kalitlari-bilan)
- [Testlar](#-testlar)
- [AI Agentlar (9 ta)](#-ai-agentlar-9-ta)
- [API hujjatlari](#-api-hujjatlari)
- [Security](#-security)
- [Deployment](#-deployment)
- [Texnologiyalar](#-texnologiyalar)
- [Loyiha tuzilishi](#-loyiha-tuzilishi)
- [Troubleshooting](#-troubleshooting)

---

## 🏥 Imkoniyatlar

| Modul | Tavsif |
|-------|--------|
| **Face ID** 🫵 | Yuz orqali identifikatsiya + liveness detection + davomat |
| **AI Scribe** 🎙️ | Shifokor diktantini → tashxis, ICD-10, dori, vital signallar |
| **AI Receptionist** 🤖 | 24/7 ovozli operator: grafik tekshirish, band qilish |
| **Smart Inventory** 📦 | Ombor, batch (FEFO), normativlar, kam qoldiq xavfi |
| **B2B Referral** 🔄 | Klinikalararo yo'llanma + split-kassa (40/20/2000) |
| **Medication Coach** 💊 | Dori eslatmalari, o'zaro ta'sir tekshiruvi |
| **Analytics** 📊 | KPI, doktor samaradorligi, moliyaviy prognoz |
| **Telegram Bot** 🤖 | Bemorlar uchun booking + eslatmalar |
| **Loyalty** 🎁 | Bemor cashback + referral system |
| **Multilingual** 🌐 | O'zbek, Rus, English — AI agentlar 3 tilda |

---

## 🏗 Arxitektura

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER (face-api.js TF.js)                                │
│  ┌─────────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Face Capture     │  │ Admin Web    │  │ Telegram Mini │  │
│  │ Registration     │  │ Dashboard    │  │ App (TMA)     │  │
│  └────────┬────────┘  └──────┬───────┘  └───────┬───────┘  │
│           │                  │                   │          │
└───────────┼──────────────────┼───────────────────┼──────────┘
            │                  │                   │
            └──────────────────┼───────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  EXPRESS.JS API (server.js)                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ Auth     │ │ Face     │ │ Inventory│ │ Appointments  │  │
│  │ Routes   │ │ Routes   │ │ Routes   │ │ Routes       │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────────────┐  │
│  │ Billing  │ │ Referral │ │ AI Orchestrator (9 agents) │  │
│  │ Routes   │ │ Routes   │ │ ┌────────────────────────┐ │  │
│  └──────────┘ └──────────┘ │ │ medical-scribe         │ │  │
│                            │ │ inventory-manager      │ │  │
│  ┌────────────────────┐    │ │ analytics-agent        │ │  │
│  │ backend/shared.js  │    │ │ medication-coach       │ │  │
│  │ middleware/schemas │    │ │ face-id-agent          │ │  │
│  └────────────────────┘    │ │ receptionist (tool-call)│ │  │
│                            │ │ b2b-referral           │ │  │
│  ┌────────────────────┐    │ │ face-recognizer        │ │  │
│  │ SQLite (WAL)       │    │ │ referral-agent         │ │  │
│  │ better-sqlite3     │    │ └────────────────────────┘ │  │
│  └────────────────────┘    └────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│  🖥️  LOKAL MODELLAR (RTX 5070 12GB)                        │
│                                                              │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Ollama           │  │  whisper.cpp  │  │  Edge-TTS    │  │
│  │  Qwen 2.5 7B     │  │  large-v3     │  │  uz-UZ-Madina│  │
│  │  Port: 11434     │  │  Port: 8081   │  │  Port: 50081 │  │
│  │  VRAM: 6.5 GB    │  │  VRAM: 1.5 GB│  │  VRAM: 0 GB  │  │
│  └──────────────────┘  └──────────────┘  └──────────────┘  │
│                                                              │
│  Telegram API ── cloud (Telegraf)                            │
└──────────────────────────────────────────────────────────────┘
```

---

## ⚡ Tez boshlash — Lokal modellar bilan

### Talablar

| Komponent | Minimal | Tavsiya qilingan |
|-----------|---------|------------------|
| **GPU** | 8GB VRAM | **RTX 5070 12GB** ✅ |
| **RAM** | 16 GB | **32 GB DDR5** ✅ |
| **CPU** | 4 cores | **i5-14400** ✅ |
| **Disk** | 20 GB bo'sh | **512 GB SSD** |
| **Node.js** | 22+ | 24.x |
| **OS** | Windows 11 / Ubuntu 22+ | Windows 11 |

### 1-daqiqa: Loyihani sozlash

```bash
# Reponi klonlash
git clone https://github.com/your-org/falcon-ai-os.git
cd falcon-ai-os

# Node paketlarni o'rnatish
npm install

# Environment faylni yaratish (.env.example dan)
cp .env.example .env
# .env faylini oching va LOCAL_ONLY=true ekanligini tekshiring
```

### 10 daqiqa: Lokal modellarni o'rnatish

Avtomatik o'rnatish uchun:

```bash
# Git-Bash (Windows) yoki Linux terminalida:
bash setup-local-models.sh
```

Yoki qo'lda:

---

#### 1. Ollama — LLM

```bash
# Windows:
winget install Ollama.Ollama

# Linux:
curl -fsSL https://ollama.com/install.sh | sh

# Model yuklash (Qwen 2.5 7B — 6.5GB VRAM)
ollama pull qwen2.5:7b

# Tekshirish:
ollama run qwen2.5:7b "O'zbekistonda nechta viloyat bor?"
```

**Boshqa modellar** (agar 7B yetmasa):

| Model | VRAM | Sifat | Tavsiya |
|-------|:----:|:-----:|:-------:|
| `qwen2.5:7b` | 6.5 GB | 🟢 Yaxshi | ✅ Asosiy |
| `qwen2.5:14b` (Q4_K_M) | 8.2 GB | 🟢🟢 A'lo | Agar 14B kerak bo'lsa |
| `llama3.2:3b` | 2.5 GB | 🟡 O'rtacha | Juda tez, engil |

---

#### 2. whisper.cpp — STT

```bash
# 1. Clone
git clone https://github.com/ggerganov/whisper.cpp.git
cd whisper.cpp

# 2. CUDA bilan build
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release -j

# 3. Model yuklash (large-v3-turbo — 1.5GB VRAM)
bash models/download-ggml-model.sh large-v3-turbo

# 4. Server rejimida ishga tushirish
./build/bin/server -m ./models/ggml-large-v3-turbo.bin \
                   --port 8081 --host 0.0.0.0 -t 6 -p 4

cd ..
```

**MUHIM:** whisper.cpp server `OpenAI API formatida` ishlaydi. Shuning uchun `ai/engines/stt.js` da **atigi 2 satr** (URL + token) o'zgaradi, qolgan kod bir xil.

---

#### 3. Edge-TTS — Ovoz

```bash
# edge-tts npm paketini o'rnatish
npm install edge-tts

# Server ishga tushirish
node ai/engines/edge-tts-server.js
# ✅ Edge-TTS server http://localhost:50081
#    Ovozlar: uz-UZ-MadinaNeural, ru-RU-SvetlanaNeural, en-US-AriaNeural
```

> **Edge-TTS** Microsoft'ning bepul TTS xizmati. Internet kerak, lekin **bepul** va Uzbek tilida gapiradi (`uz-UZ-MadinaNeural`).

---

### ▶️ Ishga tushirish

**1-qadam: Lokal modellarni ishga tushirish**

```bash
# Windows:
start-local-models.bat

# Linux/Mac:
bash start-local-models.sh
```

Bu 3 ta model serverini ishga tushiradi:
```
✅ Ollama  → http://localhost:11434  (Qwen 2.5 7B)
✅ Whisper → http://localhost:8081   (large-v3-turbo)
✅ Edge-TTS → http://localhost:50081 (uz-UZ-MadinaNeural)
```

**2-qadam: Falcon AI OS ni ishga tushirish**

```bash
npm start
# → http://localhost:3000
```

**3-qadam: Tekshirish**

```bash
# Umumiy status
curl http://localhost:3000/api/health

# AI engine status
curl http://localhost:3000/api/ai/status

# Swagger UI
http://localhost:3000/api-docs
```

---

### ☁️ Cloud rejim (API kalitlari bilan)

Agar lokal modellarsiz ishga tushirmoqchi bo'lsangiz:

```bash
# .env faylida:
LOCAL_ONLY=false      # lokal tushsa cloud ga o'tadi
GROQ_API_KEY=gsk_...  # Groq API kaliti
OPENAI_API_KEY=sk_... # OpenAI API kaliti (TTS uchun)

# Ishga tushirish:
npm start
```

Cloud rejimda:
- **LLM**: Groq (`llama-3.3-70b-versatile`) yoki OpenCode Zen
- **STT**: Groq Whisper (`whisper-large-v3`)
- **TTS**: OpenAI TTS (`tts-1`)

---

## 🧪 Testlar

```bash
# Barcha testlar
npm test

# 34 ta asosiy test (auth + billing + finance)
npx vitest run tests/api.auth.test.js tests/api.billing.test.js tests/finance-engine.test.js

# Ma'lum bir test fayli
npx vitest run tests/api.face.test.js

# Watch mode
npm run test:watch
```

Joriy test coverage:
| Test fayli | Testlar soni | Status |
|-----------|:-----------:|:------:|
| `api.auth.test.js` | 8 | ✅ |
| `api.billing.test.js` | 13 | ✅ |
| `finance-engine.test.js` | 13 | ✅ |
| `api.face.test.js` | ~60 | 🔧 progress |
| `api.inventory.test.js` | ~52 | 🔧 progress |
| `api.ai.test.js` | ~20 | 🔧 progress |

---

## 🤖 AI Agentlar (9 ta)

| Agent | Vazifasi | LLM | STT | TTS | DB |
|-------|----------|:---:|:---:|:---:|:--:|
| **medical-scribe** 🏥 | Diktant → ICD-10, dori, vitals | ✅ | ✅ | — | ✅ |
| **inventory-manager** 📦 | Ovozli ombor boshqaruvi | ✅ | ✅ | — | ✅ |
| **analytics-agent** 📊 | KPI, moliyaviy tahlil, prognoz | ✅ | — | — | ✅ |
| **medication-coach** 💊 | Dori eslatmasi, interaktsiya | ✅ | — | ✅ | ✅ |
| **receptionist** 🎙️ | 24/7 ovozli operator (tool calling) | ✅ | ✅ | ✅ | ✅ |
| **face-id-agent** 👤 | Yuz orqali identifikatsiya | — | — | — | ✅ |
| **face-recognizer** 🔍 | Yuz matching + cosine similarity | — | — | — | ✅ |
| **b2b-referral** 🔄 | Klinikalararo yo'llanma | — | — | — | ✅ |
| **referral-agent** 📋 | Referral tracking | lokal | — | — | ✅ |

---

## 📚 API hujjatlari

**Swagger UI:** http://localhost:3000/api-docs (server ishlayotganida)

**Raw spec:** http://localhost:3000/api-docs.json

**78 ta endpoint** — 12 tag guruhga bo'lingan:

| Guruh | Endpoints | Muhimlari |
|-------|-----------|-----------|
| Auth | 6 | `POST /api/auth/login`, `/refresh`, `/logout` |
| Face ID | 16 | `POST /api/face/register`, `/verify`, `/consent` |
| Inventory | 16 | `POST /api/inventory/add`, `/consume`, `/batches` |
| Doctors | 14 | `GET /api/face/doctors`, `/toggle-status` |
| Appointments | 7 | `POST /api/appointments/book`, `/cancel` |
| AI | 8 | `POST /api/ai/execute`, `/pipeline`, `/transcribe` |
| Billing | 3 | `POST /api/billing/redeem` |
| Referrals | 5 | `POST /api/referrals/pipeline` |
| B2B | 5 | `POST /api/b2b/referral` |

---

## 🔒 Security

| Chora | Status |
|-------|:------:|
| JWT (2h expiry) + token blacklist | ✅ |
| RBAC (CEO, admin, doctor, receptionist) | ✅ |
| Zod validation (25+ endpoint) | ✅ |
| Rate limiting (auth, face, AI, inventory) | ✅ |
| Anti-replay nonce + device fingerprint | ✅ |
| IDOR protection | ✅ |
| Atomic finance (balance ≥ amount) | ✅ |
| Idempotency keys (double-spend prevention) | ✅ |
| GDPR (consent, forget, 90d retention) | ✅ |
| AES-256-GCM face descriptor encryption | ✅ |
| CSP + Helmet + HSTS + CORS whitelist | ✅ |
| SQL injection prevented (100% parameterized) | ✅ |
| Sentry error monitoring | ✅ |
| Helmet security headers | ✅ |

---

## 🚀 Deployment

### Docker

```bash
docker compose up -d
```

### PM2 (bare metal)

```bash
npm install -g pm2
pm2 start ecosystem.config.js
# yoki cluster mode:
pm2 start ecosystem.config.cjs
```

### VPS

```bash
# Caddy reverse proxy bilan
./deploy-vps.sh
```

### Public URL

```bash
# Localtunnel (test uchun)
npm run tunnel
```

---

## 🛠 Texnologiyalar

| Qatlam | Texnologiya |
|--------|------------|
| **Runtime** | Node.js 24.x, ESM |
| **Framework** | Express 4.21 |
| **Database** | better-sqlite3 (WAL, foreign_keys ON) |
| **Auth** | JWT (jsonwebtoken), bcrypt |
| **Validation** | Zod 4 |
| **Face ID** | face-api.js (client TF.js) + AES-256-GCM |
| **LLM** | Ollama + Qwen 2.5 7B (lokal) / Groq Llama 3 (cloud) |
| **STT** | whisper.cpp (lokal) / Groq Whisper (cloud) |
| **TTS** | Edge-TTS (bepul) / OpenAI TTS (cloud) |
| **Bot** | Telegraf.js |
| **PDF** | PDFKit + QRCode |
| **Logging** | Morgan + Sentry |
| **Testing** | Vitest + Supertest (34+ test) |
| **Docs** | Swagger/OpenAPI 3.0.3 (78 endpoint) |
| **Monitoring** | @sentry/node |

---

## 📁 Loyiha tuzilishi

```
falcon-ai-os/
├── server.js                  # Express server (main entry)
├── backend/
│   ├── shared.js              # Middleware, schemas, utilities
│   ├── swagger.js             # OpenAPI 3.0.3 spec (78 endpoint)
│   ├── routes/                # Route handlers
│   │   ├── auth.js            # Login/logout/refresh
│   │   ├── face.js            # Face ID registration/verify
│   │   ├── inventory.js       # Stock/batches/norms
│   │   ├── ai.js              # AI orchestration API
│   │   ├── doctors.js         # Doctor CRUD
│   │   ├── billing.js         # Cashback/loyalty
│   │   ├── appointments.js    # Booking system
│   │   ├── patient.js         # Patient records
│   │   ├── referral.js        # B2B referral agent
│   │   └── referrals.js       # Referral pass
│   └── services/
│       ├── face-engine.js     # Face matching + encryption
│       └── pdfGenerator.js    # PDF reports
├── ai/
│   ├── engines/
│   │   ├── llm.js             # Ollama / Groq LLM engine
│   │   ├── stt.js             # whisper.cpp / Groq STT engine
│   │   ├── tts.js             # Edge-TTS / OpenAI TTS engine
│   │   ├── voice-streamer.js  # Streaming TTS
│   │   └── edge-tts-server.js  # Edge-TTS HTTP server
│   ├── agents/
│   │   ├── registry.js        # Agent registration
│   │   ├── medical-scribe.js  # Medical dictation → ICD-10
│   │   ├── inventory-manager.js # Voice inventory
│   │   ├── analytics-agent.js # KPI/financial analysis
│   │   ├── medication-coach.js # Pill reminders
│   │   ├── receptionist.js    # Voice receptionist (tool-calling)
│   │   ├── face-id-agent.js   # Face verification/log
│   │   ├── face-recognizer.js # Face matching
│   │   ├── b2b-referral.js    # Cross-clinic referrals
│   │   └── referral-agent.js  # Referral tracking
│   ├── orchestrator.js        # Agent execution engine
│   ├── protocols/
│   │   └── medical-skills.js  # Medical specializations
│   └── index.js               # Public API
├── public/                    # Frontend (HTML/JS/CSS)
│   ├── face-capture.js        # Face capture pipeline
│   ├── face-kiosk.html        # Face ID kiosk
│   ├── admin-tma.html         # Telegram Mini App
│   ├── dashboard.html         # Admin dashboard
│   └── ...
├── tests/
│   ├── api.auth.test.js       # Auth API tests (8)
│   ├── api.billing.test.js    # Billing API tests (13)
│   ├── finance-engine.test.js # Finance tests (13)
│   ├── api.face.test.js       # Face API tests (~60)
│   ├── api.inventory.test.js  # Inventory tests (~52)
│   └── api.ai.test.js         # AI tests (~20)
├── .env.example               # Environment template
├── .env                       # Environment (gitignore)
├── setup-local-models.sh      # Local model setup (auto)
├── start-local-models.bat     # Start models (Windows)
├── start-local-models.sh      # Start models (Linux/Mac)
├── stop-local-models.bat      # Stop models (Windows)
└── package.json
```

---

## 🔧 Troubleshooting

### "Ollama connection refused"

```bash
# Ollama ishlayotganini tekshirish:
curl http://localhost:11434/api/tags
# Agar ishlamasa:
ollama serve &
```

### "whisper.cpp HTTP 500"

```bash
# Model mavjudligini tekshirish:
ls -la whisper.cpp/models/ggml-large-v3-turbo.bin
# Server log:
curl http://localhost:8081/v1/audio/transcriptions -X POST -F "file=@test.wav"
```

### "Edge-TTS not working"

```bash
# npm paketi o'rnatilganmi?
npm list edge-tts
# Test:
node -e "import('edge-tts').then(()=>console.log('✅ OK'))"
```

### VRAM yetmayapti (out of memory)

Agar 12GB VRAM yetmasa:

```bash
# Yengilroq model:
ollama pull qwen2.5:7b   # default Q4_K_M → 5.5GB
# yoki
ollama pull llama3.2:3b  # 2.5GB

# Whisper yengilroq:
# tiny (0.3GB), small (0.6GB), medium (1.0GB) modellaridan foydalaning
```

### "JWT_SECRET not set"

```bash
# .env faylida JWT_SECRET borligini tekshiring
# Generatsiya:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 📊 Performance (RTX 5070 12GB)

| Operatsiya | Latency | VRAM |
|-----------|:-------:|:----:|
| LLM (Qwen 7B) — 1 ta so'rov | 80-150 ms | 6.5 GB |
| STT (whisper large-v3-turbo) — 30s audio | 1-2 s | 1.5 GB |
| TTS (Edge-TTS) — 50 ta belgi | 200-400 ms | 0 (CPU) |
| Face matching (cosine similarity) | <1 ms | 0 |
| Face registration (browser) | 500-800 ms | 0 (GPU) |
| JWT auth | <1 ms | 0 |
| SQLite query (indexed) | 1-5 ms | 0 |

**Eng og'ir vaziyat:** 2 shifokor birdaniga scribe ishlatsa (LLM + STT) → ~9 GB VRAM

---

## 📄 Litsenziya

MIT

---

*Falcon AI OS — klinikangizni AI bilan quvvatlang. To'liq lokal, maxfiy, tez.*
