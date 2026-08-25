# Production deployment

Falcon AI OS productionda faqat Docker Compose orqali deploy qilinadi. App,
frontend va STT konteynerlari tashqi port ochmaydi; internet trafik faqat Caddy
orqali `80/443` portlariga kiradi.

## GitHub secrets

Repository Actions uchun quyidagilar sozlanadi:

- `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`.

Container image'lar GitHub Container Registry (`ghcr.io`) ga Actions tomonidan
beriladigan qisqa muddatli `GITHUB_TOKEN` orqali push va pull qilinadi. Alohida
DockerHub credentiali yoki uzoq muddatli registry tokeni saqlanmaydi.

CI testlardan keyin backend, frontend va STT uchun bir xil Git commit SHA bilan
immutable image yaratadi. VPS deploy aynan shu SHA teglarini eksport qiladi,
image'larni pull qiladi va `--no-build` bilan ishga tushiradi. Shu sabab VPS'dagi
eski lokal build tasodifan productionga chiqmaydi.

## VPS environment

`/opt/falcon-ai-os/.env` fayli `.env.example` asosida yaratiladi. Kamida quyidagi
qiymatlar haqiqiy, noyob secretlar bilan almashtiriladi:

- `POSTGRES_PASSWORD`, `APP_DATABASE_PASSWORD` — kamida 16 belgi va URL-safe;
- `JWT_SECRET`, `INTERNAL_SECRET` — kamida 32 belgi;
- `JWT_REFRESH_WINDOW_DAYS` — 1–30 kun (tavsiya: `7`), muddati o'tgan access tokenni yangilashning maksimal oynasi;
- `ADMIN_PASSWORD` va barcha `SEED_*_PASSWORD` — kamida 12 belgi;
- `PUBLIC_URL` — HTTPS URL;
- `PUBLIC_DOMAIN`, `SERVER_IP`.

Edge/NVR control-plane dastlab o'chiq turadi. Faollashtirishdan oldin kalitni
VPS'ning `.env` fayliga yozing; kalitni Git yoki loglarga chiqarmang:

```bash
openssl rand -hex 32
```

Natijani `EDGE_KEY_ENCRYPTION_KEY` ga saqlang va shundan keyingina
`EDGE_INGEST_ENABLED=true` qiling. Kalit bo'lmasa modul `503 EDGE_DISABLED`
qaytaradi, platformaning qolgan funksiyalari ishlashda davom etadi.

Payment, SMTP, Telegram va AI provider qiymatlari faqat tegishli funksiya
yoqilganda talab qilinadi.

## Startup gate

Deploy quyidagi tartibda bajariladi:

1. PostgreSQL healthcheck;
2. owner role bilan migrations;
3. `falcon_app` non-owner role provisioning;
4. STT healthcheck;
5. backend readiness — application va platform DB poollari;
6. frontend healthcheck;
7. Caddy reverse proxy.

Biror bosqich 900 soniyada healthy bo'lmasa deploy job xato bilan to'xtaydi.

## Manual deploy

```bash
cd /opt/falcon-ai-os
./scripts/deploy.sh
```

## Rollback

GHCR'da oldingi Git SHA teglari saqlanadi. Zarurat bo'lsa oldingi SHA bilan
uch image qiymatini eksport qilib Compose'ni qayta ishga tushirish mumkin:

```bash
export BACKEND_IMAGE="ghcr.io/OWNER/falcon-ai-os:PREVIOUS_SHA"
export FRONTEND_IMAGE="ghcr.io/OWNER/falcon-ai-os-frontend:PREVIOUS_SHA"
export STT_IMAGE="ghcr.io/OWNER/falcon-ai-os-stt:PREVIOUS_SHA"
docker compose pull app frontend stt
docker compose up -d --no-build --force-recreate --wait --wait-timeout 900
```

Schema rollback alohida tekshiriladi: backward-incompatible migration bo'lsa
faqat image rollback qilish yetarli emas.
