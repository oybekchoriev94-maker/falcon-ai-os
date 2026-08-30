import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { bindTenantDbContext } from './request-tenant-context.js';

export const JWT_EXPIRES = '2h';
export const JWT_ISSUER = 'falcon-ai-os';
export const JWT_AUDIENCE = 'falcon-clinic-api';
export const JWT_VERIFY_OPTIONS = Object.freeze({
  algorithms: ['HS256'],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
});

export function signToken(user) {
  const tenantId = user.tenant_id || user.clinic_id;
  if (!tenantId && user.role !== 'superadmin') {
    throw new Error('Token yaratish uchun tenant_id talab qilinadi');
  }
  const jti = uuidv4();
  return jwt.sign({
    jti,
    id: user.id,
    username: user.username,
    role: user.role || 'doctor',
    name: user.name || user.first_name + ' ' + (user.last_name || ''),
    tenant_id: tenantId || 'default',
    specialization: user.specialization || null,
    doctor_id: user.doctor_id || user.id,
    patient_id: user.patient_id || null
  }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    expiresIn: JWT_EXPIRES,
  });
}

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token talab qilinadi' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET, JWT_VERIFY_OPTIONS);
    if (!decoded.jti || !decoded.id || !decoded.tenant_id) {
      return res.status(403).json({ error: 'Token tenant kontekstiga ega emas' });
    }
    const pool = req.app?.locals?.pool || (await import('./db.js')).getPool();
    if (pool) {
      try {
        const result = await pool.query("SELECT id FROM token_blacklist WHERE jti = $1", [decoded.jti]);
        if (result.rows.length > 0) {
          return res.status(401).json({ error: 'Token bekor qilingan, qayta kirishingiz kerak' });
        }
      } catch (_) {
        return res.status(503).json({ error: 'Session holatini tekshirib bo\'lmadi' });
      }
    }
    req.user = decoded;
    req.tenant_id = decoded.tenant_id;
    res.setHeader('x-tenant-id', decoded.tenant_id);
    return bindTenantDbContext(decoded.tenant_id, res, next);
  } catch (e) {
    if (e.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token muddati tugagan, qayta kiring', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Token yaroqsiz yoki muddati o\'tgan' });
  }
}

/**
 * Ochiq (public) endpointlar uchun: token BO'LSA uni tekshirib req.user va
 * req.tenant_id ni o'rnatadi, bo'lmasa jim o'tkazadi.
 *
 * Nega kerak: tenantContext req.tenant_id ni x-tenant-id SARLAVHASIDAN oladi —
 * uni mijoz o'zi yozadi. Ya'ni autentifikatsiyasiz endpointda bir klinika
 * boshqasining ma'lumotini so'ray oladi. JWT esa soxtalashtirilmaydi, shuning
 * uchun token mavjud bo'lsa u har doim ustun turishi kerak.
 */
export async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return next();

  let decoded;
  try {
    // JWT_VERIFY_OPTIONS (issuer + audience) qo'shildi. Ilgari oddiy
    // `jwt.verify` ishlatilardi, ya'ni boshqa xizmat uchun berilgan,
    // lekin bir xil sir bilan imzolangan token ham qabul qilinardi.
    decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET, JWT_VERIFY_OPTIONS);
  } catch {
    return next();   // yaroqsiz token — ochiq foydalanuvchi sifatida davom etadi
  }

  // BEKOR QILINGAN TOKEN TEKSHIRUVI. Ilgari bu yerda yo'q edi: xodim
  // tizimdan chiqqach uning tokeni authMiddleware'da rad etilardi, lekin
  // optionalAuth'li endpointlarda (masalan /api/doctors) HAMON ishlar va
  // xodim darajasidagi ma'lumot berardi.
  try {
    const pool = req.app?.locals?.pool || (await import('./db.js')).getPool();
    if (pool && decoded.jti) {
      const r = await pool.query('SELECT 1 FROM token_blacklist WHERE jti = $1', [decoded.jti]);
      if (r.rows.length) return next();   // bekor qilingan — anonim davom etadi
    }
  } catch {
    // Tekshirib bo'lmadi. Bu ochiq endpoint, shuning uchun 503 qaytarmaymiz —
    // xavfsiz tomonga og'amiz va tokenni HISOBGA OLMAYMIZ.
    return next();
  }

  req.user = decoded;
  if (!decoded.tenant_id) return next();
  req.tenant_id = decoded.tenant_id;
  // RLS konteksti — tokendagi tenant sarlavhadagidan ustun turadi
  return bindTenantDbContext(decoded.tenant_id, res, next);
}

export function checkRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Autentifikatsiya talab qilinadi' });
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access Denied' });
    }
    next();
  };
}

export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      return res.status(400).json({ error: 'Validatsiya xatosi', details: errors });
    }
    req.body = result.data;
    next();
  };
}

export async function validateNonce(req, res, next) {
  const { nonce, timestamp } = req.body;
  if (!nonce || typeof nonce !== 'string') return res.status(400).json({ error: 'nonce (yagona identifikator) talab qilinadi' });
  if (!timestamp || typeof timestamp !== 'number') return res.status(400).json({ error: 'timestamp (vaqt) talab qilinadi' });
  const now = Date.now();
  if (Math.abs(now - timestamp) > 30000) return res.status(400).json({ error: 'So\'rov vaqti tugagan, qayta urinib ko\'ring' });
  const pool = req.app?.locals?.pool || (await import('./db.js')).getPool();
  if (!pool) return res.status(500).json({ error: 'DB mavjud emas' });
  const existing = await pool.query("SELECT nonce FROM used_nonces WHERE nonce = $1", [nonce]);
  if (existing.rows.length > 0) return res.status(409).json({ error: 'Bu so\'rov allaqachon bajarilgan' });
  await pool.query("INSERT INTO used_nonces (nonce, expires_at) VALUES ($1, NOW() + INTERVAL '1 hour')", [nonce]);
  await pool.query("DELETE FROM used_nonces WHERE expires_at < NOW()");
  next();
}

/**
 * initData satrini QO'LDA ajratadi.
 *
 * NEGA URLSearchParams EMAS: URLSearchParams `+` belgisini BO'SH JOYGA
 * aylantiradi (application/x-www-form-urlencoded qoidasi). Telegram esa
 * qiymatlarni oddiy percent-encoding bilan yuboradi — ismda yoki base64
 * qiymatda `+` uchrasa, hash buziladi va tekshiruv sababsiz yiqiladi.
 * decodeURIComponent bunday qilmaydi.
 */
function parseInitData(initData) {
  const out = [];
  for (const chunk of String(initData).split('&')) {
    if (!chunk) continue;
    const i = chunk.indexOf('=');
    if (i < 0) continue;
    const k = chunk.slice(0, i);
    const v = chunk.slice(i + 1);
    try {
      out.push([decodeURIComponent(k), decodeURIComponent(v)]);
    } catch {
      out.push([k, v]);   // buzuq encoding — xom holda qoldiramiz
    }
  }
  return out;
}

function hmacHex(key, msg) {
  return crypto.createHmac('sha256', key).update(msg).digest('hex');
}

/**
 * Telegram initData `hash` imzosini bot tokeni bilan tekshiradi.
 *
 * QOIDA: data_check_string'dan FAQAT `hash` chiqariladi. `signature`
 * boshqa maydonlar kabi hisobga KIRADI.
 *
 * Bu joyda bir marta xato qilingan, shuning uchun izohlab qo'yamiz:
 * Bot API 8.0 initData'ga `signature` (Ed25519) maydonini qo'shdi. U
 * bot tokeni YO'Q uchinchi tomonlar uchun. Ikkalasi ikki xil tekshiruv:
 *   - `hash`      (HMAC, bot tokeni bilan) -> faqat `hash` chiqariladi
 *   - `signature` (Ed25519, ochiq kalit)   -> `hash` VA `signature` chiqariladi
 * Ed25519 qoidasini HMAC yo'liga qo'llash — har bir so'rovni 403 qiladi.
 * Bu production'da haqiqiy payload va haqiqiy token bilan tasdiqlangan.
 *
 * @returns {{ ok: true, fields: Map } | { ok: false, error: string, debug?: object }}
 */
function checkInitDataSignature(initData, botToken) {
  const pairs = parseInitData(initData);
  const hashPair = pairs.find(([k]) => k === 'hash');
  if (!hashPair) return { ok: false, error: 'Hash topilmadi' };
  const receivedHash = hashPair[1];

  const dataCheckString = pairs
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  if (hmacHex(secretKey, dataCheckString) === receivedHash) {
    return { ok: true, fields: new Map(pairs) };
  }

  // Sabab noma'lum qolmasin: kalitlar ro'yxati, hash boshlari va bot
  // identifikatori (tokendan OLDINGI qism — maxfiy emas) loglanadi.
  // Bot ID kutilganidan boshqa bo'lsa — token boshqa botniki degani.
  return {
    ok: false,
    error: 'hash mos kelmadi',
    debug: {
      kalitlar: pairs.map(([k]) => k).sort().join(','),
      kelgan_hash: receivedHash.slice(0, 12),
      hisoblangan: hmacHex(secretKey, dataCheckString).slice(0, 12),
      bot_id: String(botToken).split(':')[0] || '?',
      initData_uzunligi: String(initData).length,
    },
  };
}

export function verifyTelegramAuth(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return next();
  try {
    const botToken = process.env.TELEGRAM_TOKEN_PATIENT || process.env.TELEGRAM_TOKEN_REFERRAL || '';
    if (!botToken) return res.status(500).json({ success: false, error: 'BOT_TOKEN aniqlanmadi' });
    const check = checkInitDataSignature(initData, botToken);
    if (!check.ok) {
      if (check.debug) console.warn('[STAFF TMA AUTH] rad etildi:', JSON.stringify(check.debug));
      return res.status(403).json({ success: false, error: `Telegram autentifikatsiyasi muvaffaqiyatsiz: ${check.error}` });
    }
    const { fields } = check;
    const authDate = fields.get('auth_date');
    if (!authDate) return res.status(403).json({ success: false, error: 'Avtorizatsiya vaqti ko\'rsatilmagan' });
    if (Math.floor(Date.now() / 1000) - parseInt(authDate, 10) > 300) {
      return res.status(403).json({ success: false, error: 'Avtorizatsiya vaqti o\'tgan, ilovani qayta yuklang' });
    }
    const userStr = fields.get('user');
    if (!userStr) return res.status(403).json({ success: false, error: 'Foydalanuvchi ma\'lumoti topilmadi' });
    const tgUser = JSON.parse(userStr);
    req.telegramUser = tgUser;
    (async () => {
      try {
        const { unsafeQuery } = await import('./db.js');
        const staff = await unsafeQuery.qGet(
          "SELECT id, tenant_id, telegram_id, full_name, role, is_active FROM staff_members WHERE telegram_id = $1 AND is_active = true",
          [tgUser.id]
        );
        if (!staff) {
          return res.status(403).json({ success: false, error: 'Siz tizimda ro\'yxatdan o\'tmagansiz. Iltimos, ma\'muriyat bilan bog\'laning.' });
        }
        req.user = {
          id: tgUser.id?.toString(),
          username: tgUser.username || 'tg_' + tgUser.id,
          role: staff.role === 'CEO' ? 'ceo' : staff.role === 'DOCTOR' ? 'doctor' : 'admin',
          name: staff.full_name,
          staff_id: staff.id,
          tenant_id: staff.tenant_id,
        };
        req.tenant_id = staff.tenant_id;
        return bindTenantDbContext(staff.tenant_id, res, next);
      } catch (e) {
        console.error('[TELEGRAM AUTH ERROR]', e.message);
        return res.status(403).json({ success: false, error: 'Avtorizatsiya xatosi' });
      }
    })();
  } catch (e) {
    console.error('[TELEGRAM AUTH ERROR]', e.message);
    return res.status(403).json({ success: false, error: 'Avtorizatsiya xatosi' });
  }
}

// Telegram initData imzosini tekshiradi va req.telegramUser ni o'rnatadi.
// Bemor (patient) TMA endpointlari uchun — staff a'zoligini talab qilmaydi.
// Production: initData majburiy va imzosi tekshiriladi.
// Development/test: initData bo'lmasa, lokal test uchun x-telegram-id header'iga ruxsat.
export function verifyTelegramInitData(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  const isProd = process.env.NODE_ENV === 'production';

  if (!initData) {
    if (!isProd) {
      const devId = req.headers['x-telegram-id'] || req.query.telegram_id || req.body?.telegram_id;
      if (devId) {
        req.telegramUser = { id: devId };
        return next();
      }
    }
    return res.status(401).json({ success: false, error: 'Telegram autentifikatsiyasi talab qilinadi' });
  }

  try {
    const botToken = process.env.TELEGRAM_TOKEN_PATIENT || process.env.TELEGRAM_TOKEN_REFERRAL || '';
    if (!botToken) return res.status(500).json({ success: false, error: 'BOT_TOKEN aniqlanmadi' });
    const check = checkInitDataSignature(initData, botToken);
    if (!check.ok) {
      console.warn('[TMA AUTH] initData rad etildi:', check.error,
        check.debug ? JSON.stringify(check.debug) : '');
      return res.status(403).json({ success: false, error: 'Telegram autentifikatsiyasi muvaffaqiyatsiz' });
    }
    const { fields } = check;
    const authDate = fields.get('auth_date');
    if (!authDate || Math.floor(Date.now() / 1000) - parseInt(authDate, 10) > 86400) {
      return res.status(403).json({ success: false, error: 'Avtorizatsiya vaqti o\'tgan, ilovani qayta yuklang' });
    }
    const userStr = fields.get('user');
    if (!userStr) return res.status(403).json({ success: false, error: 'Foydalanuvchi ma\'lumoti topilmadi' });
    req.telegramUser = JSON.parse(userStr);
    req.telegramStartParam = fields.get('start_param') || null;
    return next();
  } catch (e) {
    console.error('[TMA AUTH] xato:', e.message);
    return res.status(403).json({ success: false, error: 'Avtorizatsiya xatosi' });
  }
}

export function telegramOrJwtAuth(...allowedRoles) {
  return (req, res, next) => {
    if (req.headers['x-telegram-init-data']) {
      return verifyTelegramAuth(req, res, () => checkRole(...allowedRoles)(req, res, next));
    }
    authMiddleware(req, res, () => checkRole(...allowedRoles)(req, res, next));
  };
}

export function isValidInternalSecret(receivedSecret) {
  const configuredSecret = process.env.INTERNAL_SECRET;
  if (!configuredSecret || !receivedSecret) return false;

  const received = Buffer.from(String(receivedSecret));
  const configured = Buffer.from(configuredSecret);
  return received.length === configured.length && crypto.timingSafeEqual(received, configured);
}

export function agentBypassOrAuth(...allowedRoles) {
  return (req, res, next) => {
    const internalSecret = req.headers['x-internal-secret'];
    if (isValidInternalSecret(internalSecret)) {
      const tenantId = req.headers['x-tenant-id'];
      if (!tenantId) return res.status(400).json({ error: 'Internal so\'rov uchun x-tenant-id talab qilinadi' });
      req.tenant_id = String(tenantId);
      req.user = { role: 'admin', id: 'internal-agent', tenant_id: req.tenant_id };
      return bindTenantDbContext(req.tenant_id, res, next);
    }
    authMiddleware(req, res, () => checkRole(...allowedRoles)(req, res, next));
  };
}

export const schemas = {
  login: z.object({
    username: z.string().min(3).max(100),
    // Login kuchsiz parolni oshkor qilmaydi; mavjud, noto'g'ri credential
    // bcrypt tekshiruvidan keyin bir xil 401 javobini oladi. Parol kuchi
    // registration/change oqimlarida alohida majburiy qilinadi.
    password: z.string().min(1).max(128)
  }),
  inventoryAdd: z.object({
    name: z.string().min(2).max(255),
    sku: z.string().min(2).max(50).regex(/^[A-Z0-9\-]+$/i),
    category: z.string().max(100).optional(),
    quantity: z.number().positive(),
    unit: z.string().max(20).optional(),
    cost_price: z.number().nonnegative().optional(),
    min_stock: z.number().nonnegative().optional(),
    batch_number: z.string().max(100).optional(),
    expiration_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  }),
  inventoryConsume: z.object({
    procedure_name: z.string().min(2).max(255).optional(),
    item_id: z.coerce.number().int().positive().optional(),
    requested_quantity: z.number().positive().optional(),
    doctor_id: z.string().optional(),
    performed_by: z.string().optional(),
    user_id: z.union([z.number().int(), z.string()]).optional()
  }),
  normsCreate: z.object({
    procedure_name: z.string().min(2).max(255),
    item_id: z.coerce.number().int().positive(),
    standard_quantity: z.number().positive()
  }),
  normsUpdate: z.object({
    procedure_name: z.string().min(2).max(255).optional(),
    item_id: z.coerce.number().int().positive().optional(),
    standard_quantity: z.number().positive().optional()
  }),
  receptionConfirm: z.object({
    patient_name: z.string().min(2).max(255).optional(),
    phone: z.string().max(50).optional(),
    doctor_name: z.string().max(255).optional(),
    department: z.string().max(100).optional(),
    notes: z.string().optional(),
    id: z.number().int().positive().optional(),
    status: z.enum(['waiting', 'in_progress', 'completed', 'cancelled']).optional(),
    appointment_time: z.string().max(30).optional()
  }),
  scribeTranscribe: z.object({
    doctor_id: z.string().optional()
  }),
  b2bReferral: z.object({
    sender_clinic: z.string().optional(),
    sender_doctor: z.string().optional(),
    receiver_clinic: z.string().optional(),
    patient_name: z.string().min(2).max(255),
    service: z.string().min(2).max(255),
    amount: z.number().nonnegative().optional(),
    idempotency_key: z.string().optional()
  }),
  appointmentCreate: z.object({
    patient_name: z.string().min(2).max(255),
    phone: z.string().max(50).optional(),
    doctor_name: z.string().max(255).optional(),
    department: z.string().max(100).optional(),
    notes: z.string().optional(),
    source: z.string().max(50).optional()
  }),
  doctorToggleStatus: z.object({
    doctor_id: z.string().uuid()
  }),
  doctorUpdateBonusPercent: z.object({
    doctor_id: z.string().uuid(),
    referrer_bonus_percent: z.number().min(0).max(100)
  }),
  doctorTopupBalance: z.object({
    doctor_id: z.string().uuid(),
    amount: z.number().positive()
  }),
  campaignSettings: z.object({
    campaign_mode: z.enum(['off', 'always', 'scheduled'])
  }),
  aiExecute: z.object({
    agent: z.string().min(1).max(100),
    input: z.record(z.any()).optional()
  }),
  aiPipeline: z.object({
    steps: z.array(z.record(z.any())).min(1)
  }),
  appointmentComplete: z.object({
    appointment_id: z.string().min(1),
    duration_minutes: z.number().int().positive().optional(),
    doctor_id: z.string().uuid().optional()
  }),
  referralsRedeem: z.object({
    referral_id: z.string().min(1),
    receiver_clinic_id: z.string().optional(),
    idempotency_key: z.string().optional()
  }),
  registerDoctor: z.object({
    name: z.string().min(2).max(255),
    username: z.string().min(3).max(50).regex(/^[a-zA-Z0-9_]+$/),
    password: z.string().min(6).max(100),
    specialization: z.string().min(1).max(100)
  }),
  billingRedeem: z.object({
    patient_id: z.string().uuid(),
    booking_id: z.union([z.string(), z.number()]),
    base_cost: z.number().positive(),
    points_to_redeem: z.number().nonnegative(),
    idempotency_key: z.string().optional()
  })
};
