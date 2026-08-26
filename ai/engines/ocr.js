// ============================================================
// Falcon AI OS — OCR Engine (gated, OpenAI-uslub HTTP shartnoma)
//
// Qog'oz hujjat rasmlaridan matn olish. Roadmap doktrinasi:
// hujjat rasmlari LOKAL klinikada qoladi — cloud OCR'ga yuborilmaydi.
// Shu sababli bu dvigatel FAQAT lokal/xususiy OCR xizmatiga ishlaydi:
// Tesseract yoki boshqa OCR konteyneri, HTTP orqali.
//
// Shartnoma: POST {OCR_URL}/ocr  (multipart: file)
//   Javob: { "text": "...", "confidence": 0.93 }
//
// OCR_URL bo'sh bo'lsa — dvigatel O'CHIQ: hech narsa sinmaydi,
// route aniq kod qaytaradi (OCR_DISABLED). Hujjat matnini qo'lda
// kiritish yoki STT diktant yo'li ochiq qoladi.
// ============================================================

const OCR_URL = (process.env.OCR_URL || '').trim().replace(/\/$/, '');
const OCR_AUTH_TOKEN = process.env.OCR_AUTH_TOKEN || '';
const OCR_TIMEOUT_MS = parseInt(process.env.OCR_TIMEOUT_MS || '60000', 10);

export function isOCRReady() {
  return OCR_URL.length > 0;
}

/**
 * Rasm faylini OCR xizmatiga yuborib matn qaytaradi.
 *
 * @param {Buffer|Uint8Array} imageBuffer rasm baytlari
 * @param {string} filename asl fayl nomi (kengaytma muhim: jpg/png/webp)
 * @returns {Promise<{text: string, confidence?: number, error?: string, code?: string}>}
 */
export async function recognizeImage(imageBuffer, filename = 'image.jpg') {
  if (!isOCRReady()) {
    return { text: '', error: 'OCR xizmati sozlanmagan (OCR_URL bo\'sh)', code: 'OCR_DISABLED' };
  }
  if (!imageBuffer?.length) {
    return { text: '', error: 'Rasm fayli bo\'sh', code: 'EMPTY_IMAGE' };
  }

  const ext = String(filename).split('.').pop()?.toLowerCase() || 'jpg';
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp' }[ext] || 'image/jpeg';

  try {
    const form = new FormData();
    form.append('file', new Blob([imageBuffer], { type: mime }), filename);
    const res = await fetch(`${OCR_URL}/ocr`, {
      method: 'POST',
      headers: OCR_AUTH_TOKEN ? { Authorization: `Bearer ${OCR_AUTH_TOKEN}` } : {},
      body: form,
      signal: AbortSignal.timeout(Number.isFinite(OCR_TIMEOUT_MS) ? OCR_TIMEOUT_MS : 60000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { text: '', error: body.detail || body.error || `OCR HTTP ${res.status}`, code: 'OCR_ERROR' };
    }
    const data = await res.json();
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    if (!text) return { text: '', error: 'OCR matn topa olmadi', code: 'OCR_EMPTY' };
    return {
      text,
      confidence: Number.isFinite(Number(data.confidence)) ? Number(data.confidence) : null,
      error: null,
    };
  } catch (e) {
    return { text: '', error: `OCR xatosi: ${e.message}`, code: 'OCR_ERROR' };
  }
}
