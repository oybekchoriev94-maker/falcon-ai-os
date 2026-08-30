const IS_PROD = process.env.NODE_ENV === 'production';

export function safeError(res, err, status = 500) {
  console.error(`[ERROR] ${err?.message || err}`, err?.stack || '');
  return res.status(status).json({
    success: false,
    error: IS_PROD ? 'Server xatosi yuz berdi' : (err?.message || String(err))
  });
}

/**
 * Foydalanuvchiga TUSHUNARLI xabar, ichki tafsilotsiz.
 *
 * NEGA KERAK: yangi modullarda `{ error: "...", details: e.message }`
 * naqshi ishlatilgan edi. `e.message` esa Postgres xatosini xom holicha
 * uzatadi: jadval va ustun nomlari, cheklov (constraint) nomlari,
 * ba'zan so'rov parchasi. Bu hujumchiga baza tuzilishini bepul beradi.
 *
 * Endi: xato HAR DOIM serverda to'liq loglanadi, mijozga esa tafsilot
 * faqat production'DAN TASHQARI muhitlarda boradi (dev'da qulay).
 */
export function serverFail(res, err, userMessage, status = 500) {
  console.error(`[ERROR] ${userMessage}: ${err?.message || err}`, err?.stack || '');
  return res.status(status).json({
    success: false,
    error: userMessage,
    ...(IS_PROD ? {} : { details: err?.message || String(err) }),
  });
}
