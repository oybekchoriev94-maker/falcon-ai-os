# Hermes Agent — Falcon AI OS boshqaruv rejasi

Sana: 2026-08-09

Bu hujjat: Hermes Agent klinikaga qanday ulanadi, qanday ishlar bajaradi,
qanday tartibda bajaradi. Maqsad — klinikada istoriya yozish, qabul,
statsionar, moliya va kadrlarni avtomatlashtirish.

---

## 1. Hozirgi holat

Men platforma kodini tekshirdim. Natija:

- Backend Express + PostgreSQL ishlaydi, 30 dan ortiq yo'nalish bor.
- Frontend Next.js da qurilgan. Kiosk sahifasi bor.
- Telegram bot va Mini App bor.
- Kiosk tizimi bor: QR, navbat, bron qilish.
- 27 ta AI agent bor: ovoz yozish, obhod, epikriz, lab, triage, chatbot va boshqalar.
- Istoriya uchun belgi bor: intake, lab, retsept, rozilik, shartnoma, akt.
- To'liq PDF istoriya (003-forma) hali tayyor emas.
- Monitoring yo ishlamaydi: health check, kunlik hisobot, zaxira yo'q.

Xulosa: yozish qismi tayyor. Nazorat qismi yo'q. Hermes aynan shuni to'ldiradi.

---

## 2. Hermes nima qiladi

Hermes to'rt ro'lda ishlaydi:

1. Qo'riqchi: 24/7 monitoring.
2. Operator: kunlik hisobot, eslatma, zaxira.
3. Orkestr: AI agentlarni boshqarish, natijalarni kuzatish.
4. Quruvchi: yetishmagan qismlarni kodlab ong qilish.

Hermes klinika ma'lumotini tashqariga chiqarmaydi. Ular API orqali
ishlaydi, natijasi Telegram orqali keladi.

---

## 3. Bemor yo'li va bo'sh joylar

1. Qabul: kiosk, Telegram yoki ochiq qabul.
   - Ovozli qabul bor.
   - Triage (saralash) bor.
2. Ko'rik: shifokor.
   - Ovozdan yozish bor (scribe).
   - Tashxis taklifi bor.
3. Natijalar: lab, EKG, UTT.
   - Laborant yordamchisi bor.
   - Natija saqlash bor.
4. Statsionar: yotqizish.
   - Kundalik yozuv bor (obhod).
   - Havfli natija bildirish bor (vitals).
   - Dori jadvali bor.
5. Chiqish: epikriz bor.
6. To'lov: kassa, Pay, Click bor.

Bo'sh joylar:

- Istoriyani bitta bosishda PDF qilish (form 003).
- Kunlik moliyaviy hisobot.
- Kunlik klinika hisobot (bemorlar, daromad).
- Monitoring va zaxira.
- AI sifatini kuzatish.

---

## 4. Ish rejasi (90 kun)

### Bosqich 1 — Monitoring (birinchi hafta)

- Health tekshirish har 5 daqiqada.
- Kiosk holatini tekshirish.
- Disk va bazani tekshirish.
- Xatarlar logini kuzatish.
- Ma'lumot zaxirasi har kecha.
- To'lov webhook tekshirish.

Bu ishlar Telegram orqali ogohlantirish yuboradi.

### Bosqich 2 — Kundalik hisobot (ikki hafta)

- Soat 18:00 da kundalik hisobot: bemorlar, ko'riklar, daromad.
- Ertalab: bugun rejalashtirilgan bemorlar va muolajalar eslatmasi.
- To'lanmagan hisoblar ro'yhati.
- Haftalik hisobot.

### Bosqich 3 — Klinik nazorat (uch-to'rt hafta)

- AI agentlar statistikasi.
- Xavfli ko'rsatkich bo'lsa — shifokorga telegramda xabar.
- Lab natijasi kritik bo'lsa — darhol xabar.
- Epikriz sifatini ko'rish.

### Bosqich 4 — Qolgan qismlarni qurish (ikkinchi oy)

- 003-forma PDF yaratish.
- Kartada qon guruhi, rezus, allergiya, qarindosh telefoni.
- Xulosa matni va epikriz.
- Chiqishda shartnoma va akt PDF.

### Bosqich 5 — Moliya va tahlil (uchinchi oy)

- Pay, Click, naqd — hisob solishtirish.
- Shifokor samaradorligi.
- Xizmatlar rentabelligi.
- Qayta kelmagan bemorlar tahlili.

---

## 5. Qoidalar — yakuniy

Hermes hechqachon:

- Tashxis qo'ymaydi, faqat taklif beradi.
- Dori buyurmaydi, faqat shifokor tasdiqlaydi.
- Pul o'tkazmaydi, faqat hisobot beradi.
- Istoriyani "auto" belgisi bilan yozadi. Shifokor ko'radi va tasdiqlaydi.

Bu qoidalar ishonch va sifat uchun.

---

## 8. Boshlash

Hozirgi holat nazarda tutsing: avval monitoring (Bosqich 1), keyin
kundalik hisobot (Bosqich 2), keyin qolgan funksiyalar. Har bosqich
uchun alohida rozilik beriladi va natija Telegram orqali tasdiqlanadi.