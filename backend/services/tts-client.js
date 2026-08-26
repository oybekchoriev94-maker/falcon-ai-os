// ============================================================
// Falcon AI OS — TTS klient (OmniVoice xizmatiga)
//
// stt-service'dagi ai/engines/stt.js bilan bir xil falsafa:
//   - TTS_URL bo'sh bo'lsa xizmat O'CHIQ hisoblanadi — hech narsa
//     buzilmaydi, endpoint aniq TTS_DISABLED kodini qaytaradi
//   - Tarmoq xatosida null qaytadi (navbat ekrani ishlashda davom
//     etadi — ovoz yo'q, lekin ro'yxat ko'rinadi)
//   - Natija keshlanadi: TV har necha soniyada so'raydi, bir xil
//     e'lon uchun GPU'ni qayta ishlatish shart emas
//
// Barcha WAV'lar TTS xizmatidan bir xil formatda keladi:
// 24kHz mono 16-bit PCM — concatWavBuffers shu farazda ishlaydi.
// ============================================================

import crypto from 'node:crypto';

const TTS_URL = (process.env.TTS_URL || '').replace(/\/+$/, '');
const TTS_AUTH_TOKEN = process.env.TTS_AUTH_TOKEN || '';

// Kesh: matn hash -> { buf, at }. TV polling har 5-10 soniyada keladi.
const _cache = new Map();
const CACHE_MAX = 100;

export function isTtsEnabled() {
  return !!TTS_URL;
}

/**
 * Bir xil formatli (24kHz mono 16-bit) WAV bufferlarni birlashtiradi.
 * Navbatda bir nechta bemor chaqirilganda bitta audio chalinadi.
 * @param {Buffer[]} buffers
 * @returns {Buffer}
 */
export function concatWavBuffers(buffers = []) {
  const valid = buffers.filter((b) => Buffer.isBuffer(b) && b.length > 44);
  if (valid.length === 0) return Buffer.alloc(0);
  if (valid.length === 1) return valid[0];
  const chunks = valid.map((b) => b.subarray(44));
  const totalData = chunks.reduce((s, c) => s + c.length, 0);
  const out = Buffer.alloc(44 + totalData);
  valid[0].subarray(0, 44).copy(out, 0); // bosh birinchidan olinadi
  let off = 44;
  for (const c of chunks) { c.copy(out, off); off += c.length; }
  out.writeUInt32LE(36 + totalData, 4);   // RIFF chunk o'lchami
  out.writeUInt32LE(totalData, 40);       // data chunk o'lchami
  return out;
}

/**
 * Matnni TTS xizmatida o'qitadi. Kesh bilan.
 * @param {string} text
 * @param {{ voice?: string, language?: string }} opts
 * @returns {Promise<Buffer|null>} WAV buffer; o'chiq/xato bo'lsa null
 */
export async function synthesize(text, opts = {}) {
  if (!isTtsEnabled()) return null;
  const t = String(text || '').trim();
  if (!t) return null;

  const key = crypto.createHash('sha256')
    .update(`${t}|${opts.voice || ''}|${opts.language || ''}`)
    .digest('hex');
  const hit = _cache.get(key);
  if (hit) return hit.buf;

  try {
    const res = await fetch(`${TTS_URL}/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TTS_AUTH_TOKEN || 'not-needed'}`,
      },
      body: JSON.stringify({ text: t, voice: opts.voice || null, language: opts.language || 'uz' }),
      // Navbat e'loni qisqa — GPU'da 1-2 soniya. Zaxira CPU sekinroq
      // bo'lishi mumkin, lekin TV'ni 30 soniyadan ko'p kuttirmaymiz.
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      console.warn(`[TTS] Sintez xatosi: HTTP ${res.status}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length <= 44) return null;
    // Keshni cheklab turamiz (eng eski yozuvni o'chirish yetarli)
    if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
    _cache.set(key, { buf, at: Date.now() });
    return buf;
  } catch (e) {
    console.warn('[TTS] Ulanish xatosi:', e.message);
    return null;
  }
}
