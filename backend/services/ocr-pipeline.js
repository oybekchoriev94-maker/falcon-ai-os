// ============================================================
// Falcon AI OS — Hujjat elektronlashtirish pipeline (PR #8)
//
// OCR/STT/qo'lda matn → LLM ajratmasi. Sof funksiyalar: prompt
// qurish va AI javobini tozalash. DB'siz test qilinadi.
//
// DOKTRINA: AI matndan maydon AJRATADI, lekin kartaga hech narsa
// avtomatik tushmaydi — shifokor tekshirib tasdiqlaydi (review).
// ============================================================

export const DOC_TYPES = Object.freeze([
  'tibbiy_karta', 'xulosa', 'retsept', 'yonaltirma', 'shartnoma', 'akt', 'boshqa',
]);

export const DOC_TYPE_LABEL = Object.freeze({
  tibbiy_karta: 'Tibbiy karta',
  xulosa: 'Xulosa',
  retsept: 'Retsept',
  yonaltirma: 'Yo\'naltirma',
  shartnoma: 'Shartnoma',
  akt: 'Akt',
  boshqa: 'Boshqa hujjat',
});

// AI ajratib oladigan maydonlar (whitelist — boshqa hech narsa saqlanmaydi)
export const STRUCTURED_KEYS = Object.freeze([
  'summary', 'patient_name', 'birth_date', 'phone', 'diagnosis',
  'complaints', 'medications', 'doctor_name', 'document_date', 'notes',
]);

const MAX_FIELD_LEN = 2000;
const MAX_RAW_LEN = 100_000;

/**
 * Hujjat turi bo'yicha LLM tizim promptini quradi.
 * Javob DOIM JSON formatda so'raladi (llm.js JSON'ni o'zi ajratadi).
 */
export function buildExtractionPrompt(docType = 'boshqa') {
  const label = DOC_TYPE_LABEL[docType] || DOC_TYPE_LABEL.boshqa;
  return {
    system:
      `Sen klinikada qog'oz hujjatlarni elektronlashtirish yordamchisan. ` +
      `Senga "${label}" hujjatining matni beriladi (OCR yoki ovozli diktantdan, ` +
      `xatolar bo'lishi mumkin). Matndan quyidagi maydonlarni ajratib, FAQAT JSON qaytar: ` +
      `{"summary": "1-2 jumla qisqa mazmun", "patient_name": "FIO", "birth_date": "YYYY-MM-DD yoki bo'sh", ` +
      `"phone": "+998...", "diagnosis": "...", "complaints": "...", "medications": "...", ` +
      `"doctor_name": "...", "document_date": "YYYY-MM-DD yoki bo'sh", "notes": "..."}. ` +
      `Topilmagan maydonga null qo'y. Matnda yo'q narsani O'YLAMA — faqat matnda borini yoz. ` +
      `Sana topilmasa null qoldir, taxmin qilib to'ldirma.`,
    label,
  };
}

/**
 * Xom matnni xavfsizlashtiradi: bo'shliqlarni ixchamlaydi va
 * uzunlikni chegaralaydi (katta skan matni LLM'ga sig'maydi).
 */
export function sanitizeRawText(raw) {
  if (typeof raw !== 'string') return '';
  const compact = raw
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return compact.slice(0, MAX_RAW_LEN);
}

/**
 * LLM javobini tozalaydi: faqat whitelist maydonlar, satrlar trim +
 * chegara, array'lar birlashtiriladi, bo'sh qiymatlar null bo'ladi.
 *
 * @param {object|string|null} llmOutput llm() natijasi (JSON obyekt yoki xato)
 * @returns {object|null} toza structured obyekt yoki null (ajratib bo'lmadi)
 */
export function parseStructured(llmOutput) {
  if (!llmOutput || typeof llmOutput !== 'object' || Array.isArray(llmOutput)) return null;
  if (llmOutput.error) return null;

  const out = {};
  let found = false;

  for (const key of STRUCTURED_KEYS) {
    let v = llmOutput[key];
    if (Array.isArray(v)) v = v.map((x) => String(x ?? '').trim()).filter(Boolean).join('; ');
    if (typeof v === 'number') v = String(v);
    if (typeof v !== 'string' || !v.trim()) { out[key] = null; continue; }
    out[key] = v.trim().slice(0, MAX_FIELD_LEN);
    found = true;
  }

  return found ? out : null;
}

/**
 * Pipeline holatini soddalashtiradi: matn bormi, structured bormi.
 * Route status qarori shu yerda bo'ladi (DB'siz test uchun).
 *
 * @returns {{ status: 'done'|'failed', error: string|null }}
 */
export function decideStatus({ rawText, structured, hardError }) {
  if (hardError) return { status: 'failed', error: String(hardError).slice(0, 500) };
  if (!sanitizeRawText(rawText)) return { status: 'failed', error: 'Matn olinmadi: OCR/STT bo\'sh natija qaytardi' };
  return { status: 'done', error: null };
}
