// ============================================================
// Falcon AI OS — Local STT Engine (whisper.cpp + Fallback Cloud)
// RTX 5070 → whisper-large-v3-turbo @ http://localhost:8081
// ============================================================

const WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:8081';
// Lokal Docker tarmog'ida bo'sh — xizmat tashqariga chiqmaydi.
// Klinika kompyuteridagi STT tunnel orqali ochilsa, shu token majburiy.
const STT_AUTH_TOKEN = process.env.STT_AUTH_TOKEN || '';

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

// DIQQAT: joriy o'zbekcha fine-tuned model initial_prompt bilan ishlamaydi —
// prompt yuborilsa transkripsiya buziladi (production'da tekshirilgan:
// o'zbekcha promptda "zg zg z", ruscha promptda bo'sh matn). Shuning uchun
// tibbiy prompt sukut bo'yicha YUBORILMAYDI. Boshqa model ishlatilganda
// STT_USE_PROMPT=true qilib yoqish mumkin.
const USE_PROMPT = process.env.STT_USE_PROMPT === 'true';

const MEDICAL_PROMPTS = {
  uz: "O'zbek tilidagi tibbiy matn. Dori nomlari: paratsetamol, amoksitsillin, ibuprofen, " +
    "azitromitsin, omeprazol, metformin. Qon bosimi, harorat, oshqozon, jigar, buyrak.",
  ru: "Медицинский текст. Лекарства: парацетамол, амоксициллин, ибупрофен, азитромицин, " +
    "омепразол, метформин. Артериальное давление, температура, желудок, печень, почки.",
};

export function normalizeLanguage(lang) {
  const l = String(lang || '').trim().toLowerCase().slice(0, 2);
  return SUPPORTED_LANGUAGES.includes(l) ? l : DEFAULT_LANGUAGE;
}

/**
 * Tilni qat'iy tekshiradi. Tizim FAQAT o'zbek va rus tillarini qo'llab-quvvatlaydi:
 * boshqa til so'ralsa jim almashtirilmaydi, aniq xato qaytariladi (aks holda
 * model tushunmagan tilni "o'zbekcha" deb axlat matn chiqaradi).
 *
 * @returns {{ ok: true, language: string } | { ok: false, error: string }}
 */
export function validateLanguage(lang) {
  // Ko'rsatilmagan bo'lsa — klinikaning asosiy tili
  if (lang === undefined || lang === null || String(lang).trim() === '') {
    return { ok: true, language: DEFAULT_LANGUAGE };
  }
  const l = String(lang).trim().toLowerCase().slice(0, 2);
  if (!SUPPORTED_LANGUAGES.includes(l)) {
    return {
      ok: false,
      error: `"${lang}" tili qo'llab-quvvatlanmaydi. Faqat o'zbek (uz) va rus (ru) tillari mavjud.`,
    };
  }
  return { ok: true, language: l };
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
  // Prompt faqat aniq so'ralganda (yuqoridagi izohga qarang)
  const prompt = opts.prompt || (USE_PROMPT ? MEDICAL_PROMPTS[language] : '');
  if (prompt) form.append('prompt', prompt);
  if (opts.temperature !== undefined) form.append('temperature', String(opts.temperature));
  return form;
}

// STT xizmatining endpoint nomi ikki xil bo'lishi mumkin:
//   /v1/audio/transcriptions — asosiy (OpenAI-mos)
//   /transcribe              — eski nom, klinikadagi GPU konteynerida shu
// Nomi mos kelmasa 404 chiqadi va shifokor "ovoz qabul qilinmadi" deb ko'radi —
// bu aynan production'da sodir bo'lgan. Shuning uchun birinchi so'rovda
// ikkalasini sinaymiz va ishlaganini eslab qolamiz (keyingi so'rovlar tez ketadi).
const STT_PATHS = ['/v1/audio/transcriptions', '/transcribe'];
let _workingSttPath = null;

async function postToWhisper(audioBuffer, filename, opts) {
  const paths = _workingSttPath ? [_workingSttPath] : STT_PATHS;
  let lastRes = null;

  for (const path of paths) {
    const res = await fetch(`${WHISPER_URL}${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${STT_AUTH_TOKEN || 'not-needed'}` },
      // FormData har urinishda qaytadan quriladi — oqim bir marta o'qiladi
      body: makeForm(audioBuffer, filename, opts),
      signal: AbortSignal.timeout(60000),
    });
    // Faqat 404 boshqa yo'lni sinashga arziydi; qolgan xatolar haqiqiy xato.
    if (res.status !== 404) {
      _workingSttPath = path;
      return res;
    }
    lastRes = res;
  }
  // Eslab qo'yilgan yo'l endi 404 bera boshlasa (xizmat almashtirilgan) —
  // keshni tozalaymiz, keyingi so'rov ikkalasini qaytadan sinaydi.
  _workingSttPath = null;
  return lastRes;
}

export async function transcribe(audioBuffer, filename = 'audio.webm', opts = {}) {
  // Til siyosati: faqat o'zbek va rus. Boshqa til so'ralsa — aniq xato.
  const langCheck = validateLanguage(opts.language);
  if (!langCheck.ok) {
    return { text: '', language: null, error: langCheck.error, code: 'UNSUPPORTED_LANGUAGE' };
  }
  opts = { ...opts, language: langCheck.language };

  // 1-URINISH: Lokal whisper.cpp
  // MUHIM: whisper.cpp server OpenAI API formatini to'liq qo'llab-quvvatlaydi!
  // Aynan shu API (https://api.groq.com/openai/v1/audio/transcriptions) bilan bir xil
  if (isLocal()) {
    try {
      const res = await postToWhisper(audioBuffer, filename, opts);
      if (!res.ok) {
        // Xato tanasini o'qiymiz — server aniq sababni yozadi (til qo'llab-
        // quvvatlanmaydi / fayl katta / model hali yuklanmoqda). Ilgari
        // faqat status raqami olinardi va shifokorga har doim "STT
        // konteyneri ishlayotganini tekshiring" deb noto'g'ri maslahat berilardi.
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ? `${body.detail} (HTTP ${res.status})` : `STT HTTP ${res.status}`);
      }
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

export function isSTTReady() {
  if (isLocal()) return true; // optimistic
  return !!groqKey();
}
