# Falcon AI OS — Hugging Face Spaces Deployment

## Option A: Hugging Face Spaces (Free, for demo/testing)

### 1. Create Space
- Go to https://huggingface.co/new-space
- Owner: your username
- Space name: `falcon-ai-os`
- License: Apache-2.0 or MIT
- SDK: **Docker** (not Gradio/Streamlit)
- Hardware: CPU basic (free) or GPU (paid)

### 2. Repository Structure for Spaces
```
falcon-ai-os/
├── Dockerfile
├── .dockerignore
├── server.js
├── package.json
├── package-lock.json
├── public/
│   ├── dashboard.html
│   ├── scribe.html
│   ├── referral_portal.html
│   ├── face_id.html
│   ├── reception.html
│   ├── inventory.html
│   └── tma.html
└── README.md
```

### 3. Dockerfile
```dockerfile
FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --production

# Copy source
COPY server.js ./
COPY public/ ./public/

# Expose port (HF Spaces uses 7860)
ENV PORT=7860
EXPOSE 7860

# Run
CMD ["node", "server.js"]
```

### 4. .dockerignore
```
node_modules
.git
.env
*.log
.DS_Store
*.sh
deploy-*
```

### 5. Push to Space
```bash
cd /c/Projects/falcon-ai-os
git init
git add .
git commit -m "Initial commit for HF Spaces"
git remote add origin https://huggingface.co/spaces/YOUR_USERNAME/falcon-ai-os
git push origin main
```

### 6. Configure Secrets (Settings → Repository secrets)
| Secret | Value |
|--------|-------|
| `GROQ_API_KEY` | `gsk_...` |
| `HUGGINGFACE_API_KEY` | `hf_...` (your HF token) |
| `TELEGRAM_TOKEN_PATIENT` | `882195...` |
| `TELEGRAM_TOKEN_REFERRAL` | `894837...` |
| `JWT_SECRET` | `openssl rand -base64 32` |
| `PUBLIC_URL` | `https://YOUR_USERNAME-falcon-ai-os.hf.space` |

### 7. Telegram Bot WebApp URLs
- Patient: `https://YOUR_USERNAME-falcon-ai-os.hf.space/tma.html`
- Referral: `https://YOUR_USERNAME-falcon-ai-os.hf.space/referral_portal.html`

---

## Option B: VPS + Hugging Face Inference API (Recommended for production)

### Architecture
```
┌─────────────┐     HTTPS      ┌──────────────────┐
│   Telegram  │◄──────────────►│   Your VPS       │
│   Bots      │   Webhooks     │   (Nginx + PM2)  │
└─────────────┘                │   Node.js App    │
                               │   Port 3000      │
                               └────────┬─────────┘
                                        │ API Calls
                    ┌───────────────────┼───────────────────┐
                    ▼                   ▼                   ▼
             ┌─────────────┐    ┌──────────────┐   ┌─────────────┐
             │   Groq      │    │ Hugging Face │   │  OpenCode   │
             │  (Primary)  │    │  (Fallback)  │   │  (Fallback) │
             └─────────────┘    └──────────────┘   └─────────────┘
              Whisper + Llama3   Whisper + Llama3   DeepSeek
```

### Environment Variables (.env.production)
```bash
# Required
GROQ_API_KEY=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
HUGGINGFACE_API_KEY=hf_your_huggingface_token_here
TELEGRAM_TOKEN_PATIENT=8821955211:AAGn_P-Am3OWqGxxajI49q3fNvVLhfh7GV8
TELEGRAM_TOKEN_REFERRAL=8948373397:AAFMB5A_yIyIC6itvU6AfsX753yyOqNr_zg
JWT_SECRET=your_64_char_random_string
PUBLIC_URL=https://klinika-hayot.uz

# Optional
OPENCODE_API_KEY=...
OPENAI_API_KEY=...
```

### Getting Hugging Face Token
1. Go to https://huggingface.co/settings/tokens
2. Create new token (Read + Write for Inference API)
3. Copy token (starts with `hf_`)

### Model Access (Required for Llama 3.1 70B)
- Go to https://huggingface.co/meta-llama/Meta-Llama-3.1-70B-Instruct
- Click "Request access" → Accept license
- Wait for approval (usually instant for Meta models)

---

## Option C: Hybrid — VPS for App, HF for Models Only

Use VPS for the Node.js app + Telegram bots, but call Hugging Face Inference API for AI:

```javascript
// In server.js - already implemented with fallback chain:
// 1. Groq (primary) → 2. Hugging Face → 3. OpenCode
```

This gives you:
- ✅ Full control over VPS (custom domain, SSL, Webhooks)
- ✅ Free/cheap model inference via HF
- ✅ No GPU needed on VPS
- ✅ Automatic fallback if one provider fails

---

## Quick Start Commands

### For VPS (DigitalOcean/Hetzner/AWS):
```bash
# 1. Create Ubuntu 24.04 droplet (2GB RAM minimum)
# 2. SSH in
ssh root@your-vps-ip

# 3. Run deploy script
curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/deploy-vps.sh | bash -s your-domain.com admin@your-domain.com

# 4. Edit .env.production
nano /opt/falcon-ai-os/.env.production

# 5. Restart
pm2 restart falcon-ai-os
```

### For Hugging Face Spaces (Free demo):
```bash
# 1. Create Space at hf.co/new-space (Docker SDK)
# 2. Add secrets in Settings
# 3. Push code (see Dockerfile above)
# 4. Space builds automatically
```

---

## Cost Comparison

| Option | Monthly Cost | Pros | Cons |
|--------|--------------|------|------|
| **VPS (DigitalOcean 2GB)** | $12/mo | Full control, custom domain, reliable | Need to manage server |
| **VPS (Hetzner CX22)** | ~€5/mo | Cheaper, good performance | EU only |
| **Hugging Face Spaces (CPU)** | Free | Zero cost, auto-SSL | Sleeps after inactivity, no custom domain, limited resources |
| **HF Spaces (GPU T4)** | $0.60/hr | GPU for local models | Expensive for 24/7 |
| **Railway/Render/Fly.io** | $5-20/mo | Easy deploy, managed | Vendor lock-in |

---

## Recommended: **VPS + Hugging Face Inference API**

Best of both worlds:
- Your own domain (`klinika-hayot.uz`)
- Telegram WebApps work perfectly (HTTPS + custom domain)
- Fallback to HF if Groq fails
- No GPU costs
- Full control

Run the deploy script: `./deploy-vps.sh your-domain.com admin@your-domain.com`