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
//
// LUG'AT NEGA KERAK: production'da "oltmish sakkiz" 69 deb o'girildi
// (to'g'risi 68). Model qo'shma sonni taxmin qilgan. Shuning uchun
// raqamlar ro'yxati va QO'SHISH qoidasi aniq beriladi — vazn yoki doza
// bir birlikka xato bo'lsa bu tibbiy hujjatda jiddiy nuqson.
const NUMBER_RULE = `
SONLAR — QAT'IY QOIDA. Barcha sonlarni RAQAMLARDA yozing.
Birliklar: bir=1 ikki=2 uch=3 to'rt=4 besh=5 olti=6 yetti=7 sakkiz=8 to'qqiz=9
O'nliklar: o'n=10 yigirma=20 o'ttiz=30 qirq=40 ellik=50 oltmish=60 yetmish=70 sakson=80 to'qson=90
Yuzlik: yuz=100 (ikki yuz=200)
QO'SHMA SON — QISMLARNI QO'SHING, taxmin qilmang:
  "oltmish sakkiz" = 60 + 8 = 68   (69 EMAS)
  "yetmish besh"   = 70 + 5 = 75
  "bir yuz yetmish ikki" = 100 + 70 + 2 = 172
  "o'ttiz yetti nuqta besh" = 37.5
Agar son aniq eshitilmagan bo'lsa null qoldiring — TAXMIN QILMANG.
Noto'g'ri son bo'sh maydondan xavfliroq.`;

// DIQQAT: `admission_type` va `transport_type` qiymatlari formadagi
// <select> variantlari bilan AYNAN mos bo'lishi shart (wards/page.tsx).
// Boshqa qiymat qaytarilsa select bo'sh ko'rinadi va shifokor buni
// sezmay, noto'g'ri yoki bo'sh yotqizish turi bilan saqlab yuboradi.
const PROMPT =
  "Siz statsionar qabul bo'limi yordamchisisiz. Shifokor bemorni yotqizishda " +
  "aytgan erkin diktantdan 003-forma maydonlarini ajratib, FAQAT JSON qaytaring:\n" +
  '{"patient_name":"bemor F.I.O.",' +
  '"diagnosis_initial":"kirish tashxisi",' +
  '"admission_type":"rejali|shoshilinch|tez_yordam",' +
  '"urgent_admission":false,' +
  '"complaints":"shikoyatlar",' +
  '"anamnesis":"kasallik tarixi, qachondan beri",' +
  '"time_since_onset":"kasallik boshlanganidan o\'tgan vaqt",' +
  '"referring_clinic":"yo\'llagan MUASSASA nomi",' +
  '"referral_diagnosis":"yo\'llanmadagi tashxis",' +
  '"transport_type":"own|wheelchair|stretcher",' +
  '"height_cm":null,"weight_kg":null,"temperature_on_admission":null,' +
  '"diet_number":"parhez stoli RAQAMI",' +
  '"treatment_plan":"davolash rejasi",' +
  '"notes":"yuqoridagi maydonlarga KIRMAGAN qo\'shimcha izoh"}\n' +
  "\nMAYDONLAR MA'NOSI — ADASHTIRMANG:\n" +
  "• patient_name — bemorning ismi va familiyasi. Har so'z BOSH HARF bilan: " +
  "\"qurbonov shohista\" -> \"Qurbonov Shohista\".\n" +
  "• admission_type: rejali (oldindan belgilangan), shoshilinch (zudlik bilan), " +
  "tez_yordam (tez yordam mashinasida keltirilgan).\n" +
  "• transport_type — bemor QANDAY HARAKATLANADI: own (o'zi yura oladi), " +
  "wheelchair (aravachada), stretcher (zambilda). Bu tashish vositasi emas.\n" +
  "• diet_number — PARHEZ STOLI (Pevzner tizimi), faqat RAQAM qaytaring:\n" +
  "    \"birinchi stol\" / \"1-stol\" / \"№1 parhez\" -> \"1\"\n" +
  "    \"beshinchi a stol\" / \"5a\" -> \"5a\"\n" +
  "    \"o'ninchi stol\" -> \"10\"\n" +
  "  Ruxsat etilgan: 0,1,1a,2,3,4,5,5a,6,7,8,9,10,11,12,13,14,15\n" +
  "• referring_clinic — FAQAT tashkilot nomi (\"Termiz shahar poliklinikasi\").\n" +
  "  DIQQAT: parhez stoli (\"birinchi stol\") bu maydonga TUSHMASIN — u ovqat " +
  "tartibi, muassasa emas.\n" +
  "\nTAKRORLAMANG: har bir gap FAQAT BITTA maydonga tushsin. Shikoyatni " +
  "complaints ga yozgan bo'lsangiz, uni anamnesis yoki notes ga QAYTA " +
  "yozmang. notes — faqat boshqa hech qaysi maydonga sig'magan ma'lumot " +
  "uchun; hech nima qolmasa bo'sh qoldiring.\n" +
  "\nQAT'IY QOIDA: diktantda aytilmagan narsani O'YLAB TOPMANG. Ma'lumot bo'lmasa " +
  "matn maydonini bo'sh satr (\"\"), son maydonini null qoldiring. Bu tibbiy " +
  "hujjat — to'qilgan ma'lumot bemorga zarar keltiradi." + NUMBER_RULE;

/** "yuz yetmish" kabi qolgan matnni songa aylantirishga urinmaymiz —
 *  noto'g'ri son bo'sh maydondan xavfliroq. Faqat haqiqiy sonni olamiz. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Ism-familiyani bosh harflar bilan: "qurbonov shohista" -> "Qurbonov Shohista".
 *  Qo'shimcha bo'shliqlar tozalanadi, apostroflar saqlanadi (O'ktam, G'ulom). */
function titleCase(v) {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w ? w[0].toLocaleUpperCase('uz') + w.slice(1).toLocaleLowerCase('uz') : w))
    .join(' ');
}

// Formadagi <select> qiymatlari (wards/page.tsx) bilan AYNAN bir xil
const DIET_TABLES = ['0', '1', '1a', '2', '3', '4', '5', '5a', '6', '7',
                     '8', '9', '10', '11', '12', '13', '14', '15'];

/** Parhez stolini dropdown qiymatiga keltiradi.
 *  Prompt "1" so'rasa ham model "1-stol", "№1", "1 stol" qaytarishi mumkin —
 *  bunday qiymat <select> da tanlanmay, maydon bo'sh ko'rinardi. */
function normalizeDiet(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '';
  const m = s.match(/(\d{1,2})\s*([ab])?/);
  if (!m) return '';
  const withLetter = m[1] + (m[2] || '');
  if (DIET_TABLES.includes(withLetter)) return withLetter;
  return DIET_TABLES.includes(m[1]) ? m[1] : '';
}

/** Matnni jumlalarga ajratadi (nuqta/savol/undov yoki yangi qator bo'yicha) */
function sentences(v) {
  return String(v ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Solishtirish kaliti — tinish belgisi va registr farqi takrorni
 *  yashirib qo'ymasligi uchun. Asl ko'rinish saqlanadi. */
const sentKey = (s) => s.toLocaleLowerCase('uz').replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * `text` dagi jumlalardan `seen` to'plamida BO'LMAGANLARINI qaytaradi va
 * qaytarilganlarini `seen` ga qo'shadi.
 *
 * NEGA KERAK: model ba'zan bitta shikoyatni complaints, anamnesis VA
 * notes ga birdan yozadi — natijada izohda bir gap 2-3 marta chiqardi.
 */
function takeNew(text, seen) {
  const out = [];
  for (const s of sentences(text)) {
    const k = sentKey(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out.join(' ');
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

  const diet = normalizeDiet(result.diet_number);

  // Model parhezni ba'zan "yo'llagan muassasa" deb tushunadi ("birinchi
  // stol" -> referring_clinic). Muassasa nomida stol/parhez so'zi bo'lsa —
  // bu klinika nomi emas: parhezga o'tkazamiz va maydonni bo'shatamiz.
  let clinic = str('referring_clinic');
  let dietFinal = diet;
  if (/\b(stol|parhez|dieta|стол)\b/i.test(clinic)) {
    if (!dietFinal) dietFinal = normalizeDiet(clinic);
    clinic = '';
  }

  // Shikoyat -> anamnez -> izoh tartibida: har jumla FAQAT BIR MARTA.
  // Keyingi maydon oldingilarida aytilganini takrorlamaydi.
  const seen = new Set();
  const complaints = takeNew(str('complaints'), seen);
  const anamnesis  = takeNew(str('anamnesis'), seen);
  const notes      = takeNew(str('notes'), seen);

  return {
    fields: {
      patient_name:       titleCase(result.patient_name),
      diagnosis_initial:  str('diagnosis_initial'),
      admission_type:     admissionType,
      urgent_admission:   result.urgent_admission === true ||
                          admissionType === 'shoshilinch' ||
                          admissionType === 'tez_yordam',
      complaints,
      anamnesis,
      time_since_onset:   str('time_since_onset'),
      referring_clinic:   clinic,
      referral_diagnosis: str('referral_diagnosis'),
      transport_type:     pickEnum(result.transport_type,
                            ['own', 'wheelchair', 'stretcher']),
      height_cm:              num(result.height_cm),
      weight_kg:              num(result.weight_kg),
      temperature_on_admission: num(result.temperature_on_admission),
      diet_number:        dietFinal,
      treatment_plan:     str('treatment_plan'),
      notes,
    },
    raw_text: input.text,
    structured: true,
  };
}
