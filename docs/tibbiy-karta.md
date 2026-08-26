# Bemorning tibbiy kartasi — tuzilishi (O'zbekiston MSSV, forma 003)

> Manba: `C:/Projects/falcon-ai-os/tibbiy karta/` papkasidagi 18 sahifa
> stasionar tibbiy karta (Gulnigor Shifo Med — "Oqtosh" klinikasi, Termiz).
> O'z. RSSV 2025 yil 26 dekabrdagi № 399-sonli buyrug'i bilan tasdiqlangan
> **003-raqamli tibbiy hujjat shakli** asosida.
>
> Bu hujjat — tizimimizda "istoriya" bo'limi qanday to'la bo'lishi kerakligining
> professional andozasi. Har bo'lim uchun ma'lumotlar bazasi jadvali (bor yoki
> qo'shilishi kerak) va qaysi shifokor/xodim to'ldirishi ko'rsatilgan.

---

## 1. Muqova — Bemorning tibbiy kartasi №
**Forma 003, 1-varaq.** Kim to'ldiradi: **qabulxona (reception)**.

| Maydon | Izoh | Tizimda |
|---|---|---|
| Med ID raqami | Klinika ichida noyob | `patients.medical_record_number` (MRN) ✓ |
| Karta № | Statsionar karta raqami | `admissions.id` bilan bog'lanadi |
| Kasalxonaga yotqizilgan kun/vaqt | Timestamp | `admissions.admission_date` ✓ |
| Kasalxonadan chiqarilgan kun/vaqt | Timestamp | `admissions.discharge_date` ✓ |
| Bo'lim, xona №, o'tkazilgan bo'limga | Palata | `admissions.ward_id`, `bed_id` ✓ |
| Kun yotib davolangan | Avto (hisoblanadi) | discharge - admission |
| Olib yurish turi | aravachada / zambilda / o'zi yura oladi | **YO'Q** — qo'shilishi kerak |
| Qon guruhi, rezus | ABO + Rh | **YO'Q** — `patients` ga qo'shish |
| Dorilarning nojo'ya ta'siri | Allergiya | **YO'Q** — `patients.allergies` |
| Familiya, ism, otasining ismi | F.I.SH | `patients.first/middle/last_name` ✓ |
| Jinsi | erkak/ayol | `patients.gender` ✓ |
| Tug'ilgan sana | | `patients.birth_date` ✓ |
| Bo'yi, vazni, tana harorati | Antropometriya + t° | **YO'Q** — daily_notes'ga qisman bor |
| Doimiy yashash joyi | Manzil (shahar/qishloq) | `patients.region/district/address` ✓ |
| Qarindoshlarining telefoni | Yaqinlar | **YO'Q** — `patient_contacts` |
| Ish joyi, kasbi, lavozimi | | **YO'Q** — `patients.occupation` |
| Nogironlik turi va guruhi | | qisman `patients.benefit_category` |
| Bemor qayerdan yuborilgan | Yo'llovchi klinika | `admissions.referral_id` |
| Shoshilinch keltirilganmi + transport | | qisman `admission_type` |
| Kasallik boshlangandan o'tgan vaqt | | `daily_notes.complaints` matnda |
| Yo'llanmadagi tashxis | | `admissions.diagnosis_initial` ✓ |

---

## 2. Qabul bo'limidagi birlamchi ko'rik varaqasi (3-bet)
Kim to'ldiradi: **qabul bo'limi shifokori** (bemor keltirilgan zahoti).

- **Sana, vaqti**
- Bemor F.I.O, yoshi
- **Keltirilish usuli**: o'zi kelgan / TTYO orqali / boshqa DPMlardan o'tkazilgan
- **Shikoyati**:
  - og'riq (joylashuvi, xususiyati)
  - og'riqli xuruj boshlanishi
  - boshqa shikoyatlar
- **Anamnez morbi** — kasallik tarixi
- **Anamnez vitae** — hayot anamnezi
- **Status praesens** — ko'rik davrida organlardagi patologik o'zgarishlar
- **Status localis** — mahalliy holat
- **Taxminiy tashxis**

> Tizimda: yangi `patient_intake_examinations` jadval kerak. Yoki
> `daily_notes` ga `intake` shift qo'shib qayta ishlatish.

---

## 3. Sanitar-Epidemiologik anamnez (6-bet oxiri)
Kim to'ldiradi: qabul shifokori. **SanPIN 03-42-17** asosida.

1. Infekcion bemorlar bilan kontaktda bo'lganmi? (br tif, salmonelyoz,
   virusli gepatit, tuberkulyoz, tanosil kasalliklari...) — qayerda, qachondan qachongacha.
2. Turar joyidan 2 hafta/1 oy davomida boshqa joyga borganmi? Qaerga, qachon qaytgan.
3. **Bemor qanday infekcion kasalliklarni bosh­dan kechirgan**
4. Statsionar/ambulator sharoitda davolanganmi? Gemotransfuziya olganmi? So'nggi 6 oyda jarrohlik amaliyoti bo'lganmi?
5. Har qanday parenteral muolaja olganmi (igna sanchilishi bilan)?
6. Maishiy xizmatdan (manikyur, pedikyur, pirsing, tatuaj...) foydalanganmi?
   Qayerda va qachon?
- **Tashxis**
- **Olib borish tartibi**
- **Hakim** (imzo)

> Tizimda: `patient_epi_anamnesis` jadval yoki `patients.epi_json` maydoni.
> Bu bo'lim **majburiy** — infekcion nazorat uchun.

---

## 4. Davolovchi vrachning ko'rigi (ixtisos bo'yicha, misolda ginekologiya)
Kim to'ldiradi: davolovchi shifokor (yotqizilgandan keyin).

- **Shikoyati** (ixtisosga xos — qorin pastidagi og'riq, konli ajralma...)
- **Kasallik tarixi**
- **Hayot anamnezi**
- **Dori-darmonlarga allergiya**: bor / yo'q
- **Ginekologik anamnez** (ayollarda): hayz sikli, nikoh yoshi, tug'gan, tibbiy abort, oxirgi hayz
- **Bemorni obektiv tekshirishlari**: umumiy ahvoli, teri rangi, limfa tugunlari, suyak-mushak, pulsi, A/D, yurak tonlari, o'pkada nafas, qorni, jigar-taloq, Pasternackiy simptomi, siyish, ich kelishi
- **Status genitalis / Status localis** (ixtisosga qarab)
- **Ko'zgu** (ginekologiya)
- **PV** (ginekologik palpatsiya)

> Tizimda: bu **AI Scribe** ning to'g'ridan-to'g'ri ishi. Shifokor diktovka
> qiladi — shablonli maydonlarga to'ladi. `patient_consultations.data_json`
> ichida saqlansin. Ixtisos bo'yicha shablon (ginekolog/kardiolog/nevropatolog...)
> allaqachon `MEDICAL_SKILLS` da bor — kengaytiriladi.

---

## 5. Bo'lim shifokorining ko'rigi (tekshirish va davolash rejasi) — 5-bet
Kim to'ldiradi: bo'lim mudiri (birlamchi ko'rikdan keyin, obhod).

Chiziqli erkin matn — bemor holati va **davolash rejasini bekitish**.

> Tizimda: `admissions.treatment_plan` (text) + `admissions.reviewed_by_head_at`.

---

## 6. Kundalik (KUNDALIK) — 6-bet, bosh sarlavha "SANA"
Kim to'ldiradi: **davolovchi shifokor har kuni**. Bu — asosiy obhod jurnali.

Har kuni sana bilan chiziqli matn. Bemor holatining dinamikasi.

> Tizimda: `daily_notes` bor ✓. **Ovozli obhod** allaqachon ulangan
> (Migration 013). Sana bo'yicha vertikal jurnal ko'rinishida
> `/patients/[id]` istoriyada chiqarilsin.

---

## 7. Vrach ko'rigi (obhod shabloni) — 3 marta kunda
Har ko'rikda:
- **CAHA** (sana + vaqt)
- **PS** — puls, shikoyat (dinamika)
- **t°** — tana harorati
- **A/D** — arterial bosim

Har blok pastida standart tekst (shablon):
- Umumiy ahvoli: qoniqarli / o'rta og'ir / og'ir / o'ta og'ir
- Teri va shilliq qavatlar: och pushti / oqimtir / sarg'ish
- Qorni: yumshoq / og'riqli / dam­lagan; ichak peristal'­tikasi
- Jigar-taloq: kattalashgan / kattalashmagan
- Pasternackiy simptomi: manfiy / musbat
- Ich kelishi: keladi / yo'q; peshob: muntazam / katetir
- Jarohati holati: toza / birlamchi / yiringli / qizargan → asept boglam

- **Vrach imzosi**

> Tizimda: bu — kunlik obhodning **shablon** qismi. Ovozli yozuvdan LLM
> avto-to'ldiradi (haqiqiy qiymat) — shifokor faqat imzo bosadi.
> `daily_notes.data_json` ichida saqlangan JSON'ni PDF/print­ga chiqaramiz.

---

## 8. Xarorat varaqasi — 6-bet ortida
Kim to'ldiradi: **navbatchi hamshira** har smenada.

Grid (chizmali) — kasallangan kundan chiqargungacha:
| Y o'q (o'lchov) | Qiymatlar |
|---|---|
| Kasalxonaga yotqizilgan kun | 1, 2, 3, ... 16 |
| Ichish urshi (ertalab/kechqurun) | e/k |
| **Qon bosimi** | 200 / 175 / 150 / 125 / 100 / 90 / 75 / 70 |
| **Harorat (t°)** | 41 / 40 / 39 / 38 / 37 / 36 |
| **Puls (chastotasi)** | 140 / 120 / 100 / 80 |

Grafik chizma: shifokor nuqtalarni ulab, dinamikani ko'radi.

> Tizimda: yangi jadval kerak yoki `daily_notes` dagi temperature/BP/pulse
> qiymatlari yetadi — front-end'da vaqt qatorli grafik chiziladi
> (Recharts / Chart.js). Har admission uchun grafik = ekspert ko'rinishi.
> **Muhim**: hozir daily_notes ovozdan to'ldiriladi → grafik bepul beriladi.

---

## 9. Tayinlangan tekshiruvlar / Buyurilgan muolajalar / Ishlatilgan materiallar (2-varaq)
Kim to'ldiradi: **shifokor** (tayinlaydi), **hamshira** (bajaradi va imzo qo'yadi).

Uch bo'limli grid:
1. **Tayinlangan tekshiruvlar** — sana, tekshiruv nomi, bajarilish sanasi, hamshira imzosi
2. **Buyurilgan muolajalar** — sana, muolaja nomi, bajarilish sanasi, hamshira imzosi
3. **Ishlatiladigan materiallar** — sana, material, bajarilish sanasi, bemor imzosi, kunduzgi/navbatchi hamshira imzosi

> Tizimda: `inpatient_services` bor ✓ — narx bilan. `procedure_material_norms`
> ham bor (avto ombor sarfi uchun). **Kengaytirish**: `prescribed_at`,
> `performed_at`, `performed_by_nurse_id`, `patient_signature_at` qo'shish.

---

## 10. Dori-vositalar VARAG'I (buyurish jurnali) — 8-bet
Kim to'ldiradi: **shifokor** buyuradi, **hamshira** bajaradi.

Yuqori chek: KB №, bemor F.I.SH, davolovchi shifokor F.I.SH, bo'lim, palata №.

Ustunlar:
| № | Sana | Shifokor tomonidan buyurilgan dori-vositalari (nomi, miqdori, yuborish usuli) | Muolajani bajarish vaqti | Dori-darmon manbai | Bajarilish sanasi (kolonkalar) |
|---|---|---|---|---|---|

Har dori nomi qarshisida `shifokor` va `hamshira` qatorlarida imzo.
Pastda **Parhez stoli №**.

Imzolar: davolovchi shifokor, kunduzgi hamshira, navbatchi hamshira, bemor.

> Tizimda: `prescriptions` bor ✓. **Kengaytirish**:
> - `prescriptions.route` (ichish / v/m / v/v / t/o) — bor ✓
> - `prescriptions.frequency` — bor ✓
> - Yangi `prescription_executions` jadval: har bajarilish (hamshira ID, vaqt)
> - `admissions.diet_number` — Pevzner parhez stoli №

---

## 11. Tekshiruv rejasi + Ko'rsatilgan yordam (4-bet)
Standart 10 ta tekshiruv (tanlash):
1. Umumiy qon taxlili
2. Umumiy peshob taxlili
3. Bioximik tahlil (ko'rsatkichlari)
4. Koagulogramma
5. EKG
6. Rentgen tekshiruvi
7. UTT (ultratovush)
8. EFGDS
9. MSKT / MRT
10. Mutaxasislar maslahati

**Ko'rsatilgan yordam** — jadval:
| № | Buyurilgan dori-vositalari | Bajarilish vaqti | Shifokor | Hamshira |
|---|---|---|---|---|

**Dinamikadagi ahvoli** (matn) — **Tavsiyalar** (matn) — F.I.O shifokor + majmua bo'yicha mas'ul shaxs.

> Tizimda: yangi `lab_orders` jadval kerak — 10 ta standart tekshiruv
> checkbox bilan. Natijalar `lab_results` da. Hozir `medical_reports`
> qisman bor.

---

## 12. Yakuniy tibbiy xulosa (kasallik / o'limdan keyingi) — 7-bet
Kim to'ldiradi: **davolovchi shifokor + bo'lim mudiri + bosh shifokor muovini** (uch imzo).

Erkin matn. **Muhim eslatma**: o'limdan keyingi yakuniy xulosa bemorning
JSHSHIR orqali yashagan poliklinikasiga **elektron tizim orqali yuborilishi shart**.

> Tizimda: `discharges.epicrisis_text` bor ✓. **Yangi**:
> - `discharges.death_summary_text` (o'lim holida)
> - `discharges.sent_to_polyclinic_at` (elektron yuborish jurnali)
> - **AI**: epikrizni avto-yaratish (daily_notes + prescriptions'dan)

---

## 13. Operatsiyaga rozilik BAYONNOMASI — Umumiy
Kim to'ldiradi: **bemor va qarindoshlari** operatsiyadan oldin.

Standart matn (roziliklar):
- Operatsiya davomida kutilmagan holatlar ehtimoli
- Qon yo'qotish, infeksiya, yurak va boshqa a'zolar faoliyati buzilishi mumkinligi
- Natijalarga kafolat berilmasligi
- Qayta operatsiya zarurati mumkinligi
- Allergiya, spirtli ichimliklar, giyohvand moddalar haqida ma'lumot berish majburiyati
- Shifoxona dorixonasida yo'q dori — xususiy dorixonadan olish majburiyati
- Qon quyilishiga rozilik
- Qarindoshlar qon topshirishga rozi

Imzolar: **Bemor**, **Qarindoshi** (kimligi, F.I.SH, imzo) — 2 ta qarindosh.

> Tizimda: yangi `patient_consents` jadval — kind='surgery_general' / 'blood_transfusion' / 'anesthesia' / 'covid' + PDF fayl saqlash + bemor imzosi (tablet/imzo skani).

---

## 14. Operatsiyaga rozilik BAYONNOMASI (Ginekologiya) — ixtisoslashgan
Aynan ginekologiyaga oid operatsiyalar ro'yxati (chizib qo'yish uchun):
- Tuxumdon kistasi
- Bachadondan tashqari xomiladorlikda tubektomiya
- Konservativ miomektomiya
- Ekstirpatsiya, amputatsiya, amputatsiya mioma matki
- Bachadon tanasining noto'liq tushishi, qin oldi va orqa devori plastikasi
- Qin devorining IV darajali yirtilishi
- Bachadon bo'yni konizatsiyasi
- Bartolinit
- Vlagalishnaya ekstirpatsiya, IJK (ichki jinsiy kesish)

Bemor rozilik matni, F.I.O + tug'ilgan yili + yashash manzili + operatsiya tashxis nomi + imzolar.

> Tizimda: har ixtisos uchun rozilik shabloni. `consent_templates` jadval,
> `patient_consents` da template_id + selected_options JSON.

---

## 15. Pullik tibbiy xizmat SHARTNOMASI
Bo'lim: **buxgalteriya + bemor**.

- Shartnoma №, sana
- Bajaruvchi (klinika rekvizitlari — Gulnigor Shifomed, INN, hisob raqami, MFO...)
- Mijoz (bemor) yoki Homiy (uchinchi shaxs)
- I. **Shartnoma mavzusi** — xizmatlar jadvali (nomi, o'lchov birligi, soni, narxi, summa) — 8 qator + jami
- II. **Tomonlar huquq va majburiyatlari** (2.1 - 2.4)
- III. Tomonlarning javobgarligi (3.1)
- IV. **Boshqa shartlar** — allergiya/noto'g'ri tashxis holida javobgarlik
- V. **Nizolarni hal etish** (sud tartibi)
- VI. **Yakuniy qoidalar** — 3 nusxa
- VII. Yuridik manzillar + imzolar (Bajaruvchi rahbar, Mijoz, Homiy)

> Tizimda: yangi `service_contracts` jadval — id, patient_id, contract_number,
> total_amount, items_json, signed_at, pdf_path. Tenant rekvizitlarini
> `tenants` ga qo'shish (INN, hisob raqam, MFO, direktor F.I.O).

---

## 16. Bajarilgan xizmatlar DALOLATNOMASI (Akt)
Bo'lim: **buxgalteriya**. Shartnoma davomi — haqiqatda ko'rsatilgan xizmatlar jadvali:

| № | Ko'rsatilgan tibbiy xizmatlar nomi | O'lchov birligi | Narxi | Summa |
|---|---|---|---|---|

- **Davolanish uchun jami** + **Umumiy**
- Bemor tomonidan to'langan mablag'
- Bemorga qaytariladigan / undiriladigan mablag'
- Imzolar: bo'lim boshlig'i, davolovchi shifokor, xozinach, bemor + muhr

> Tizimda: `inpatient_services` bor ✓. **Kengaytirish**: `service_acts` jadval
> — hisob-kitob akti PDF, imzolar. Chiqarish paytida avto-yaratiladi.

---

## Xulosa: TIZIMGA QO'SHILISHI KERAK BO'LGAN BO'LIMLAR

Yashilda — bor, sariqda — kengaytirish kerak, qizilda — yo'q va qo'shish kerak.

| # | Bo'lim | Holat | Qo'shish rejasi |
|---|---|---|---|
| 1 | Bemor asosiy ma'lumoti (F.I.O, MRN, telefon, manzil) | ✅ Bor | — |
| 2 | Qon guruhi, Rh, allergiya | 🟨 Yo'q | `patients.blood_group`, `rh_factor`, `allergies_text` |
| 3 | Qarindosh telefonlari | 🟨 Yo'q | `patient_contacts` jadval |
| 4 | Ish joyi, kasbi, nogironlik | 🟨 Yo'q | `patients.occupation`, `disability` |
| 5 | Statsionar karta (yotqizish, koyka) | ✅ Bor | Olib yurish turi (`admissions.transport_type`) |
| 6 | Birlamchi qabul ko'rigi (status praesens/localis) | 🟨 Qisman | `patient_intake_examinations` |
| 7 | Epi-anamnez (SanPIN) | 🟥 Yo'q | `patient_epi_anamnesis` — infekcion nazorat |
| 8 | Davolovchi shifokor birlamchi ko'rigi | ✅ AI Scribe | Shablonlarni ixtisos bo'yicha kengaytirish |
| 9 | Bo'lim mudiri ko'rigi va davolash rejasi | 🟨 | `admissions.treatment_plan`, `head_reviewed_at` |
| 10 | Kundalik (obhod) | ✅ Bor + ovoz | daily_notes ✓ |
| 11 | 3x kunlik vrach ko'rigi (PS/t/AD shablon) | 🟨 | `data_json` ichida bor — front-end vizualizatsiya |
| 12 | **Xarorat varaqasi (grafik)** | 🟨 | daily_notes qiymatlari asosida chart |
| 13 | Tayinlangan tekshiruvlar | 🟥 | `lab_orders` + `lab_results` |
| 14 | Buyurilgan muolajalar | ✅ | `inpatient_services` |
| 15 | Ishlatilgan materiallar (ombor bilan) | ✅ | `procedure_material_norms` |
| 16 | **Dori-vositalar VARAG'I** (buyurish + bajarish) | 🟨 | `prescription_executions` jadval |
| 17 | Parhez stoli (Pevzner №) | 🟥 | `admissions.diet_number` |
| 18 | Tekshiruv rejasi (10 turdagi checklist) | 🟥 | `lab_orders.type` (enum) |
| 19 | Ko'rsatilgan yordam jadvali | 🟨 | `inpatient_services` yig'ma |
| 20 | Chiqarish epikrizi | ✅ Bor | `discharges.epicrisis_text` |
| 21 | O'limdan keyingi yakuniy xulosa | 🟥 | `discharges.death_summary` + poliklinikaga e-yuborish |
| 22 | **Operatsiya rozilik (umumiy + ixtisos)** | 🟥 | `patient_consents` + `consent_templates` |
| 23 | **Pullik tibbiy xizmat shartnomasi** | 🟥 | `service_contracts` + tenant rekvizitlari |
| 24 | **Xizmatlar bajarilishi dalolatnomasi (akt)** | 🟥 | `service_acts` (chiqarishda avto) |

---

## Amaliyotga qo'yish tartibi (istoriya kengaytirish rejasi)

Bosqichlarga bo'lish (`/patients/:id` sahifasidagi bo'limlar):

### Bosqich A — Bemor kartasini to'ldirish
- Migration 014: `patients` ga qo'shish — `blood_group`, `rh_factor`, `allergies`, `occupation`, `disability_group`, `emergency_contact_name`, `emergency_contact_phone`
- UI: kartani tahrirlash formasi shu maydonlar bilan

### Bosqich B — Birlamchi ko'rik + epi-anamnez
- Migration 015: `patient_intake_examinations` + `patient_epi_anamnesis`
- Backend: POST/GET; qabul shifokori roli
- UI: yotqizish dialogida "Birlamchi ko'rik" bosqichi (SanPIN checklist)

### Bosqich C — Xarorat varaqasi (grafik)
- Backend: GET /admissions/:id/vitals-chart (daily_notes yig'ma)
- UI: `/patients/:id` istoriya sahifasida her admission ostida Recharts grafik
  (t°, A/D, puls dinamikasi)

### Bosqich D — Laborator tekshiruvlar
- Migration 016: `lab_orders` + `lab_results` (10 standart + custom)
- Backend: buyurish/bajarish; PDF natija saqlash
- UI: `/lab` sahifa (laborantga) + istoriyada natijalar

### Bosqich E — Retsept va bajarish jurnali
- Migration 017: `prescription_executions` (hamshira imzosi)
- UI: obhod ekranida "bugungi dori jadvali" + tick

### Bosqich F — Rozilik + shartnoma + akt
- Migration 018: `patient_consents`, `consent_templates`, `service_contracts`, `service_acts`
- Backend: PDF generatsiya (jspdf/puppeteer bilan tayyor 003-forma)
- UI: yotqizishda shartnoma imzosi (tablet, imzo saqlash), chiqarishda akt

### Bosqich G — Chop etish (print-ready 003-forma)
- **Har bo'lim uchun A4 chop shakli** — hozirgi elektron ma'lumot 003-formatida qog'ozga ham chiqsin (COVID vaqtidagi hujjatlashtirish va tekshirishlar uchun)
- Backend: /admissions/:id/print/003 (barcha sahifalarni birlashtirilgan PDF)

---

## AI ning o'rni

Shu tuzilishga qarab:

1. **Qabul shifokori** birlamchi ko'rik paytida ovozda gapiradi → LLM shikoyat/anamnez/status maydonlariga to'ldiradi.
2. **Davolovchi shifokor** obhodda gapiradi → LLM PS/t°/A/D + shablon matnini ajratadi (allaqachon ishlaydi ✓).
3. **Xarorat varaqasi grafigi** — daily_notes qiymatlaridan bepul.
4. **Epikriz** — chiqarishda LLM barcha yotgan davri (obhodlar, muolajalar, tekshiruvlar) asosida avto-tuzadi. Shifokor faqat tahrirlaydi va imzo qo'yadi.
5. **Anomaliyalarni sezish** — t°>39, A/D keskin tushishi, puls>110 → real-time ogohlantirish.

Bu andozaga rioya qilinsa, tizim **haqiqiy klinik hujjatchilikni to'liq raqamlashtiradi** — qog'ozda yozib, keyin kompyuterga kiritish shart emas.
