// ============================================================
// Qurilma tokeni bilan autentifikatsiya (kiosk planshetlari,
// davomat agentlari — ya'ni foydalanuvchi emas, QURILMA kiradigan
// hamma joy).
//
// Nega alohida modul: kiosk.js da bu mantiq ishlab turibdi va unga
// tegmadik. Yangi marshrutlar shu moduldan foydalanadi. Kelajakda
// kiosk.js ni ham shunga o'tkazish mumkin — lekin ishlayotgan
// production kodini sababsiz qo'zg'atmaymiz.
//
// Token bazada OCHIQ SAQLANMAYDI — faqat sha256 hash.
// ============================================================
import crypto from 'node:crypto';
import { bindTenantDbContext } from '../request-tenant-context.js';

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * Express middleware yasaydi.
 *
 * @param {object} pool         pg Pool
 * @param {string[]} allowKinds Ruxsat etilgan qurilma turlari.
 *                              Masalan ['attendance'] — kiosk planshetining
 *                              tokeni davomat endpointiga kira olmasin.
 */
export function makeDeviceAuth(pool, allowKinds = null) {
  return async function deviceAuth(req, res, next) {
    const token = req.headers['x-kiosk-token'] || req.headers['x-device-token'] || '';
    if (!token) {
      return res.status(401).json({
        success: false, error: 'Qurilma tokeni yo\'q', code: 'NO_DEVICE_TOKEN',
      });
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, tenant_id, name, kind, allowed_ips
           FROM kiosk_devices
          WHERE token_hash = $1 AND is_active = true`,
        [sha256(token)]
      );
      const dev = rows[0];
      if (!dev) {
        return res.status(401).json({
          success: false, error: 'Qurilma tokeni yaroqsiz', code: 'BAD_DEVICE_TOKEN',
        });
      }

      // Tur cheklovi — bir qurilma tokeni boshqa tizimga kirmasin
      if (allowKinds && !allowKinds.includes(dev.kind)) {
        return res.status(403).json({
          success: false,
          error: 'Bu qurilma turi uchun ruxsat yo\'q',
          code: 'WRONG_DEVICE_KIND',
        });
      }

      // IP cheklovi (sozlangan bo'lsa)
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      if (dev.allowed_ips?.length && ip && !dev.allowed_ips.includes(ip)) {
        return res.status(403).json({
          success: false, error: 'Ruxsat etilmagan tarmoq', code: 'IP_BLOCKED',
        });
      }

      req.device = dev;
      req.deviceTenantId = dev.tenant_id;
      req.tenant_id = dev.tenant_id;

      // last_seen — javobni kutkuzmaymiz
      pool.query(
        `UPDATE kiosk_devices SET last_seen_at = NOW(), last_seen_ip = $1::inet WHERE id = $2`,
        [ip || null, dev.id]
      ).catch(() => {});

      // RLS KONTEKSTI MAJBURIY. Ilova bazaga `falcon_app` roli bilan
      // ulanadi (RLS_ENFORCE_APP_ROLE=true) va RLS'ni chetlab o'tolmaydi;
      // siyosat `tenant_id = current_setting('app.tenant_id')`. JWT bilan
      // kirilganda buni auth middleware o'rnatadi, qurilma tokeni bilan
      // esa hech kim o'rnatmasdi — natijada har bir SELECT bo'sh qaytar,
      // har bir INSERT esa WITH CHECK bo'yicha rad etilardi. Xato
      // chiqmaydi, shuning uchun buni sezish deyarli imkonsiz.
      return bindTenantDbContext(dev.tenant_id, res, next);
    } catch (e) {
      console.error('[DEVICE auth]', e);
      res.status(500).json({ success: false, error: 'Server xatosi' });
    }
  };
}

/** Oddiy xotiradagi rate limiter (kiosk.js dagi bilan bir xil yondashuv) */
const buckets = new Map();
export function checkRate(key, limit, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n += 1;
  buckets.set(key, b);
  return b.n <= limit;
}
