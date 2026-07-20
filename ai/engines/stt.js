// ============================================================
// Falcon AI OS — Local STT Engine (whisper.cpp + Fallback Cloud)
// RTX 5070 → whisper-large-v3-turbo @ http://localhost:8081
// ============================================================

const WHISPER_URL = 'http://localhost:8081';

function groqKey() { return (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== '***') ? process.env.GROQ_API_KEY : ''; }
function isLocal() { return process.env.LOCAL_ONLY !== 'false'; }

// ─── Transkripsiya ───────────────────────────────────────
function makeForm(audioBuffer, filename, opts) {
  const isWav = filename.endsWith('.wav');
  const mime = isWav ? 'audio/wav' : 'audio/webm';
  const form = new FormData();
  const blob = new Blob([audioBuffer], { type: mime });
  form.append('file', blob, filename);
  form.append('response_format', 'json');
  form.append('language', opts.language || 'uz');
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
      if (!res.ok) throw new Error(`whisper.cpp HTTP ${res.status}`);
      const data = await res.json();
      const text = data.text || '';
      return { text, segments: data.segments || null, error: null };
    } catch (e) {
      if (process.env.LOCAL_ONLY === 'true') {
        return { text: '', error: `Lokal STT xatosi: ${e.message}. whisper.cpp serverini ishga tushiring.` };
      }
      console.warn(`[STT] whisper.cpp mavjud emas (${e.message}), cloud ga o'tilmoqda...`);
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
    return { text: data.text || '', segments: data.segments || null, error: data.error?.message || null };
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
