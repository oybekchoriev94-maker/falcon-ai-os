// ============================================================
// FALCON AI OS — "admission-scribe" agenti
//
// ROL: bemorni statsionarga yotqizishda shifokor aytgan erkin diktantni
// 003-forma (statsionar kasallik tarixi) muqova maydonlariga ajratadi.
//
// NEGA KERAK: yotqizish formasi eng uzun formalardan biri — tashxis,
// yo'llanma, transport, bo'y/vazn, harorat, parhez, davolash rejasi.
// Shifokor buni klaviaturada to'ldirsa bemor yonida bir necha daqiqa
// vaqt ketadi. Ovozda esa bir marta aytib chiqadi.
//
// AGENT YOTQIZISHNI YARATMAYDI — faqat maydonlarni TAKLIF qiladi.
// Yotqizish huquqiy oqibatga ega (rozilik + shartnoma tekshiruvi bor)
// va uni faqat shifokor formani ko'rib, tasdiqlab yaratadi.
//
// `admission-summary` bilan ADASHTIRMANG: u bemor kartasi ochilganda
// TARIXNI qisqartiradi; bu esa YANGI yotqizish formasini to'ldiradi.
// ============================================================

import { z } from 'zod';
import { llmJson } from '../core/tools.js';

// Whisper sonlarni so'z bilan chiqaradi ("o'ttiz yetti nuqta besh").
// Bo'y, vazn, harorat — hammasi raqam bo'lishi shart, aks holda ular
// bilan keyin hech qanday hisob-kitob qilib bo'lmaydi.
const NUMBER_RULE =
  "\nMUHIM: barcha sonlarni RAQAMLARDA yozing. \"o'ttiz yetti nuqta besh\" -> 37.5, " +
  "\"bir yuz yetmish\" -> 170, \"oltmish besh\" -> 65.";

// DIQQAT: `admission_type` va `transport_type` qiymatlari formadagi
// <select> variantlari bilan AYNAN mos bo'lishi shart (wards/page.tsx).
// Boshqa qiymat qaytarilsa select bo'sh ko'rinadi va shifokor buni
// sezmay, noto'g'ri yoki bo'sh yotqizish turi bilan saqlab yuboradi.
const PROMPT =
  "Siz statsionar qabul bo'limi yordamchisisiz. Shifokor bemorni yotqizishda " +
  "aytgan erkin diktantdan 003-forma maydonlarini ajratib, FAQAT JSON qaytaring:\n" +
  '{"diagnosis_initial":"kirish tashxisi",' +
  '"admission_type":"rejali|shoshilinch|tez_yordam",' +
  '"urgent_admission":false,' +
  '"complaints":"shikoyatlar",' +
  '"anamnesis":"kasallik tarixi, qachondan beri",' +
  '"time_since_onset":"kasallik boshlanganidan o\'tgan vaqt",' +
  '"referring_clinic":"yo\'llagan muassasa nomi",' +
  '"referral_diagnosis":"yo\'llanmadagi tashxis",' +
  '"transport_type":"own|wheelchair|stretcher",' +
  '"height_cm":null,"weight_kg":null,"temperature_on_admission":null,' +
  '"diet_number":"parhez raqami yoki nomi",' +
  '"treatment_plan":"davolash rejasi",' +
  '"notes":"boshqa muhim izohlar"}\n' +
  "\nIZOH — qiymatlar ma'nosi:\n" +
  "admission_type: rejali (oldindan belgilangan), shoshilinch (zudlik bilan), " +
  "tez_yordam (tez yordam mashinasida keltirilgan).\n" +
  "transport_type — bemor QANDAY HARAKATLANADI: own (o'zi yura oladi), " +
  "wheelchair (aravachada), stretcher (zambilda). Bu tashish vositasi emas, " +
  "bemorning harakatlanish qobiliyati.\n" +
  "QAT'IY QOIDA: diktantda aytilmagan narsani O'YLAB TOPMANG. Ma'lumot bo'lmasa " +
  "matn maydonini bo'sh satr (\"\"), son maydonini null qoldiring. Bu tibbiy " +
  "hujjat — to'qilgan ma'lumot bemorga zarar keltiradi." + NUMBER_RULE;

/** "yuz yetmish" kabi qolgan matnni songa aylantirishga urinmaymiz —
 *  noto'g'ri son bo'sh maydondan xavfliroq. Faqat haqiqiy sonni olamiz. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export const name = 'admission-scribe';
export const description =
  'Statsionarga yotqizish diktantini 003-forma maydonlariga ajratadi (taklif sifatida).';
export const version = '1.0.0';
export const category = 'clinical';
export const timeoutMs = 30000;

export const schema = z.object({
  text: z.string().min(3, 'Diktant matni juda qisqa').max(20000),
  patient_name: z.string().max(200).nullable().optional(),
});

export async function handler(input) {
  const result = await llmJson(
    PROMPT,
    input.patient_name ? `Bemor: ${input.patient_name}\n\nDiktant:\n${input.text}` : input.text,
    { timeoutMs: 25000 }
  );

  if (!result || typeof result !== 'object') {
    // LLM ishlamasa ham diktant YO'QOLMASLIGI kerak — shifokor xom
    // matnni ko'radi va formani o'zi to'ldiradi.
    return {
      fields: {}, raw_text: input.text, structured: false,
      note: "AI matnni ajrata olmadi — diktant saqlandi, formani qo'lda to'ldiring.",
    };
  }

  const str = (k) => String(result[k] ?? '').trim();

  /** Faqat formadagi <select> da mavjud qiymatni qaytaramiz. LLM boshqa
   *  so'z aytsa bo'sh qoldiramiz — noto'g'ri tanlangan variant bo'sh
   *  variantdan xavfliroq (shifokor sezmay saqlab yuboradi). */
  const pickEnum = (raw, allowed) => {
    const v = String(raw ?? '').trim().toLowerCase();
    return allowed.includes(v) ? v : '';
  };

  const admissionType = pickEnum(result.admission_type,
    ['rejali', 'shoshilinch', 'tez_yordam']);

  return {
    fields: {
      diagnosis_initial:  str('diagnosis_initial'),
      admission_type:     admissionType,
      urgent_admission:   result.urgent_admission === true ||
                          admissionType === 'shoshilinch' ||
                          admissionType === 'tez_yordam',
      complaints:         str('complaints'),
      anamnesis:          str('anamnesis'),
      time_since_onset:   str('time_since_onset'),
      referring_clinic:   str('referring_clinic'),
      referral_diagnosis: str('referral_diagnosis'),
      transport_type:     pickEnum(result.transport_type,
                            ['own', 'wheelchair', 'stretcher']),
      height_cm:              num(result.height_cm),
      weight_kg:              num(result.weight_kg),
      temperature_on_admission: num(result.temperature_on_admission),
      diet_number:        str('diet_number'),
      treatment_plan:     str('treatment_plan'),
      notes:              str('notes'),
    },
    raw_text: input.text,
    structured: true,
  };
}
