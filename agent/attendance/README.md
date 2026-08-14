# Xodimlar davomati — yuz tanish (klinika kompyuterida)

Kirish eshigi oldidagi kamera xodimni taniydi va **keldi / ketdi** ni yozadi.

## Asosiy qoida

**Yuz shablonlari klinika kompyuteridan chiqmaydi.** Serverga faqat
`{ism, keldi/ketdi, vaqt}` boradi — kuniga ~20 KB.

Sabablari:
- **Huquqiy** — biometrik ma'lumot alohida toifa, O'zbekiston fuqarolarining
  shaxsiy ma'lumotlari mamlakat hududidagi serverda saqlanishi kerak.
  Bizning VPS Germaniyada.
- **Trafik** — video oqimini serverga yuborish oyiga ~415 GB/kamera.
- **Uzilishga chidamlilik** — internet yo'q bo'lsa agent ishlashda davom
  etadi, hodisalarni navbatga yig'adi, aloqa tiklangach jo'natadi.

---

# O'rnatish

## 1. Kamerani tekshiring — **birinchi navbatda**

Yuz tanish yuz **~80px+** bo'lganda ishonchli. Shift kamerasida odamlar
uzoq bo'lgani uchun yuz 20-30px chiqadi va tizim **ishlamaydi**.

Kamera qo'yish yoki sotib olishdan oldin o'lchang:

```bash
pip install -r requirements.txt
python measure-camera.py --device 0 --show
```

NVR kanalini tekshirish:
```bash
python measure-camera.py --nvr 192.168.100.188 --user admin --channel 12
```

Natija:
```
Yuz kengligi (piksel):
  o'rtacha 104   mediana 98   eng kichik 71   eng katta 132

XULOSA: YETARLI (98px), lekin zaxira kam.
```

**Kam chiqsa** — kamerani kirish eshigi oldiga, **bo'y balandligiga**
(1.5-1.7 m), odamga qaratib qo'ying. Masofa 1-2.5 m.

> **Yorug'lik.** Shishali eshikka qaratilgan kamera yuzni qorong'i qiladi
> (orqadan yorug'lik). Kamerani ichkariga qarating — yorug'lik kamera
> **orqasidan** tushsin.

## 2. Kutubxonalar

```bash
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Modellar (~10 MB) birinchi ishga tushirishda **avtomatik** yuklanadi.

## 3. Xodimlarni ro'yxatga olish

Suratlarni `faces/` papkasiga soling:

```
faces/
  Qurbonov Xoltoji.jpg
  Musayeva Barno/
    1.jpg
    2.jpg
    3.jpg
```

Har xodimga **2-3 ta surat** — turli burchak va yorug'likda. Bitta suratda
tanish ~85%, uchtada ~95%.

> **Ism muhim.** Shifokorlar ro'yxatidagi "Ism Familiya" bilan bir xil
> yozsangiz, davomat avtomatik shifokorga bog'lanadi.

```bash
python enroll.py
```

## 4. Panelda qurilma yarating

`falconmedai.uz` → **Kiosk qurilmalari** → **Yangi qurilma**
- Turi: **Davomat**
- Tokenni nusxalang (faqat bir marta ko'rsatiladi)

## 5. Sozlama

```bash
cp config.example.json config.json
```

`config.json` da ikkita narsani to'ldiring:
```json
"server": { "url": "https://falconmedai.uz", "device_token": "kd_..." },
"camera": { "device": 0 }
```

> `device` — USB kamera indeksi. Bitta kamera bo'lsa `0`. Noutbukning o'z
> kamerasi ham bo'lsa, tashqi kamera odatda `1`.

## 6. Sinov

```bash
python agent.py --preview
```

Oynada yuzingiz ko'rinadi. Yashil quti + ism = tanildi. Qizil = tanilmadi
(piksel o'lchami ham yoziladi).

Ishlagach oynasiz ishga tushiring:
```bash
python agent.py
```

## 7. Doimiy ishlashga qo'yish (Linux)

`/etc/systemd/system/falcon-attendance.service`:

```ini
[Unit]
Description=Falcon davomat agenti
After=network-online.target

[Service]
Type=simple
User=oybek
WorkingDirectory=/opt/falcon-attendance
ExecStart=/opt/falcon-attendance/venv/bin/python agent.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now falcon-attendance
journalctl -u falcon-attendance -f
```

---

# Sozlamalarni tushunish

| Sozlama | Nima qiladi | Tavsiya |
|---|---|---|
| `min_face_px` | Shundan kichik yuz e'tiborga olinmaydi | **80** — pasaytirmang |
| `cosine_threshold` | Tanish qat'iyligi | **0.40** |
| `confirm_frames` | Necha marta ketma-ket tanilsa "keldi" | 3 |
| `absence_timeout_sec` | Shuncha ko'rinmasa "ketdi" | 180 |

### Nega `cosine_threshold` 0.40

Manba loyihada 0.30 edi. Davomat uchun bu **xavfli**: past chegara
"noto'g'ri qabul" ehtimolini oshiradi — A xodim kirganda B "keldi" deb
belgilanadi. Bu davomat tizimining eng yomon xatosi.

O'tkazib yuborish esa zararsiz: odam kadrda bir necha marta ko'rinadi,
keyingi kadrda taniladi.

**Agar xodimlar tanilmayotgan bo'lsa** — avval yorug'lik va yuz o'lchamini
tekshiring, chegarani pasaytirish oxirgi chora.

### Nega `absence_timeout_sec` 180

Qisqa qo'ysangiz (masalan 30), xona ichida yurgan xodim "ketdi" bo'lib
qoladi, keyin qaytib "keldi" — kunlik jadval axlatga aylanadi.

---

# Muammolar

| Belgi | Sabab / yechim |
|---|---|
| `Kamera 0 ochilmadi` | Indeksni tekshiring (`0`, `1`, `2`), kamera band emasmi |
| Yuz topilmayapti | Yorug'lik. `measure-camera.py --show` bilan ko'ring |
| Notanish (`? 0.31`) | Yuz kichik yoki surat sifatsiz. Yana surat qo'shing |
| Boshqa odam nomi chiqyapti | `cosine_threshold` ni **oshiring** (0.45) |
| `Token rad etildi` | Panelda tokenni tekshiring. Hodisalar navbatda saqlanadi |
| `Yuborilmadi` | Internet yo'q — normal. Navbatda turadi, aloqa tiklansa ketadi |

Loglar: `data/agent.log` · Holat: `data/state.json` · Navbat: `data/queue.jsonl`

---

# Cheklovlar — halol ro'yxat

**Tiriklik tekshiruvi yo'q.** Bosib chiqarilgan surat yoki telefondagi rasm
tizimni aldashi mumkin. Xodim boshqa xodim uchun belgilanishi (buddy
punching) to'liq to'silmagan. Bu muhim bo'lsa — kamerani nazorat ostidagi
joyga qo'ying yoki PIN qo'shing.

**Niqob va ko'zoynak.** Tibbiy niqob taqqan xodim ko'pincha tanilmaydi.
Quyosh ko'zoynagi ham xalaqit beradi.

**Egizaklar va o'xshash yuzlar.** SFace ularni ajrata olmasligi mumkin.

**Yorug'lik — asosiy omil.** Qarama-qarshi yorug'likda arzon kamera
yuzni qorong'i qiladi va tanish ishlamaydi. Bu dasturiy emas, jismoniy
muammo.
