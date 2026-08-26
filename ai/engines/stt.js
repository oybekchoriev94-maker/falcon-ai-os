// ============================================================
// Falcon AI OS — Lokal STT Engine (faster-whisper + cloud fallback)
//
// Production: `stt-service/` konteyneri (FastAPI + faster-whisper),
// model — rubaiSTT v2 medium (islomov/rubaistt_v2_medium), CTranslate2
// int8 formatida, /models/rubaistt-v2-medium-ct2 papkasidan o'qiladi.
// Docker tarmog'i ichida: http://stt:8081 (port tashqariga chiqarilmagan).
//
// Bu modul HTTP orqali gaplashadi va OpenAI Audio API formatini
// ishlatadi — shuning uchun narigi tomonda faster-whisper, whisper.cpp
// yoki Groq turishi mumkin, kod o'zgarmaydi. Faqat WHISPER_URL almashadi.
// ============================================================

// ASOSIY STT — klinika kompyuteridagi GPU (SSH reverse tunnel orqali).
// O'lchangan farq: 25s audio GPU'da 1.2s, VPS protsessorida ~9.4s (8x).
const WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:8081';

// ZAXIRA STT — asosiysi javob bermasa shunga o'tiladi.
//
// NEGA MAJBURIY: GPU kompyuter o'chsa, tunnel uzilsa yoki klinikada
// internet yo'qolsa, ovoz BUTUNLAY ishlamay qoladi. Aynan shunday
// holat allaqachon bo'lgan — Tailscale mesh jimgina o'lgan va buni
// shifokor "ovoz qabul qilinmadi" xatosini ko'rgandagina sezganmiz.
// Zaxira VPS'ning o'z konteyneri: sekinroq, lekin ishlaydi va
// klinika ishi to'xtamaydi.
const WHISPER_FALLBACK_URL = process.env.WHISPER_FALLBACK_URL || '';
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

// DIQQAT — bu cheklov ESKI modelda kuzatilgan, YANGISIDA TEKSHIRILMAGAN.
// Nafaqaga chiqarilgan `hostmepanda/whisper-large-v3-turbo-uzbek-ct2`
// initial_prompt bilan ishlamasdi: prompt yuborilsa transkripsiya buzilardi
// (production'da tekshirilgan: o'zbekcha promptda "zg zg z", ruscha promptda
// bo'sh matn). Hozirgi model — rubaiSTT v2 medium — buni ko'tara oladimi,
// HALI O'LCHANMAGAN.
// Shuning uchun tibbiy prompt sukut bo'yicha hamon YUBORILMAYDI: prompt
// modelni buzsa, natija bemor kartasiga tushadi — sinovsiz yoqish mumkin
// emas. O'lchash: scripts/stt-compare/03-compare.sh uz prompt
// Natija ijobiy bo'lsa — STT_USE_PROMPT=true (ilova va stt-service'da).
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
// Ishlagan yo'l HAR SERVER UCHUN ALOHIDA eslab qolinadi. Asosiy va zaxira
// server turli nomlarni qo'llab-quvvatlashi mumkin (klinikadagi eski
// konteynerda faqat /transcribe bor edi) — bitta umumiy kesh ishlatilsa,
// zaxiraga o'tilganda noto'g'ri yo'l tanlanib 404 olinardi.
const _workingPath = new Map();   // baseUrl -> path

async function postToOneServer(baseUrl, audioBuffer, filename, opts) {
  const known = _workingPath.get(baseUrl);
  const paths = known ? [known] : STT_PATHS;
  let lastRes = null;

  for (const path of paths) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${STT_AUTH_TOKEN || 'not-needed'}` },
      // FormData har urinishda qaytadan quriladi — oqim bir marta o'qiladi
      body: makeForm(audioBuffer, filename, opts),
      // Uzun diktant o'rtada kesilib, matn butunlay yo'qolishidan ko'ra
      // ko'proq kutish yaxshiroq. GPU'da bu chegaraga umuman yetilmaydi;
      // zaxira (protsessor) uchun esa zarur.
      signal: AbortSignal.timeout(120000),
    });
    // Faqat 404 boshqa yo'lni sinashga arziydi; qolgan xatolar haqiqiy xato.
    if (res.status !== 404) {
      _workingPath.set(baseUrl, path);
      return res;
    }
    lastRes = res;
  }
  // Eslab qo'yilgan yo'l endi 404 bera boshlasa (xizmat almashtirilgan) —
  // keshni tozalaymiz, keyingi so'rov ikkalasini qaytadan sinaydi.
  _workingPath.delete(baseUrl);
  return lastRes;
}

/**
 * Asosiy STT'ga yuboradi; u yetib bo'lmasa zaxiraga o'tadi.
 *
 * Faqat ULANISH xatosida (GPU kompyuter o'chiq, tunnel uzilgan, timeout)
 * zaxiraga o'tamiz. Server javob bergan bo'lsa — hatto xato bilan ham —
 * o'sha javobni qaytaramiz: masalan "til qo'llab-quvvatlanmaydi" (400)
 * yoki "audio juda katta" (413) zaxirada ham xuddi shunday bo'ladi,
 * qayta urinish faqat vaqt yo'qotadi va bemorni kutdiradi.
 */
async function postToWhisper(audioBuffer, filename, opts) {
  try {
    return await postToOneServer(WHISPER_URL, audioBuffer, filename, opts);
  } catch (e) {
    if (!WHISPER_FALLBACK_URL || WHISPER_FALLBACK_URL === WHISPER_URL) throw e;
    console.warn(
      `[STT] Asosiy STT javob bermadi (${WHISPER_URL}): ${e.message}. ` +
      `Zaxiraga o'tilmoqda: ${WHISPER_FALLBACK_URL}`
    );
    return await postToOneServer(WHISPER_FALLBACK_URL, audioBuffer, filename, opts);
  }
}

export async function transcribe(audioBuffer, filename = 'audio.webm', opts = {}) {
  // Til siyosati: faqat o'zbek va rus. Boshqa til so'ralsa — aniq xato.
  const langCheck = validateLanguage(opts.language);
  if (!langCheck.ok) {
    return { text: '', language: null, error: langCheck.error, code: 'UNSUPPORTED_LANGUAGE' };
  }
  opts = { ...opts, language: langCheck.language };

  // 1-URINISH: Lokal STT xizmati (stt-service — faster-whisper + rubaiSTT v2)
  // MUHIM: xizmat OpenAI Audio API formatini to'liq qo'llab-quvvatlaydi —
  // aynan shu API (https://api.groq.com/openai/v1/audio/transcriptions) bilan
  // bir xil. Shu sababli pastdagi cloud fallback bir xil `makeForm()` ni
  // ishlatadi va model almashtirilganda bu kodga tegilmaydi.
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
  if (!key) return { text: '', error: 'STT sozlanmagan. Lokal STT xizmati (stt konteyneri) yoki GROQ_API_KEY kerak.' };

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
