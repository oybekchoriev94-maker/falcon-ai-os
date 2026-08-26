# Falcon AI OS — Agent orkestratori va rollar

Bu hujjat: tizimdagi har AI agentning **aniq roli, chegarasi, javobgarligi**
va qanday chaqirilishini yozadi. Tibbiy sohada AI faqat **shifokorning
qo'li ostidagi vosita**. Har agent qat'iy chegara ichida ishlaydi.

---

## Umumiy tamoyillar (barcha agentlar uchun)

1. **AI qaror qilmaydi.** Yechim har doim shifokor/laborantda.
   Agent faqat *tayyorlaydi*: matnni tozalaydi, maydonlarga ajratadi,
   variantlar taklif qiladi.
2. **Har agent tuzilgan JSON yoki matn qaytaradi** — foydalanuvchi
   ko'radi, tuzatadi, tasdiqlaydi va shundan keyingina bazaga yoziladi.
3. **Ish natijasi audit uchun `data_json` yoki tegishli maydonda saqlanadi** —
   AI qaysi versiya, qaysi promt bilan qanday chiqargani izlanadi.
4. **Xatoga chidamlilik.** LLM/STT xato bo'lsa xom matn saqlanadi va
   foydalanuvchiga aniq xato ko'rsatiladi (`code`+`error` bilan).
5. **Tenant izolyatsiyasi.** Har agent `ctx.tenantId` bilan chaqiriladi va
   bazaga tegilsa faqat shu tenant ichida.
6. **Til.** Uzbek va rus tillari tushuniladi. LLM buni "Diktant o'zbek yoki
   rus tilida bo'lishi mumkin" tanish prompt orqali qabul qiladi.

---

## Orkestrator arxitekturasi

```
frontend ──HTTP──> backend/routes/*.js ──> executeAgent(name, input, ctx)
                                             │
                                             ├─ ai/core/registry.js  (agentni topadi)
                                             ├─ agent.schema.parse(input) (zod validatsiya)
                                             ├─ timeout guard
                                             ├─ agent.handler(input, ctx)
                                             │   ├─ transcribe()  (agar audio)
                                             │   ├─ llmJson() / llmText()  (LLM chaqiruvi)
                                             │   └─ (agarda) qo'shimcha DB queries
                                             └─ auditga yoziladi
```

Har agent — bir modul: `ai/agents/*.js` yoki `ai/agents/clinical-workflow.js`
ichida. `ai/agents/index.js` ularni `registerAgent()` orqali registrga
qo'shadi. Runtime `executeAgent('agent-name', input, ctx)` bilan chaqiradi.

---

## Agentlar rejestri

### 1. `medical-scribe` — Umumiy AI Scribe (bor)
**Category:** clinical
**Kim ishlatadi:** shifokor `/scribe` sahifasida ovozli diktovka qilganda.
**Vazifa:** ovozli matnni yoki tayyor matnni tibbiy JSONga aylantirish:
`patient_name`, `diagnosis`, `procedure`, `medicines`, `symptoms`, `vitals`,
`recommendations`, `referral_needed`, `confidence`.
**Chegara:** ICD-10 kodini aniq bilmasa, faqat tashxis matnini yozadi.
**Chaqiruv:** `POST /api/scribe/upload` (audio) yoki `POST /api/scribe/transcribe`.

### 2. `receptionist` — Ovozli qabul (bor)
**Category:** clinical
**Kim ishlatadi:** qabulxona xodimi `/reception-voice` sahifasida.
**Vazifa:** ovozli matnni `{patient_name, phone, doctor_specialty, service_names, district, mahalla}` ga ajratish.
**Chegara:** bemorni ro'yxatga olmaydi — faqat maydonlarni to'ldiradi, xodim ko'rib tasdiqlaydi.

### 3. `inventory-manager` — Ombor (bor)
**Category:** logistics
**Vazifa:** dorining sarfini avto hisoblash (protsedura → material normalari), yetishmasa ogohlantirish.
**Chegara:** buyurtma yubormaydi — faqat ma'lumot beradi.

### 4. `analytics-agent` — Statistika (bor)
**Category:** analytics
**Vazifa:** klinika ma'lumotlaridan qisqa xulosa (kunlik bemor soni, top shifokorlar, daromad dinamikasi).

### 5. `medication-coach` — Dori tavsiyasi (bor)
**Category:** clinical
**Vazifa:** shifokor buyurgan dori uchun umumiy tavsiya matni tuzadi (dozalash, ehtiyot chorasi).
**Chegara:** shifokor buyurmagan dori taklif qilmaydi.

### 6. `b2b-referral` — Tashqi klinika yo'llanmasi (bor)
### 7. `referral-agent` — Yo'llanmani qabul qilish (bor)

---

## Klinika oqimi agentlari (yangi — clinical-workflow.js)

### 8. `obhod-scribe` — Statsionar obhod yordamchisi
**Category:** clinical
**Kim ishlatadi:** navbatchi shifokor `/wards/board` da band koyka → "Ovozli obhod" dialogida.
**Vazifa:** ovozli obhod matnini `{temperature, blood_pressure, pulse, respiration, saturation, complaints, objective_status, treatment_plan, ai_summary}` ga ajratadi.
**Chegara:** dori buyurmaydi, tashxis qo'ymaydi. Ai_summary — 1-2 gap qisqa xulosa (shifokor tez o'qishi uchun). Barcha sonlar raqamda bo'lishi kerak (Whisper "qirq besh" — 45).
**Chaqiruv:** `POST /api/inpatient/daily-notes/voice` (allaqachon ishlaydi — endi orchestrator orqali).
**JSON javob:**
```json
{ "transcription": "...", "extracted": { "temperature": 37.5, "blood_pressure": "130/80", ... } }
```

### 9. `vitals-anomaly` — Anomaliya senzori
**Category:** clinical
**Kim ishlatadi:** obhod saqlanganda backend chaqiradi (real-time) yoki UI kartada.
**Vazifa:** t°, A/D, puls, SpO2, nafas qiymatlarini xavfli chegara bilan solishtiradi.
**Chegara:** hech qanday yechim qabul qilmaydi. Faqat `alerts[]` massivini qaytaradi:
- `high` — shoshilinch (t°>39, A/D 180/110+, puls>120 yoki <45, SpO2<92)
- `warn` — kuzatuv (t°>38, A/D 160/100+, nafas chetlashgan)
UI shifokorga qizil banner qilib ko'rsatadi. Klinik qaror — shifokordan.
**Chaqiruv:** `POST /api/ai/agents/vitals-anomaly` (universal endpoint).
**JSON javob:**
```json
{ "alerts": [{"level":"high","metric":"temperature","value":39.5,"msg":"..."}], "has_high": true }
```

### 10. `epicrisis-writer` — Chiqarish epikrizi loyihasi
**Category:** clinical
**Kim ishlatadi:** shifokor chiqarish paytida "Epikriz avto-yaratish" tugmasini bosganda.
**Vazifa:** yotgan davrning barcha ma'lumotlaridan (obhodlar + retseptlar + tekshiruvlar) 200-350 so'zli standart tibbiy epikriz matnini tuzadi.
**Chegara:** uydirma statistika kiritmaydi. Faqat berilgan ma'lumotdan yozadi. Yakuniy qaror shifokorda — u tuzatib **imzolaydi**. `auto_generated=true` bayrog'i saqlanadi (audit uchun).
**Chaqiruv:** `POST /api/inpatient/discharges/:id/generate-epicrisis` (yangi).
**Struktura:**
```
**Anamnez qisqartma**
**Statsionar davri (dinamika)**
**O'tkazilgan tekshiruvlar va natijalar**
**Davolash yakuni**
**Chiqarish holatida holati**
**Uy sharoitida tavsiyalar**
**Keyingi ko'rik sanasi (taxminiy)**
```

### 11. `lab-conclusion-helper` — Laborator xulosa yordamchisi
**Category:** clinical
**Kim ishlatadi:** laborant `/lab` sahifasida natija kiritayotib "AI xulosa taklifi" tugmasini bosganda.
**Vazifa:** kiritilgan ko'rsatkichlar matnidan 1-3 gapli qisqa xulosa loyihasini yozadi.
**Chegara:** TASHXIS QO'YMAYDI. Faqat: qaysilari norma ichida, qaysilari chetlashgan, klinik ahamiyati (yumshoq/muhim/shoshilinch). Laborant tuzatadi.
**Chaqiruv:** `POST /api/ai/agents/lab-conclusion-helper`.
**JSON javob:** `{ "conclusion_draft": "..." }`

### 12. `diagnosis-suggester` — Tashxis taklifchi
**Category:** clinical
**Kim ishlatadi:** shifokor birlamchi ko'rikda shikoyat + status praesens yozgach.
**Vazifa:** 3 ta ehtimoliy tashxis taklifi, har biriga sabab va confidence.
**Chegara:** AI TASHXIS QO'YMAYDI — faqat variant beradi. Shifokor 1 tasini tanlaydi yoki hech birini olmaydi.
**Chaqiruv:** `POST /api/ai/agents/diagnosis-suggester`.
**JSON javob:**
```json
{ "suggestions": [
  { "diagnosis": "Migren, klassik", "icd10_hint": "G43.0", "why": "...", "confidence": 0.75 },
  { "diagnosis": "...", ... },
  { "diagnosis": "...", ... }
] }
```

---

## AI ning rol chegarasi (qat'iy qoidalar)

| AI QILADI | AI QILMAYDI |
|---|---|
| Matnni tozalaydi, ajratadi | Bemorni ro'yxatdan o'tkazmaydi |
| Variant/taklif beradi | Tashxis qo'ymaydi |
| Xulosa loyihasini yozadi | Dori buyurmaydi |
| Anomaliyani ko'rsatadi | O'z-o'zidan retsept chiqarmaydi |
| Ko'rsatkichlarni tekshiradi | Chiqarish qarorini qabul qilmaydi |
| Konteks (oldingi tashriflar) tayyorlaydi | Statsionar/palata qaror qilmaydi |

**Har bir agent chiqargan natija shifokor/laborant tomonidan ko'rib chiqilib, tuzatilib, tasdiqlanadi va shundan keyin bazaga yoziladi.**

---

## Chaqiruv usullari (backend integratsiya)

### Yagona endpoint (yangi tavsiya)
`POST /api/ai/agents/:name` — har agentni bir xil interfeys bilan chaqirish.
Backend `executeAgent(name, req.body, { tenantId, user, db })` chaqiradi.

### Tegishli endpoint ichidan
Ba'zi agentlar mos endpoint ichida chaqiriladi:
- `obhod-scribe` → `POST /api/inpatient/daily-notes/voice`
- `epicrisis-writer` → `POST /api/inpatient/discharges/:id/generate-epicrisis`

Bu ikki uslub bir-birini qo'llab-quvvatlaydi: birinchisi tez prototip
qilish uchun, ikkinchisi domen mantiqi bilan chambarchas bog'liq oqimlar
uchun.

---

## Tanlash: qachon qaysi agent

| Vazifa | Agent |
|---|---|
| Poliklinik shifokor diktovkasi | `medical-scribe` |
| Qabulxona ovozli qabul | `receptionist` |
| Statsionar obhod ovozi | `obhod-scribe` |
| Real-time xavfli qiymat ogohlantirish | `vitals-anomaly` |
| Chiqarish epikrizi loyihasi | `epicrisis-writer` |
| Lab natijasi xulosasi | `lab-conclusion-helper` |
| Birlamchi ko'rikda tashxis takliflari | `diagnosis-suggester` |
| Ombor sarfi va yetishmovchilik | `inventory-manager` |
| Dori tavsiyasi (bemorga tushunarli tilda) | `medication-coach` |
| Kunlik statistika | `analytics-agent` |
| Tashqi B2B klinika yo'llanmasi | `b2b-referral`, `referral-agent` |
