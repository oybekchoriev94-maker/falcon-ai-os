// ============================================================
// Falcon AI OS — Local STT Engine (whisper.cpp + Fallback Cloud)
// RTX 5070 → whisper-large-v3-turbo @ http://localhost:8081
// ============================================================

const WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:8081';

function groqKey() { return (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== '***') ? process.env.GROQ_API_KEY : ''; }

// STT rejimi LLM'dan alohida boshqariladi: STT_LOCAL o'rnatilmagan bo'lsa,
// eski xatti-harakat uchun LOCAL_ONLY'ga qaytadi.
function isLocal() {
  if (process.env.STT_LOCAL !== undefined) return process.env.STT_LOCAL !== 'false';
  return process.env.LOCAL_ONLY !== 'false';
}
// Maxfiylik: lokal STT ishlamay qolsa, bemor audiosi faqat shu flag ochiq bo'lsa cloud'ga yuboriladi.
function cloudFallbackAllowed() { return process.env.STT_CLOUD_FALLBACK === 'true'; }

// ─── Tillar ──────────────────────────────────────────────
// DIQQAT: model o'zbekcha uchun fine-tune qilingani sababli avto-aniqlash
// ishonchsiz (ruscha audioni ham o'zbekcha deb o'qiydi). Shuning uchun til
// aniq ko'rsatilishi shart — UI dan uzatiladi.
export const SUPPORTED_LANGUAGES = ['uz', 'ru'];
export const DEFAULT_LANGUAGE = 'uz';

const MEDICAL_PROMPTS = {
  uz: "O'zbek tilidagi tibbiy matn. Bemor shikoyatlari, tashxis, dori nomlari: " +
    "paratsetamol, amoksitsillin, ibuprofen, azitromitsin, dexametazon, prednizolon, loratadin, omeprazol, " +
    "metformin, qon bosimi, yurak urishi, harorat, yuqori nafas yo'llari, oshqozon, jigar, buyrak. " +
    "O'zbek lotin alifbosi (o'g', sh, ch, o', q, g').",
  ru: "Медицинский текст на русском языке. Жалобы пациента, диагноз, названия лекарств: " +
    "парацетамол, амоксициллин, ибупрофен, азитромицин, дексаметазон, преднизолон, лоратадин, омепразол, " +
    "метформин, артериальное давление, частота сердечных сокращений, температура, верхние дыхательные пути, " +
    "желудок, печень, почки. Пишите на русском языке кириллицей.",
};

export function normalizeLanguage(lang) {
  const l = String(lang || '').trim().toLowerCase().slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(l) ? l : DEFAULT_LANGUAGE;
}

// ─── Transkripsiya ───────────────────────────────────────
function makeForm(audioBuffer, filename, opts) {
  const isWav = filename.endsWith('.wav');
  const mime = isWav ? 'audio/wav' : 'audio/webm';
  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: mime });
  form.append('file', blob, filename);
  form.append('response_format', 'json');
  const language = normalizeLanguage(opts.language);
  form.append('language', language);
  form.append('prompt', opts.prompt || MEDICAL_PROMPTS[language] || MEDICAL_PROMPTS.uz);
  if (opts.temperature !== undefined) form.append('temperature', String(opts.temperature));
  return form;
}

export async function transcribe(audioBuffer, filename = 'audio.webm', opts = {}) {
  // 1-URINISH: Lokal whisper.cpp
  // MUHIM: whisper.cpp server OpenAI API formatini to'liq qo'llab-quvvatlaydi!
  // Aynan shu API (https://api.groq.com/openai/v1/audio/transcriptions) bilan bir xil
  if (isLocal()) {
    try {
      const form = makeForm(audioBuffer, filename, opts);
      const res = await fetch(`${WHISPER_URL}/v1/audio/transcriptions`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer not-needed' }, // whisper.cpp auth talab qilmaydi
        body: form,
        signal: AbortSignal.timeout(60000) // 1 min (katta audio uchun)
      });
      if (!res.ok) throw new Error(`STT HTTP ${res.status}`);
      const data = await res.json();
      const text = data.text || '';
      return { text, segments: data.segments || null, language: normalizeLanguage(opts.language), error: null };
    } catch (e) {
      // Lokal STT ishlamadi. Maxfiylik: cloud fallback faqat aniq ruxsat berilgan bo'lsa.
      if (!cloudFallbackAllowed() || !groqKey()) {
        return { text: '', error: `Lokal STT xatosi: ${e.message}. STT konteyneri (whisper) ishlayotganiga ishonch hosil qiling.` };
      }
      console.warn(`[STT] Lokal STT mavjud emas (${e.message}), cloud ga o'tilmoqda (STT_CLOUD_FALLBACK)...`);
    }
  }

  // 2-URINISH: Cloud (Groq Whisper)
  const key = groqKey();
  if (!key) return { text: '', error: 'STT kaliti sozlanmagan. whisper.cpp yoki GROQ_API_KEY kerak.' };

  try {
    const form = makeForm(audioBuffer, filename, opts);
    form.append('model', 'whisper-large-v3');
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60000)
    });
    const data = await res.json();
    return { text: data.text || '', segments: data.segments || null, language: normalizeLanguage(opts.language), error: data.error?.message || null };
  } catch (e) {
    return { text: '', error: e.message };
  }
}

// ─── Translate (audioni ingliz tiliga tarjima) ───────────
export async function translate(audioBuffer, filename = 'audio.webm', targetLang = 'en') {
  if (isLocal()) {
    try {
      // whisper.cpp translate ni qo'llab-quvvatlamaydi, transcribe qilamiz
      const result = await transcribe(audioBuffer, filename, { language: targetLang });
      return result;
    } catch (e) {
      if (process.env.LOCAL_ONLY === 'true') return { text: '', error: e.message };
    }
  }

  const key = groqKey();
  if (!key) return { text: '', error: 'GROQ_API_KEY not set' };
  try {
    const form = makeForm(audioBuffer, filename, { language: targetLang });
    form.append('model', 'whisper-large-v3');
    const res = await fetch('https://api.groq.com/openai/v1/audio/translations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${key}` },
      body: form
    });
    const data = await res.json();
    return { text: data.text || '', error: data.error?.message || null };
  } catch (e) {
    return { text: '', error: e.message };
  }
}

export function isSTTReady() {
  if (isLocal()) return true; // optimistic
  return !!groqKey();
}
