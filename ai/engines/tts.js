// ============================================================
// Falcon AI OS — Local TTS Engine (Edge-TTS + Piper + Fallback)
// RTX 5070 → Edge-TTS (bepul, Uzbek tilida gapiradi)
// Offline → Piper TTS (CPU, 200MB RAM, 50MB disk)
// ============================================================

import { spawn } from 'child_process';
import { createServer } from 'net';

const EDGE_TTS_PORT = 50081;
const PIPER_PORT = 50082;

function isLocal() { return process.env.LOCAL_ONLY !== 'false'; }

// ─── Edge-TTS (bepul, internet kerak, Uzbek tilida gapiradi) ───
async function edgeTTS(text, options = {}) {
  try {
    const voice = options.voice || 'uz-UZ-MadinaNeural'; // Uzbek ayol ovozi
    const rate = options.speed ? `+${Math.round((options.speed - 1) * 50)}%` : '+0%';

    const res = await fetch(
      `http://localhost:${EDGE_TTS_PORT}/api/speak?text=${encodeURIComponent(text)}&voice=${voice}&rate=${rate}`,
      { signal: AbortSignal.timeout(30000) }
    );
    if (!res.ok) throw new Error(`Edge-TTS HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null; // Edge-TTS mavjud emas
  }
}

// ─── Piper TTS (to'liq offline, CPU, Uzbek ovoz train qilish kerak) ───
async function piperTTS(text) {
  try {
    const res = await fetch(`http://localhost:${PIPER_PORT}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30000)
    });
    if (!res.ok) throw new Error(`Piper HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// ─── Asosiy TTS ──────────────────────────────────────────
export async function speak(text, options = {}) {
  if (!text) return null;

  // 1-URINISH: Edge-TTS (bepul, uzbekcha)
  if (isLocal()) {
    let audio = await edgeTTS(text, options);
    if (audio) return audio;

    // 2-URINISH: Piper TTS (offline)
    audio = await piperTTS(text);
    if (audio) return audio;

    if (process.env.LOCAL_ONLY === 'true') {
      console.warn('[TTS] Lokal TTS mavjud emas. Edge-TTS yoki Piper serverini ishga tushiring.');
      return null;
    }
  }

  // 3-URINISH: OpenAI TTS (cloud, API_KEY kerak)
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || openaiKey === '***') return null;

  try {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: options.model || 'tts-1',
        input: text,
        voice: options.voice || 'alloy',
        response_format: options.format || 'mp3',
        speed: options.speed || 1.0
      })
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

// ─── Streaming TTS ───────────────────────────────────────
export async function speakStreaming(text, options = {}) {
  // Edge-TTS streaming orqali
  if (isLocal()) {
    try {
      const voice = options.voice || 'uz-UZ-MadinaNeural';
      const res = await fetch(
        `http://localhost:${EDGE_TTS_PORT}/api/speak-stream?text=${encodeURIComponent(text)}&voice=${voice}`,
        { signal: AbortSignal.timeout(30000) }
      );
      if (res.ok) return res.body;
    } catch { /* fall through */ }
  }

  // OpenAI TTS streaming
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey || openaiKey === '***') return null;
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
    body: JSON.stringify({
      model: options.model || 'tts-1-hd',
      input: text,
      voice: options.voice || 'alloy',
      response_format: 'opus',
      speed: options.speed || 1.0
    })
  });
  if (!res.ok) return null;
  return res.body;
}

export function isTTSReady() {
  // Edge-TTS yoki Piper mavjud deb hisoblaymiz
  return true;
}
