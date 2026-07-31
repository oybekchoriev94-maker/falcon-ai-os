// ============================================================
// FALCON AI OS — Xavfsizlik agentlari (Bosqich M)
//
// ROL: bemor xavfsizligini kuzatish. Ma'lumot o'zgarganida (obhod yozildi,
// lab natija keldi, retsept berildi) — avto ishga tushib, kritik holatlarni
// aniqlaydi va ai_alerts jadvaliga yozadi.
//
// PRINSIP: har agent AVVAL determinisitik chegaralarni tekshiradi (LLM'ga
// muhtoj emas — normadan chetlanish sonlar bilan aniqlanadi). Bu:
//  1) LLM tokenini tejaydi
//  2) Aniq, izohli — huquqiy zarar bo'lsa audit qilib bo'ladi
//  3) LLM off bo'lsa ham ishlaydi
//
// LLM faqat "matn tahlil" kerak bo'lganda ishlatiladi (masalan retsept ↔
// erkin allergiya matni).
//
// AI QAROR QILMAYDI: alertni faqat hamshira/shifokor yopadi. Alert ochiq
// bo'lsa UI'da qizil chiqib turadi.
// ============================================================

import { z } from 'zod';
import { llmJson } from '../core/tools.js';

// ============================================================
// 1) VITAL ANOMALY — obhod qiymatlari kritik chegaralardan tashqarida?
// ============================================================
export const vitalAnomaly = {
  name: 'vital-anomaly',
  description: 'Obhod qiymatlaridan (t°, A/D, puls, saturatsiya) kritik chetlanishlarni topadi.',
  version: '1.0.0',
  category: 'safety',
  schema: z.object({
    temperature: z.number().nullable().optional(),
    blood_pressure: z.string().nullable().optional(),   // "120/80"
    pulse: z.number().nullable().optional(),
    respiration: z.number().nullable().optional(),
    saturation: z.number().nullable().optional(),
    patient_age: z.number().nullable().optional(),
  }),

  handler(input) {
    const alerts = [];
    const t = input.temperature;
    const p = input.pulse;
    const r = input.respiration;
    const sat = input.saturation;

    // Harorat — WHO/tibbiy protokol chegaralari
    if (t != null) {
      if (t >= 39.5)      alerts.push({ severity: 'critical', title: 'Yuqori isitma', details: `t° ${t}°C (kritik ≥39.5)` });
      else if (t >= 38.5) alerts.push({ severity: 'warning',  title: 'Isitma',          details: `t° ${t}°C (o'rta)` });
      else if (t <= 35.0) alerts.push({ severity: 'critical', title: 'Gipotermiya',     details: `t° ${t}°C (kritik ≤35)` });
    }

    // Puls
    if (p != null) {
      if (p >= 130)      alerts.push({ severity: 'critical', title: 'Yuqori taxikardiya', details: `puls ${p} b/d (≥130)` });
      else if (p >= 110) alerts.push({ severity: 'warning',  title: 'Taxikardiya',        details: `puls ${p} b/d (≥110)` });
      else if (p <= 40)  alerts.push({ severity: 'critical', title: 'Kritik bradikardiya',details: `puls ${p} b/d (≤40)` });
      else if (p <= 50)  alerts.push({ severity: 'warning',  title: 'Bradikardiya',       details: `puls ${p} b/d (≤50)` });
    }

    // Nafas
    if (r != null) {
      if (r >= 30)      alerts.push({ severity: 'critical', title: 'Taxipne',    details: `nafas ${r}/d (≥30)` });
      else if (r <= 8)  alerts.push({ severity: 'critical', title: 'Bradipne',   details: `nafas ${r}/d (≤8)` });
    }

    // Saturatsiya
    if (sat != null) {
      if (sat <= 88)      alerts.push({ severity: 'critical', title: 'Kritik gipoksiya', details: `SpO₂ ${sat}% (≤88)` });
      else if (sat <= 92) alerts.push({ severity: 'warning',  title: 'Gipoksiya',        details: `SpO₂ ${sat}% (≤92)` });
    }

    // Arterial bosim: "120/80" -> [120, 80]
    if (input.blood_pressure) {
      const m = String(input.blood_pressure).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
      if (m) {
        const sys = Number(m[1]);
        const dia = Number(m[2]);
        if (sys >= 180 || dia >= 110)     alerts.push({ severity: 'critical', title: 'Gipertensiv kriz',    details: `A/D ${sys}/${dia}` });
        else if (sys >= 160 || dia >= 100) alerts.push({ severity: 'warning',  title: 'Yuqori arterial bosim',details: `A/D ${sys}/${dia}` });
        else if (sys <= 80 || dia <= 50)  alerts.push({ severity: 'critical', title: 'Gipotenziya (shok?)',  details: `A/D ${sys}/${dia}` });
      }
    }

    return { alerts };
  },
};

// ============================================================
// 2) LAB CRITICAL — laborator natijalar hayotiy chegaradan tashqarida?
// ============================================================
// values_json.text — laborantdan kelgan raw matn (Hb, WBC, HCT, glucose, ...)
// Determinisitik regex bilan raqamlarni ajratib, chegara solishtiramiz.
// Erkin matndan aniq ajrata olmasak — LLM'ga topshiramiz.
const LAB_THRESHOLDS = [
  // [regex, unit, low_critical, low_warning, high_warning, high_critical, label]
  [/(?:Hb|gemoglobin|гемоглобин)\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)/i, 'g/l',      70,  100, 180, 220, 'Gemoglobin'],
  [/(?:WBC|leykotsit|лейкоцит)\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)/i,  '×10⁹/l',   1.5, 3.5, 12,  25,  'Leykotsitlar'],
  [/(?:PLT|trombotsit|тромбоцит)\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)/i,'×10⁹/l',   30,  100, 450, 1000,'Trombotsitlar'],
  [/(?:glyukoza|glukoza|глюкоза|glucose)\s*[:=]?\s*(\d{1,2}(?:[.,]\d+)?)/i, 'mmol/l', 2.5, 3.5, 11, 22, 'Glyukoza'],
  [/(?:kaliy|kalium|калий|K\+?)\s*[:=]?\s*(\d(?:[.,]\d+)?)/i,      'mmol/l',   2.5, 3.5, 5.5, 6.5, 'Kaliy'],
  [/(?:kreatinin|креатинин)\s*[:=]?\s*(\d{1,4}(?:[.,]\d+)?)/i,     'µmol/l',   0,   0,   150, 300, 'Kreatinin'],
];

export const labCritical = {
  name: 'lab-critical',
  description: 'Laborator natijadan hayotiy kritik qiymatlarni ajratadi.',
  version: '1.0.0',
  category: 'safety',
  schema: z.object({
    raw_text: z.string().min(2),
    test_type: z.string().optional(),
  }),

  handler(input) {
    const alerts = [];
    const src = input.raw_text || '';
    for (const [rx, unit, lc, lw, hw, hc, label] of LAB_THRESHOLDS) {
      const m = src.match(rx);
      if (!m) continue;
      const val = parseFloat(String(m[1]).replace(',', '.'));
      if (!Number.isFinite(val)) continue;

      if (lc > 0 && val <= lc) {
        alerts.push({ severity: 'critical', title: `${label} juda past`, details: `${val} ${unit} (≤${lc})` });
      } else if (val >= hc) {
        alerts.push({ severity: 'critical', title: `${label} juda yuqori`, details: `${val} ${unit} (≥${hc})` });
      } else if (lw > 0 && val <= lw) {
        alerts.push({ severity: 'warning', title: `${label} past`, details: `${val} ${unit} (≤${lw})` });
      } else if (val >= hw) {
        alerts.push({ severity: 'warning', title: `${label} yuqori`, details: `${val} ${unit} (≥${hw})` });
      }
    }
    return { alerts };
  },
};

// ============================================================
// 3) DRUG INTERACTION — buyurilgan dori bemor allergiyasi va boshqa faol
// dorilar bilan xavflimi?
// ============================================================
// Bosqich 1: allergiya matnida dori nomi bo'lsa — darrov 'critical'.
// Bosqich 2: klassik oʻzaro taʼsir (aspirin+warfarin, statins+clarithromycin...) —
// deterministik jadval bilan tekshiramiz.
// Bosqich 3: agar aniq bo'lmasa LLM'dan qisqa xulosa (kelajakda ochish mumkin).
const KNOWN_INTERACTIONS = [
  // Har juftlik pastdagi formatda: ['drug_a', 'drug_b', severity, reason]
  ['warfarin', 'aspirin',        'critical', 'Qon ketish xavfi'],
  ['warfarin', 'ibuprofen',      'critical', 'Qon ketish xavfi'],
  ['warfarin', 'diclofenac',     'critical', 'Qon ketish xavfi'],
  ['warfarin', 'clarithromycin', 'warning',  'Warfarin darajasi oshadi'],
  ['clarithromycin', 'statin',   'warning',  'Rabdomioliz xavfi (statin darajasi oshadi)'],
  ['clarithromycin', 'simvastatin','critical','Rabdomioliz — birga ishlatilmaydi'],
  ['metformin', 'kontrast',      'warning',  'Rentgen kontrasti — 48 soat oldin to\'xtating'],
  ['ace', 'kaliy',               'warning',  'Giperkaliemiya xavfi'],
  ['maoi', 'ssri',               'critical', 'Serotonin sindromi'],
  ['nsaid', 'lityi',             'warning',  'Litiy zaharlanishi xavfi'],
];

function normDrug(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-zа-яё\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function drugContains(text, needle) {
  return normDrug(text).includes(normDrug(needle));
}

export const drugInteraction = {
  name: 'drug-interaction',
  description: 'Buyurilgan dorini allergiya va boshqa faol dorilar bilan tekshiradi.',
  version: '1.0.0',
  category: 'safety',
  schema: z.object({
    new_drug: z.string().min(2),                 // yangi buyurilgan dori nomi
    allergies: z.string().nullable().optional(), // bemor allergiya matni
    active_meds: z.array(z.string()).optional(), // boshqa faol dorilar
  }),

  async handler(input) {
    const alerts = [];
    const newDrug = normDrug(input.new_drug);
    const allergies = String(input.allergies || '');

    // 1) Allergiya — sarlavhada dori nomi bor bo'lsa
    if (allergies && drugContains(allergies, newDrug.split(' ')[0])) {
      alerts.push({
        severity: 'critical',
        title: 'ALLERGIYA — dori mos kelmaydi',
        details: `Bemor allergiya ro'yxatida: "${allergies}". Yangi buyurilgan: "${input.new_drug}".`,
      });
    }

    // 2) Boshqa faol dorilar bilan aralashuv
    const activeList = (input.active_meds || []).map(normDrug);
    for (const [a, b, sev, why] of KNOWN_INTERACTIONS) {
      const aInNew = drugContains(newDrug, a);
      const bInNew = drugContains(newDrug, b);
      for (const active of activeList) {
        const aInAct = drugContains(active, a);
        const bInAct = drugContains(active, b);
        if ((aInNew && bInAct) || (bInNew && aInAct)) {
          alerts.push({
            severity: sev,
            title: `Dori aralashuv (${a} × ${b})`,
            details: `${why}. Faol dori: "${active}", yangi: "${input.new_drug}".`,
          });
        }
      }
    }

    // 3) Erkin matnli allergiya bo'lsa va aniq eshittirish topilmagan bo'lsa —
    // LLM'ga qisqa xulosa uchun murojaat (ixtiyoriy, LLM off bo'lsa o'tkazib yuboriladi).
    if (allergies && allergies.length > 20 && alerts.length === 0) {
      try {
        const res = await llmJson(
          "Siz klinik farmatsevt yordamchisiz. Bemor allergiya matni va yangi buyurilgan dori berilgan. " +
          "Agar allergiya keltirilgan dori bilan bir sinfda bo'lsa yoki kross-reaktiv bo'lsa (masalan " +
          "penitsillin allergiyasi + amoksitsillin), qaytaring: " +
          `{"risk":"critical|warning|none","reason":"qisqa izoh (bir gap)"}`,
          `Allergiya: ${allergies}\nYangi buyurilgan: ${input.new_drug}`,
          { timeoutMs: 4000 }
        );
        if (res && res.risk && res.risk !== 'none') {
          alerts.push({
            severity: res.risk === 'critical' ? 'critical' : 'warning',
            title: 'Allergiya — kross-reaktiv xavf',
            details: res.reason || 'AI klinik farmatsevt: sinf yoki kross-reaktivlik',
          });
        }
      } catch (_) { /* LLM ishlamasa — asosiy oqim buzilmaydi */ }
    }

    return { alerts };
  },
};

export const SAFETY_AGENTS = [vitalAnomaly, labCritical, drugInteraction];
