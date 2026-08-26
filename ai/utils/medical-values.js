// ============================================================
// Tibbiy qiymatlarni tekshirish va tuzatish (post-processing).
//
// NEGA KERAK: LLM sonlarni ishonchli o'girmaydi. Production'da
// kuzatilgan xatolar: "oltmish sakkiz" -> 69, harorat 375 (37.5 emas),
// bo'y maydoniga vazn tushishi. Prompt bilan bularni kamaytirish
// mumkin, lekin YO'Q QILIB BO'LMAYDI — model ehtimollik bilan ishlaydi.
//
// Shuning uchun oxirgi qatlam DETERMINISTIK: har bir qiymat tibbiy
// chegara bilan tekshiriladi. Chegaradan tashqarida bo'lsa NULL
// qaytariladi — taxmin qilinmaydi.
//
// TAMOYIL: bo'sh maydon > noto'g'ri maydon.
// Bo'sh maydon shifokorga ko'rinadi va u to'ldiradi. Noto'g'ri qiymat
// esa to'g'ridek ko'rinib, tekshirilmay tibbiy hujjatga tushadi.
// ============================================================

/** Apostrofning barcha ko'rinishlarini bittaga keltiradi (oʻn, o'n, o‘n) */
const normApos = (s) => String(s || '').replace(/[’‘`ʻʼ´]/g, "'");

const UNITS = {
  'nol': 0, 'bir': 1, 'ikki': 2, 'uch': 3, "to'rt": 4, 'besh': 5,
  'olti': 6, 'yetti': 7, 'sakkiz': 8, "to'qqiz": 9,
};
const TENS = {
  "o'n": 10, 'yigirma': 20, "o'ttiz": 30, 'qirq': 40, 'ellik': 50,
  'oltmish': 60, 'yetmish': 70, 'sakson': 80, "to'qson": 90,
};

/**
 * O'zbekcha son so'zlarini raqamga o'giradi: "bir yuz sakson ikki" -> 182.
 *
 * Whisper sonlarni so'z bilan chiqaradi va LLM ularni noto'g'ri o'girishi
 * mumkin ("oltmish sakkiz" -> 69). Bu funksiya determinisitik — hisoblaydi,
 * taxmin qilmaydi.
 *
 * @returns {number|null} son topilmasa null
 */
export function uzWordsToNumber(text) {
  const words = normApos(text).toLowerCase().split(/[^a-z'ʼ]+/).filter(Boolean);
  let total = 0, current = 0, seen = false;

  for (const w of words) {
    if (w in UNITS) { current += UNITS[w]; seen = true; }
    else if (w in TENS) { current += TENS[w]; seen = true; }
    else if (w === 'yuz') { current = (current || 1) * 100; seen = true; }
    else if (w === 'ming') { total += (current || 1) * 1000; current = 0; seen = true; }
  }
  if (!seen) return null;
  return total + current;
}

/**
 * Matndan sonni oladi: avval raqam, bo'lmasa so'z bilan yozilganini.
 * "68" -> 68 · "68 kg" -> 68 · "oltmish sakkiz" -> 68 · "" -> null
 */
export function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  const s = normApos(v).trim();
  // Raqam bor bo'lsa o'shani olamiz (vergul o'nlik ajratgichi bo'lishi mumkin)
  const digits = s.replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (digits) {
    const n = Number(digits[0]);
    return Number.isFinite(n) ? n : null;
  }
  return uzWordsToNumber(s);
}

/**
 * Harorat. Tibbiy chegara 34.0–42.0 °C.
 *
 * O'nlik nuqtasi tushib qolishi tez-tez uchraydi: "o'ttiz yetti nuqta besh"
 * -> 375 yoki 379. Bunday qiymat 10 ga bo'linadi (kerak bo'lsa bir necha
 * marta: 3750 -> 375 -> 37.5).
 */
export function sanitizeTemperature(v) {
  let n = parseNumber(v);
  if (n === null) return null;
  // 37.5 o'rniga 375 / 3750 kelgan bo'lsa nuqtani tiklaymiz
  let guard = 0;
  while (n > 100 && guard < 3) { n = n / 10; guard += 1; }
  n = Math.round(n * 10) / 10;
  return (n >= 34 && n <= 42) ? n : null;
}

/** Bo'y (sm). Chegara 50–220. Tashqarisi — null. */
export function sanitizeHeight(v) {
  const n = parseNumber(v);
  if (n === null) return null;
  const r = Math.round(n * 10) / 10;
  return (r >= 50 && r <= 220) ? r : null;
}

/** Vazn (kg). Chegara 3–200. Tashqarisi — null. */
export function sanitizeWeight(v) {
  const n = parseNumber(v);
  if (n === null) return null;
  const r = Math.round(n * 10) / 10;
  return (r >= 3 && r <= 200) ? r : null;
}

/** Puls (zarba/daqiqa). Chegara 20–250. */
export function sanitizePulse(v) {
  const n = parseNumber(v);
  if (n === null) return null;
  const r = Math.round(n);
  return (r >= 20 && r <= 250) ? r : null;
}

/** Saturatsiya (%). Chegara 50–100. */
export function sanitizeSaturation(v) {
  const n = parseNumber(v);
  if (n === null) return null;
  const r = Math.round(n);
  return (r >= 50 && r <= 100) ? r : null;
}

/** Nafas soni (daqiqada). Chegara 5–60. */
export function sanitizeRespiration(v) {
  const n = parseNumber(v);
  if (n === null) return null;
  const r = Math.round(n);
  return (r >= 5 && r <= 60) ? r : null;
}

/**
 * Qon bosimi: "120/80" formatiga keltiradi.
 * Sistolik 50–300, diastolik 30–200 chegarasida bo'lishi shart.
 */
export function sanitizeBloodPressure(v) {
  const s = normApos(v).trim();
  if (!s) return null;
  const m = s.match(/(\d{2,3})\s*[\/\\ ]\s*(\d{2,3})/);
  if (!m) return null;
  const sys = Number(m[1]), dia = Number(m[2]);
  if (sys < 50 || sys > 300 || dia < 30 || dia > 200) return null;
  // Sistolik diastolikdan katta bo'lishi kerak — teskari bo'lsa ishonmaymiz
  if (dia >= sys) return null;
  return `${sys}/${dia}`;
}

/**
 * Telefon raqamini +998XXXXXXXXX formatiga keltiradi.
 *
 * Diktantda raqam so'z bilan aytilishi mumkin: "to'qson to'rt, uch yuz
 * o'n ikki, o'ttiz to'rt, ellik olti" -> +998943123456.
 * Aralash ham bo'lishi mumkin ("94 uch yuz o'n ikki ...").
 *
 * @returns {string|null} 9 xonali milliy raqam topilmasa null
 */
export function sanitizePhone(v) {
  const s = normApos(v).toLowerCase().trim();
  if (!s) return null;

  // 1) Toza raqamlar bo'lsa — to'g'ridan-to'g'ri
  const onlyDigits = s.replace(/\D/g, '');
  if (onlyDigits.length >= 9) {
    const tail = onlyDigits.slice(-9);
    return /^[0-9]{9}$/.test(tail) ? `+998${tail}` : null;
  }

  // 2) So'z bilan aytilgan bo'laklarni ketma-ket raqamga o'giramiz.
  //    Har bo'lak (vergul/pauza bilan ajratilgan) alohida son:
  //    "to'qson to'rt" -> 94, "uch yuz o'n ikki" -> 312
  const chunks = s.split(/[,;.]|\s+va\s+/).map((c) => c.trim()).filter(Boolean);
  let digits = '';
  for (const c of chunks) {
    const inChunk = c.replace(/\D/g, '');
    if (inChunk) { digits += inChunk; continue; }
    const n = uzWordsToNumber(c);
    if (n === null) continue;
    digits += String(n);
  }
  if (digits.length < 9) return null;
  const tail = digits.slice(-9);
  return /^[0-9]{9}$/.test(tail) ? `+998${tail}` : null;
}
