// ============================================================
// FALCON AI OS — Klinika oqimi AI agentlari
//
// Har agent ANIQ bitta klinik vazifani bajaradi. Rol chegarasi:
// AI faqat ma'lumot tayyorlaydi va tuzilgan javob qaytaradi — QAROR
// har doim SHIFOKOR ixtiyorida. Shu tufayli hech qanday agent avtomatik
// tashxis qo'ymaydi, dori yozmaydi, chiqarish qarorini qabul qilmaydi.
// AI natijasi shifokor tomonidan ko'rilib, tuzatilib SAQLANADI.
// ============================================================

import { z } from 'zod';
import { llmJson, llmText } from '../core/tools.js';
import { transcribe } from '../engines/stt.js';

// Whisper sonlarni so'z bilan chiqaradi — LLM'ga aniq talab qo'yamiz
const NUMBERS_RULE =
  "MUHIM: barcha sonlarni RAQAMLARDA yozing, so'z bilan emas. " +
  "Masalan: 'qirq besh' -> 45, 'o'ttiz yetti nuqta besh' -> 37.5, 'yuz yigirma' -> 120. " +
  "Yosh, harorat, bosim, puls, doza, telefon raqami, miqdor, narx — hammasi raqamda bo'lsin.";

// ============================================================
// 1) OBHOD AGENTI (obhod-scribe)
//
// ROLI: navbatchi shifokor obhod paytida gapirgan matndan
//        temp, bosim, puls, shikoyat, davolash rejasi va ai_summary'ni
//        ajratib beradi. Bemor holatiga ta'sir qiladigan qaror QILMAYDI.
//        Faqat tayyor tuzilgan JSON qaytaradi.
// ============================================================
export const obhodScribe = {
  name: 'obhod-scribe',
  description: 'Statsionar obhod ovozini t°/A/D/puls/shikoyat/reja maydonlariga ajratadi.',
  version: '1.0.0',
  category: 'clinical',
  schema: z.object({
    text: z.string().min(3).optional(),
    audio: z.any().optional(),
    language: z.enum(['uz', 'ru']).optional(),
  }).refine((d) => d.text || d.audio, { message: 'text yoki audio talab qilinadi' }),

  async handler(input) {
    let text = input.text;
    if (!text && input.audio) {
      const stt = await transcribe(input.audio, 'obhod.webm', { language: input.language });
      if (stt.error) return { error: `Transkripsiya: ${stt.error}`, code: 'STT_ERROR' };
      text = stt.text;
    }
    if (!text) return { error: 'Bo\'sh matn', code: 'EMPTY_INPUT' };

    const prompt =
      "Siz statsionar obhod yordamchisiz. Kunlik ko'zdan kechirish yozuvidan quyidagi " +
      "JSON kalitlarini ajratib qaytaring (yo'q bo'lsa null yoki bo'sh string): " +
      '{"temperature": null, "blood_pressure": "", "pulse": null, "respiration": null, ' +
      '"saturation": null, "complaints": "", "objective_status": "", "treatment_plan": "", ' +
      '"ai_summary": ""}. ' +
      "temperature — 0.1 aniqlik son (37.5). pulse/respiration — butun son. " +
      "saturation — foizsiz butun (98). blood_pressure — '120/80' formatida. " +
      "ai_summary — 1-2 gap qisqa xulosa. " + NUMBERS_RULE +
      " Faqat JSON qaytaring, boshqa matn qo'shmang.";

    const data = await llmJson(prompt, text);
    if (!data || typeof data !== 'object') {
      return { transcription: text, extracted: null, structured: false };
    }

    // DETERMINISTIK TEKSHIRUV — LLM sonlariga ishonmaymiz.
    // Bu ko'rsatkichlar to'g'ridan-to'g'ri vital-anomaly xavfsizlik
    // agentiga uzatiladi: noto'g'ri harorat yoki puls soxta ogohlantirish
    // beradi yoki haqiqiy xavfni yashiradi. Chegaradan tashqarisi NULL.
    const { sanitizeTemperature, sanitizePulse, sanitizeSaturation,
            sanitizeRespiration, sanitizeBloodPressure } =
      await import('../utils/medical-values.js');

    return {
      transcription: text,
      structured: true,
      extracted: {
        ...data,
        temperature:    sanitizeTemperature(data.temperature),
        pulse:          sanitizePulse(data.pulse),
        respiration:    sanitizeRespiration(data.respiration),
        saturation:     sanitizeSaturation(data.saturation),
        blood_pressure: sanitizeBloodPressure(data.blood_pressure),
      },
    };
  },
};

// ============================================================
// 2) ANOMALIYA SENZORI (vitals-anomaly)
//
// ROLI: yangi obhod yozuvi bazaga tushganda tekshiradi — t°/A/D/puls
//        xavfli chegaralarda emasmi. Mavjud bo'lsa `alerts` massivini
//        qaytaradi. Xulosani UI qizil banner qilib shifokorga ko'rsatadi.
//        Yechim qabul qilmaydi (qaror shifokornikida).
// ============================================================
export const vitalsAnomaly = {
  name: 'vitals-anomaly',
  description: 'Obhod ko\'rsatkichlaridan (t°, A/D, puls, SpO2) xavfli chetlashishlarni sezadi.',
  version: '1.0.0',
  category: 'clinical',
  schema: z.object({
    temperature: z.number().optional().nullable(),
    blood_pressure: z.string().optional().nullable(),
    pulse: z.number().optional().nullable(),
    saturation: z.number().optional().nullable(),
    respiration: z.number().optional().nullable(),
    age_years: z.number().optional().nullable(),
  }),

  async handler(input) {
    const alerts = [];
    const t = input.temperature;
    const p = input.pulse;
    const sat = input.saturation;
    const resp = input.respiration;

    if (t != null) {
      if (t >= 39.0) alerts.push({ level: 'high', metric: 'temperature', value: t, msg: `Yuqori isitma ${t}°C — shoshilinch shifokor ko'rigi` });
      else if (t >= 38.0) alerts.push({ level: 'warn', metric: 'temperature', value: t, msg: `Isitma ${t}°C — kuzatuv` });
      else if (t < 35.5) alerts.push({ level: 'high', metric: 'temperature', value: t, msg: `Hipotermiya ${t}°C — shoshilinch tekshiruv` });
    }

    if (input.blood_pressure) {
      const m = /(\d{2,3})\s*\/\s*(\d{2,3})/.exec(input.blood_pressure);
      if (m) {
        const sys = +m[1], dia = +m[2];
        if (sys >= 180 || dia >= 110) alerts.push({ level: 'high', metric: 'blood_pressure', value: input.blood_pressure, msg: `Gipertoniya krizi (${sys}/${dia}) — darrov ko'rik` });
        else if (sys <= 90 || dia <= 60) alerts.push({ level: 'high', metric: 'blood_pressure', value: input.blood_pressure, msg: `Gipotoniya (${sys}/${dia}) — shok belgisi bo'lishi mumkin` });
        else if (sys >= 160 || dia >= 100) alerts.push({ level: 'warn', metric: 'blood_pressure', value: input.blood_pressure, msg: `Yuqori bosim (${sys}/${dia}) — kuzatuv` });
      }
    }

    if (p != null) {
      if (p >= 120) alerts.push({ level: 'high', metric: 'pulse', value: p, msg: `Taxikardiya (${p}) — sabab aniqlansin` });
      else if (p <= 45) alerts.push({ level: 'high', metric: 'pulse', value: p, msg: `Bradikardiya (${p}) — EKG kerak` });
    }

    if (sat != null && sat < 92) {
      alerts.push({ level: 'high', metric: 'saturation', value: sat, msg: `Past SpO2 (${sat}%) — kislorod terapiyasi kerak bo'lishi mumkin` });
    }
    if (resp != null && (resp > 30 || resp < 10)) {
      alerts.push({ level: 'warn', metric: 'respiration', value: resp, msg: `Nafas soni chetlashgan (${resp})` });
    }

    return { alerts, has_high: alerts.some((a) => a.level === 'high') };
  },
};

// ============================================================
// 3) EPIKRIZ AVTO-TUZUVCHI (epicrisis-writer)
//
// ROLI: chiqarish paytida barcha kunlik obhodlar, dorilar,
//       laborator natijalar va konsultatsiyalardan qisqa,
//       standart tibbiy epikriz matnini tuzadi.
//       Shifokor qabul qiladi, tuzatadi va IMZOLAYDI.
//       Agent hech qachon "chiqarish tayyor" deb belgilamaydi.
// ============================================================
export const epicrisisWriter = {
  name: 'epicrisis-writer',
  description: 'Statsionar davri (obhodlar, dorilar, labs) asosida chiqarish epikrizi loyihasini tuzadi.',
  version: '1.0.0',
  category: 'clinical',
  schema: z.object({
    patient: z.object({
      full_name: z.string(),
      birth_date: z.string().optional().nullable(),
      gender: z.string().optional().nullable(),
      mrn: z.string().optional().nullable(),
    }),
    admission: z.object({
      admission_date: z.string(),
      discharge_date: z.string().optional().nullable(),
      diagnosis_initial: z.string().optional().nullable(),
      diagnosis_final: z.string().optional().nullable(),
      department: z.string().optional().nullable(),
      attending_doctor: z.string().optional().nullable(),
    }),
    daily_notes: z.array(z.object({
      date: z.string(),
      temperature: z.number().optional().nullable(),
      blood_pressure: z.string().optional().nullable(),
      pulse: z.number().optional().nullable(),
      complaints: z.string().optional().nullable(),
      treatment_plan: z.string().optional().nullable(),
    })).default([]),
    prescriptions: z.array(z.object({
      medicine_name: z.string(),
      dosage: z.string().optional().nullable(),
      route: z.string().optional().nullable(),
      frequency: z.string().optional().nullable(),
    })).default([]),
    labs: z.array(z.object({
      test_type: z.string(),
      conclusion: z.string().optional().nullable(),
    })).default([]),
  }),

  async handler(input) {
    // Katta kontekstni matn ko'rinishida beramiz (JSON prompt'ni chalg'itmasin)
    const p = input.patient;
    const a = input.admission;
    const days = input.daily_notes || [];
    const meds = input.prescriptions || [];
    const labs = input.labs || [];

    const dayLines = days.map((d) => (
      `- ${d.date}: t°${d.temperature ?? '—'}, A/D ${d.blood_pressure || '—'}, Ps ${d.pulse ?? '—'}. ` +
      `Shikoyat: ${d.complaints || '—'}. Reja: ${d.treatment_plan || '—'}.`
    )).join('\n');
    const medLines = meds.map((m) => `- ${m.medicine_name} — ${[m.dosage, m.route, m.frequency].filter(Boolean).join(', ')}`).join('\n');
    const labLines = labs.map((l) => `- ${l.test_type}: ${l.conclusion || '—'}`).join('\n');

    const prompt = [
      "Siz statsionar chiqarish epikrizini tuzuvchi tibbiy yordamchisisiz.",
      "Standart tibbiy uslub (asosiy tashxis, davolash yakuni, tavsiyalar, kuzatuv).",
      "Uzbek tilida yozing. 200-350 so'z. Uydirma statistika QO'SHMANG — faqat berilgan ma'lumotdan foydalaning.",
      "Yakuniy qaror shifokorda — sizning ishingiz — loyiha matni tayyorlash.",
      "",
      `## Bemor: ${p.full_name}${p.mrn ? ` (MRN ${p.mrn})` : ''}${p.gender ? `, ${p.gender}` : ''}`,
      `## Yotqizilgan: ${a.admission_date}${a.discharge_date ? ` — chiqarilgan: ${a.discharge_date}` : ''}`,
      a.department ? `## Bo'lim: ${a.department}` : '',
      a.attending_doctor ? `## Davolovchi shifokor: ${a.attending_doctor}` : '',
      a.diagnosis_initial ? `## Boshlang'ich tashxis: ${a.diagnosis_initial}` : '',
      a.diagnosis_final ? `## Yakuniy tashxis: ${a.diagnosis_final}` : '',
      '',
      '## Kunlik obhodlar:',
      dayLines || '- (kuzatuv yozuvlari yo\'q)',
      '',
      '## Dorilar (buyurilgan):',
      medLines || '- (yo\'q)',
      '',
      '## Tekshiruvlar:',
      labLines || '- (yo\'q)',
      '',
      '## Yozing (aynan shu tarkib bilan, sarlavhalar bilan):',
      '**Anamnez qisqartma** — 1 gap',
      '**Statsionar davri (dinamika)** — 3-5 gap',
      '**O\'tkazilgan tekshiruvlar va natijalar** — 2-4 gap',
      '**Davolash yakuni** — 2-3 gap',
      '**Chiqarish holatida holati** — 1-2 gap',
      '**Uy sharoitida tavsiyalar** — dori, rejim, kuzatuv',
      '**Keyingi ko\'rik sanasi (taxminiy)**',
    ].filter(Boolean).join('\n');

    const text = await llmText(prompt);
    return { epicrisis_text: text, source_stats: { days: days.length, meds: meds.length, labs: labs.length } };
  },
};

// ============================================================
// 4) LABORATORIYA XULOSA YORDAMCHISI (lab-conclusion-helper)
//
// ROLI: laborant kiritgan ko'rsatkichlar matnidan qisqa xulosa taklifi
//        yozadi (masalan "Yashirin qon aniqlanmadi, boshqalar normada").
//        Laborant o'qib tuzatadi. HECH qachon tashxis qo'ymaydi.
// ============================================================
export const labConclusionHelper = {
  name: 'lab-conclusion-helper',
  description: 'Laborator ko\'rsatkichlaridan qisqa xulosa loyihasini tayyorlaydi (laborant tasdiqlaydi).',
  version: '1.0.0',
  category: 'clinical',
  schema: z.object({
    test_type: z.string(),
    values_text: z.string().min(2),
    reference_ranges: z.string().optional(),
  }),

  async handler(input) {
    const prompt = [
      "Siz laboratoriya yordamchisisiz. Berilgan tahlil ko'rsatkichlaridan",
      "1-3 gapli qisqa xulosa loyihasini uzbek tilida yozing.",
      "Tashxis QO'YMANG. Faqat: qaysi ko'rsatkichlar norma ichida, qaysilari chetlashgan,",
      "va agar chetlashish bo'lsa, klinik ahamiyati (yumshoq / muhim / shoshilinch).",
      "Laborant qabul qiladi va tuzatadi.",
      "",
      `Tahlil turi: ${input.test_type}`,
      input.reference_ranges ? `Norma diapazonlari: ${input.reference_ranges}` : '',
      '',
      'Ko\'rsatkichlar:',
      input.values_text,
    ].filter(Boolean).join('\n');
    const text = await llmText(prompt);
    return { conclusion_draft: text };
  },
};

// ============================================================
// 5) TASHXIS TAKLIFCHI (diagnosis-suggester)
//
// ROLI: birlamchi ko'rikda shifokor shikoyat + status praesens yozganda
//       3 ta ehtimoliy tashxis taklifini beradi. Har biri uchun qisqa
//       sabab. Shifokor 1 tasini tanlaydi yoki hech birini olmaydi.
//       AI tashxis QO'YMAYDI — faqat variant beradi.
// ============================================================
export const diagnosisSuggester = {
  name: 'diagnosis-suggester',
  description: 'Shikoyat va status praesens matnidan 3 ta ehtimoliy tashxis taklifini beradi.',
  version: '1.0.0',
  category: 'clinical',
  schema: z.object({
    complaints: z.string().min(3),
    status_praesens: z.string().optional(),
    status_localis: z.string().optional(),
    age_years: z.number().optional(),
    gender: z.string().optional(),
    specialty: z.string().optional(),
  }),

  async handler(input) {
    const prompt = [
      "Siz shifokor yordamchisisiz. Berilgan klinik ma'lumotdan 3 ta ehtimoliy tashxis",
      "taklifini JSON ko'rinishida qaytaring. Har birida qisqa sabab yozing.",
      "Shifokor o'zi tanlaydi — siz tashxis QO'YMAYSIZ.",
      "",
      "Faqat JSON qaytaring:",
      '{ "suggestions": [ { "diagnosis": "...", "icd10_hint": "...", "why": "1-2 gap sabab", "confidence": 0.0 } ] }',
      "",
      input.specialty ? `Mutaxassislik: ${input.specialty}` : '',
      input.age_years ? `Yoshi: ${input.age_years}` : '',
      input.gender ? `Jinsi: ${input.gender}` : '',
      `Shikoyat: ${input.complaints}`,
      input.status_praesens ? `Status praesens: ${input.status_praesens}` : '',
      input.status_localis ? `Status localis: ${input.status_localis}` : '',
    ].filter(Boolean).join('\n');
    const data = await llmJson(prompt);
    return data;
  },
};

// ============================================================
// Registrga ulash uchun eksport (agents/index.js dan avtomatik yig'iladi)
// ============================================================
export const name = 'clinical-workflow-bundle';
export const description = 'Klinika oqimi agentlari to\'plami (obhod, anomaliya, epikriz, lab, tashxis).';
export const version = '1.0.0';
export const category = 'clinical';
// Bundle registrga tushmasin — schema yo'q, handler yo'q. Faqat modul eksport.
export const handler = null;
export const AGENTS = [obhodScribe, vitalsAnomaly, epicrisisWriter, labConclusionHelper, diagnosisSuggester];
