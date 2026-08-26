# Edge/NVR kamera integratsiyasi

Falcon Vision Edge videoni klinikaning lokal kompyuterida qayta ishlaydi.
Falcon AI OS SaaS'ga video, RTSP credential yoki yuz biometrikasi yuborilmaydi;
faqat kichik, strukturalangan xavfsizlik hodisalari yuboriladi.

## Xavfsizlik modeli

- Har bir klinika kompyuteri alohida `node_id`, `key_id` va 32-byte signing key oladi.
- Signing key API javobida faqat provisioning/rotation paytida bir marta ko'rsatiladi.
- Server kalitni AES-256-GCM bilan shifrlab saqlaydi.
- Har bir Edge so'rovi SHA-256 body hash va HMAC-SHA256 imzo bilan tekshiriladi.
- Timestamp oynasi 5 daqiqa; nonce qayta ishlatilsa so'rov rad etiladi.
- Eventlar `previous_hash`/`record_hash` zanjiri va `dedup_key` bilan idempotent saqlanadi.
- Barcha Edge jadvallarida PostgreSQL RLS tenant izolatsiyasi yoqilgan.
- Kalit rotatsiyasida eski credential darhol bekor qilinadi.

## Production rollout

1. VPS `.env` faylida yangi kalit yarating: `openssl rand -hex 32`.
2. Natijani `EDGE_KEY_ENCRYPTION_KEY` ga yozing.
3. `EDGE_INGEST_ENABLED=true` qiling va faqat Falcon app konteynerini qayta yarating.
4. Admin JWT bilan Edge node yarating.
5. Javobdagi `key_id` va bir martalik `signing_key` ni lokal Edge secret store'ga kiriting.
6. Edge node registration yuborib, dashboarddagi `last_seen_at` ni tekshiring.

Default holatda `EDGE_INGEST_ENABLED=false`; bu yangi migrationni mavjud VPS'ga
platformaning boshqa modullariga ta'sir qilmasdan chiqarish imkonini beradi.

## Admin API

Admin, CEO yoki superadmin JWT talab qilinadi.

### Node provisioning

`POST /api/v1/edge/nodes`

```json
{
  "node_id": "oqtosh-edge-01",
  "clinic_id": "oqtosh",
  "display_name": "Oqtosh lokal kamera serveri"
}
```

Javobdagi `signing_key` qayta olinmaydi. Yo'qolsa kalitni rotate qiling.

### Node holati va eventlar

- `GET /api/v1/edge/nodes`
- `GET /api/v1/edge/events?camera_id=warehouse-01&event_type=inventory.after_hours_motion&limit=100`
- `POST /api/v1/edge/nodes/:nodeId/rotate-key`

## Edge sync API

- `POST /api/edge/v1/nodes/register`
- `POST /api/edge/v1/events/batch` — bir batchda 1–500 event, body maksimum 1 MiB.

Har bir so'rov quyidagi headerlarga ega bo'lishi kerak:

| Header | Qiymat |
|---|---|
| `X-Falcon-Tenant` | tenant ID |
| `X-Falcon-Clinic` | clinic ID |
| `X-Falcon-Node` | provision qilingan node ID |
| `X-Falcon-Key-ID` | provisioning javobidagi key ID |
| `X-Falcon-Timestamp` | Unix timestamp, sekund |
| `X-Falcon-Nonce` | 16–32 random byte'ning hex ko'rinishi |
| `X-Content-SHA256` | aynan yuborilgan body SHA-256 hex |
| `X-Falcon-Signature` | `v1=<HMAC-SHA256 hex>` |

Imzo uchun canonical matn:

```text
POST
/api/edge/v1/events/batch
<timestamp>
<nonce>
<body_sha256>
```

HMAC secret sifatida bir martalik `signing_key` ishlatiladi. Edge klient JSON'ni
sorted key va bo'shliqsiz canonical formatda yuboradi; server imzoni aynan kelgan
raw body bo'yicha tekshiradi.

## Privacy chegarasi

Bu API xodim faoliyati va ombor xavfsizligi uchun event metadata qabul qiladi,
lekin videokuzatuvning o'zi uchun saqlash backend'i emas. Video lokal NVR'da
qoladi. Keyingi bosqichda evidence kerak bo'lsa, qisqa fragmentlar alohida
retention, RBAC, audit va klinika roziligi siyosati bilan qo'shiladi.
