// ============================================================
// FALCON AI OS — Vaqt tejash agentlari (Bosqich N)
//
// Shifokor va laborant vaqtini keskin kamaytiradi. Har agent LLM'ga
// mo'ljallangan aniq JSON schema qaytaradi. Xato yoki LLM off bo'lsa —
// bo'sh/foydali fallback beradi (asosiy oqim buzilmasin).
//
// ROL: AI faqat MASLAHAT beradi va TAYYORLAYDI. Yakuniy qaror doim
// shifokor/laborant ixtiyorida — natijalarni "AI tavsiya, tasdiqlash
// shart" belgi bilan ko'rsatamiz.
// ============================================================

import { z } from 'zod';
import { llmJson } from '../core/tools.js';

// ============================================================
// 1) ADMISSION SUMMARY
//    Bemor kartasi ochilishida 2-3 gapli klinik xulosa.
//    Kirish: patient basic + oxirgi 6 oy consultations + admissions.
//    Chiqish: {summary, key_facts[], last_active_diagnoses[]}
// ============================================================
export const admissionSummary = {
  name: 'admission-summary',
  description: 'Bemor kartasi ochilishida 2-3 gapli klinik xulosa (yosh, tashxis tarixi, allergiya, oxirgi tashrif).',
  version: '1.0.0',
  category: 'time_saver',
  schema: z.object({
    patient: z.object({
      age: z.number().nullable().optional(),
      gender: z.string().nullable().optional(),
      allergies: z.string().nullable().optional(),
      blood_group: z.string().nullable().optional(),
    }),
    recent_visits: z.array(z.object({
      date: z.string(),
      doctor_spec: z.string().nullable().optional(),
      diagnosis: z.string().nullable().optional(),
      procedure: z.string().nullable().optional(),
    })).max(30),
    recent_admissions: z.array(z.object({
      admission_date: z.string(),
      diagnosis_initial: z.string().nullable().optional(),
      diagnosis_final: z.string().nullable().optional(),
    })).max(10).optional(),
  }),

  async handler(input) {
    const visits = input.recent_visits || [];
    const admissions = input.recent_admissions || [];

    if (visits.length === 0 && admissions.length === 0) {
      return {
        summary: 'Bu bemor kartasida hali tashrif va yotqizish yozuvi yo\'q.',
        key_facts: [],
        last_active_diagnoses: [],
      };
    }

    const prompt =
      "Siz shifokor yordamchisisiz. Bemor tarixi berilgan. 2-3 gapli " +
      "qisqa klinik xulosa yozing (o'zbek tilida). Doktor kartani ochganda " +
      "birinchi ko'rishi kerak bo'lgan narsalar: yosh, jinsi, allergiya, " +
      "asosiy tashxis(lar), oxirgi tashrif sanasi va sababi. " +
      "TASHXIS QO'YMANG — faqat ma'lumot qisqarishi. " +
      "Faqat JSON qaytaring: " +
      `{"summary":"2-3 gap","key_facts":["fakt 1","fakt 2"],"last_active_diagnoses":["tashxis 1"]}`;

    const ctx = JSON.stringify({
      patient: input.patient,
      recent_visits: visits,
      recent_admissions: admissions,
    });

    try {
      const res = await llmJson(prompt, ctx, { timeoutMs: 6000 });
      if (res && typeof res === 'object') {
        return {
          summary: String(res.summary || '').slice(0, 500) || 'Xulosa mavjud emas',
          key_facts: Array.isArray(res.key_facts) ? res.key_facts.slice(0, 6) : [],
          last_active_diagnoses: Array.isArray(res.last_active_diagnoses) ? res.last_active_diagnoses.slice(0, 5) : [],
        };
      }
    } catch (_) { /* fallback */ }

    // Fallback: LLM ishlamasa — determinisitik qisqarish
    const lastVisit = visits[0];
    const parts = [];
    if (input.patient.age) parts.push(`${input.patient.age} yosh`);
    if (input.patient.gender) parts.push(input.patient.gender);
    if (visits.length) parts.push(`${visits.length} ta tashrif`);
    if (admissions.length) parts.push(`${admissions.length} ta yotqizish`);
    return {
      summary: parts.join(', ') + (lastVisit?.diagnosis ? `. Oxirgi tashxis: ${lastVisit.diagnosis}.` : '.'),
      key_facts: input.patient.allergies ? [`Allergiya: ${input.patient.allergies}`] : [],
      last_active_diagnoses: [...new Set(visits.map((v) => v.diagnosis).filter(Boolean))].slice(0, 3),
    };
  },
};

// ============================================================
// 2) TRIAGE
//    Reception voice orqasidan chaqiriladi. Shikoyat matndan
//    urgency (green/yellow/red) + tavsiya etilgan ixtisos + qisqa sabab.
//    Standart tibbiy triage protokoli: red — hayotiy xavf (og'ir og'riq
//    ko'krakda, nafas qisilishi, hushdan ketish), yellow — 30 daqiqa
//    ichida ko'rilishi kerak, green — reja bilan.
// ============================================================
export const triageAgent = {
  name: 'triage-agent',
  description: 'Reception shikoyatidan urgency (green/yellow/red) va ixtisos tavsiyasi.',
  version: '1.0.0',
  category: 'time_saver',
  schema: z.object({
    complaint: z.string().min(3).max(2000),
    patient_age: z.number().nullable().optional(),
    patient_gender: z.string().nullable().optional(),
  }),

  async handler(input) {
    // Deterministik RED — kalit so'zlar (hayotiy xavf indikatorlari)
    const t = (input.complaint || '').toLowerCase();
    const redKeys = [
      'ko\'krak', 'nafas ol', 'nafas qis', 'hushdan', 'yiqildi', 'bilinmaydi',
      'qon ket', 'kuchli og\'ri', 'zaharlangan', 'yurak', 'insult',
      'грудь', 'обморок', 'кровотеч', 'сильн', 'сердце', 'инсульт',
    ];
    const yellowKeys = [
      'harorat', 'temp', 'qaytar qusish', 'ich ket', 'qattiq bosh og\'ri',
      'температур', 'рвот', 'диарея',
    ];

    let severity = 'green';
    let deterministicReason = '';
    if (redKeys.some((k) => t.includes(k))) {
      severity = 'red';
      deterministicReason = 'Hayotiy xavf indikatori';
    } else if (yellowKeys.some((k) => t.includes(k))) {
      severity = 'yellow';
      deterministicReason = 'Simptom shoshilinch ko\'rikni talab qiladi';
    }

    // LLM'dan aniq ixtisos va sabab
    const prompt =
      "Siz reception yordamchisisiz. Bemor shikoyatidan qaysi ixtisos shifokor " +
      "kerakligini tanlang va urgency belgilang. TASHXIS QO'YMANG — faqat yo'naltirish. " +
      "Ixtisoslar: terapevt, kardiolog, nevropatolog, ginekolog, xirurg, " +
      "travmatolog, pediatr, oftalmolog, LOR, endokrinolog, uzi_uzi, laborant. " +
      "Urgency: red (hayotiy xavf, 5 daqiqa), yellow (30 daqiqa), green (reja). " +
      "Faqat JSON qaytaring: " +
      `{"severity":"red|yellow|green","suggested_specialty":"terapevt","reason":"1 gap"}`;

    const ctx = `Shikoyat: ${input.complaint}` +
      (input.patient_age ? `\nYosh: ${input.patient_age}` : '') +
      (input.patient_gender ? `\nJinsi: ${input.patient_gender}` : '');

    try {
      const res = await llmJson(prompt, ctx, { timeoutMs: 5000 });
      // Deterministik RED yuqori — LLM'dan pastroq bo'lsa ham RED saqlanadi
      const llmSev = String(res?.severity || '').toLowerCase();
      if (severity !== 'red' && ['red', 'yellow', 'green'].includes(llmSev)) {
        severity = llmSev;
      }
      return {
        severity,
        suggested_specialty: String(res?.suggested_specialty || 'terapevt').toLowerCase(),
        reason: String(res?.reason || deterministicReason || 'Umumiy tashrif').slice(0, 300),
      };
    } catch (_) {
      return {
        severity,
        suggested_specialty: 'terapevt',
        reason: deterministicReason || 'Umumiy tashrif',
      };
    }
  },
};

// ============================================================
// 3) LAB INTERPRETER
//    Laborant natija matnini tushunarli izohga aylantiradi.
//    Kirish: raw_text (Hb 12.5, WBC 7.2, ...) + test_type.
//    Chiqish: {interpretation: "Umumiy holat normada, hech qanday chetlanish yo'q",
//              highlights: [{param, value, status: 'normal|low|high', note}]}
// ============================================================
export const labInterpreter = {
  name: 'lab-interpreter',
  description: 'Laborator natijasi matnidan doktor uchun tushunarli izoh va normadan chetlanishlar.',
  version: '1.0.0',
  category: 'time_saver',
  schema: z.object({
    raw_text: z.string().min(3),
    test_type: z.string().optional(),
    patient_age: z.number().nullable().optional(),
    patient_gender: z.string().nullable().optional(),
  }),

  async handler(input) {
    const prompt =
      "Siz klinik laborant yordamchisiz. Berilgan tahlil natijasidan doktor " +
      "uchun qisqa tushunarli izoh yozing (o'zbek tilida). TASHXIS QO'YMANG. " +
      "Faqat: qaysi ko'rsatkichlar norma pastida/yuqorisida, qanday oqibatga " +
      "olib kelishi mumkinligini bir gap bilan yoziling. " +
      "Faqat JSON qaytaring: " +
      `{"interpretation":"2-3 gap","highlights":[{"param":"Hb","value":"5.5 g/l","status":"low","note":"anemiya belgilari"}]}`;

    const ctx = `Tahlil turi: ${input.test_type || 'umumiy'}\nNatija:\n${input.raw_text}` +
      (input.patient_age ? `\nYosh: ${input.patient_age}` : '') +
      (input.patient_gender ? `\nJinsi: ${input.patient_gender}` : '');

    try {
      const res = await llmJson(prompt, ctx, { timeoutMs: 6000 });
      return {
        interpretation: String(res?.interpretation || '').slice(0, 600),
        highlights: Array.isArray(res?.highlights) ? res.highlights.slice(0, 15) : [],
      };
    } catch (_) {
      return { interpretation: '', highlights: [] };
    }
  },
};

export const TIME_SAVER_AGENTS = [admissionSummary, triageAgent, labInterpreter];
