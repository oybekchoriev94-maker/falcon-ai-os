const IS_PROD = process.env.NODE_ENV === 'production';

export function safeError(res, err, status = 500) {
  console.error(`[ERROR] ${err?.message || err}`, err?.stack || '');
  return res.status(status).json({
    success: false,
    error: IS_PROD ? 'Server xatosi yuz berdi' : (err?.message || String(err))
  });
}
