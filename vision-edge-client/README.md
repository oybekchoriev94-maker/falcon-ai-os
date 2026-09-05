# Falcon Vision Edge — kamera nazorati klienti

Klinika kompyuterida (Ubuntu, NVIDIA GPU) ishlaydigan xizmat. Hikvision
NVR'dagi kamera kanallarini o'qiydi, har bir zonada odam borligini
aniqlaydi va **faqat strukturalangan hodisani** (video emas, biometrika
emas) Falcon AI OS serveriga imzolangan holda yuboradi.

To'liq protokol: [docs/edge-vision-integration.md](../docs/edge-vision-integration.md).

## Nima qiladi, nima qilmaydi

- ✅ Zonada odam bor/yo'qligini aniqlaydi (YOLOv8, person-detection).
- ✅ Hodisani HMAC-SHA256 bilan imzolab, hash-zanjirlangan holda yuboradi.
- ✅ Internet uzilsa — lokal navbatda saqlaydi, tiklangach yuboradi.
- ❌ Yuz tanimaydi, kimligini aniqlamaydi (v1 — `subject_ref` doim bo'sh).
  Xodim davomat va HRMS kamera-tasdiqlash shu sabab hozircha faqat
  Face ID orqali ishlaydi; Vision Edge faqat zona-nazorat va ombor
  kamera-dalili uchun ma'lumot beradi.
- ❌ Video yoki rasm serverga yubormaydi — hammasi lokal NVR'da qoladi.

## 1-bosqich — Ubuntu tizim tayyorgarligi

```bash
sudo apt update
sudo apt install -y python3.10-venv python3-pip ffmpeg
```

NVIDIA drayver va CUDA GPU STT o'rnatishda allaqachon sozlangan bo'lishi
kerak (`nvidia-smi` GPU'ni ko'rsatishi shart). Agar hali sozlanmagan bo'lsa:

```bash
nvidia-smi   # GPU ko'rinishi kerak, aks holda drayverni avval o'rnating
```

## 2-bosqich — Loyihani joylashtirish

```bash
sudo mkdir -p /opt/falcon-vision-edge
sudo cp -r vision-edge-client/* /opt/falcon-vision-edge/
cd /opt/falcon-vision-edge

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

GPU'da ishlashi uchun PyTorch'ning CUDA versiyasini alohida o'rnating
(requirements.txt umumiy CPU versiyasini tortishi mumkin):

```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
```

## 3-bosqich — Falcon admin panelida Edge node yaratish

VPS'da `EDGE_INGEST_ENABLED=true` va `EDGE_KEY_ENCRYPTION_KEY` sozlangan
bo'lishi shart (`.env`, VPS tomonida — `docs/edge-vision-integration.md`
"Production rollout" bo'limi). Keyin admin/CEO JWT bilan:

```bash
curl -X POST https://falconmedai.uz/api/v1/edge/nodes \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"node_id":"oqtosh-edge-01","clinic_id":"oqtosh","display_name":"Oqtosh lokal kamera serveri"}'
```

Javobdagi `key_id` va **bir martalik** `signing_key`ni darhol saqlang —
qayta ko'rsatilmaydi.

## 4-bosqich — Konfiguratsiya

```bash
cp .env.example .env
nano .env       # FALCON_KEY_ID, FALCON_SIGNING_KEY, NVR_* to'ldiring

cp cameras.example.yaml cameras.yaml
nano cameras.yaml   # haqiqiy kamera kanallari va zonalar
```

`zone_id` qiymatlari backend'dagi zona qoidalari va ombor
kamera-dalili bilan **harfma-harf bir xil** bo'lishi shart (masalan
ombor uchun `ombor` — `/inventory` sahifasidagi standart zona nomi).

```bash
sudo mkdir -p /var/lib/falcon-vision-edge
sudo chown -R $(whoami) /var/lib/falcon-vision-edge
```

## 5-bosqich — Qo'lda sinov

```bash
source venv/bin/activate
python -m vision_edge.main
```

Loglarda `RTSP ulandi` va `Node ro'yxatdan o'tdi` ko'rinishi kerak.
Falcon admin panelida (`GET /api/v1/edge/nodes`) node holati `active`
bo'lishi va `last_seen_at` yangilanib turishi kerak.

## 6-bosqich — systemd xizmat sifatida doimiy ishga tushirish

```bash
sudo useradd -r -s /usr/sbin/nologin falcon-edge || true
sudo chown -R falcon-edge:falcon-edge /opt/falcon-vision-edge /var/lib/falcon-vision-edge

sudo cp falcon-vision-edge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now falcon-vision-edge
sudo systemctl status falcon-vision-edge
journalctl -u falcon-vision-edge -f
```

## Tekshirish (production'da haqiqiy ma'lumot kelayotganini)

1. Falcon paneli → **Xodim nazorati** → Signallar tabida yangi
   `restricted`/`after_hours` signallar ko'rinishi kerak (agar shunday
   zona qoidasi bor bo'lsa).
2. Falcon paneli → **Ombor** → kamera-dalili bo'limida bugungi
   tranzaksiyalar endi "kamerali" deb belgilanishi kerak.

## Muhim ogohlantirish — `state/state.json`

Bu fayl serverdagi hodisa hash-zanjiri bilan sinxron turadi. Fayl
yo'qolsa yoki eski nusxaga qaytarilsa, keyingi yuborishlar
`EDGE_CHAIN_MISMATCH` xatosi bilan rad etiladi va operator aralashuvi
kerak bo'ladi. `/var/lib/falcon-vision-edge/state/` papkasini muntazam
zaxiralang.

## Nosozliklarni tuzatish

| Belgi | Sabab |
|---|---|
| `RTSP ochilmadi` | NVR IP/port/login/parol xato, yoki tarmoq kirishi yo'q |
| `401` / autentifikatsiya xatosi | `FALCON_KEY_ID`/`FALCON_SIGNING_KEY` noto'g'ri yoki kalit rotatsiya qilingan |
| `EDGE_DISABLED` (503) | VPS'da `EDGE_INGEST_ENABLED=true` qilinmagan |
| `EDGE_CHAIN_MISMATCH` (409) | `state.json` server bilan mos emas — yuqoridagi ogohlantirishga qarang |
| GPU ishlatilmayapti (sekin) | `DETECTOR_DEVICE=cpu` bo'lib qolgan yoki CUDA PyTorch o'rnatilmagan |
