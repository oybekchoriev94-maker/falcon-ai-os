import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { bindTenantDbContext } from './request-tenant-context.js';

export const JWT_EXPIRES = '2h';

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
  }, process.env.JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token talab qilinadi' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'Token tenant kontekstiga ega emas' });
    }
    const pool = req.app?.locals?.pool || (await import('./db.js')).getPool();
    if (pool) {
      try {
        const result = await pool.query("SELECT id FROM token_blacklist WHERE jti = $1", [decoded.jti]);
        if (result.rows.length > 0) {
          return res.status(401).json({ error: 'Token bekor qilingan, qayta kirishingiz kerak' });
        }
      } catch (_) {}
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

export function verifyTelegramAuth(req, res, next) {
  const initData = req.headers['x-telegram-init-data'];
  if (!initData) return next();
  try {
    const botToken = process.env.TELEGRAM_TOKEN_PATIENT || process.env.TELEGRAM_TOKEN_REFERRAL || '';
    if (!botToken) return res.status(500).json({ success: false, error: 'BOT_TOKEN aniqlanmadi' });
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return res.status(403).json({ success: false, error: 'Hash topilmadi' });
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computedHash !== hash) {
      return res.status(403).json({ success: false, error: 'Telegram autentifikatsiyasi muvaffaqiyatsiz: hash mos kelmadi' });
    }
    const authDate = params.get('auth_date');
    if (!authDate) return res.status(403).json({ success: false, error: 'Avtorizatsiya vaqti ko\'rsatilmagan' });
    if (Math.floor(Date.now() / 1000) - parseInt(authDate, 10) > 300) {
      return res.status(403).json({ success: false, error: 'Avtorizatsiya vaqti o\'tgan, ilovani qayta yuklang' });
    }
    const userStr = params.get('user');
    if (!userStr) return res.status(403).json({ success: false, error: 'Foydalanuvchi ma\'lumoti topilmadi' });
    const tgUser = JSON.parse(userStr);
    req.telegramUser = tgUser;
    (async () => {
      try {
        const pool = (await import('./db.js')).getPool();
        const result = await pool.query(
          "SELECT id, tenant_id, telegram_id, full_name, role, is_active FROM staff_members WHERE telegram_id = $1 AND is_active = true",
          [tgUser.id]
        );
        const staff = result.rows[0];
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
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return res.status(403).json({ success: false, error: 'Hash topilmadi' });
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computedHash !== hash) {
      return res.status(403).json({ success: false, error: 'Telegram autentifikatsiyasi muvaffaqiyatsiz' });
    }
    const authDate = params.get('auth_date');
    if (!authDate || Math.floor(Date.now() / 1000) - parseInt(authDate, 10) > 86400) {
      return res.status(403).json({ success: false, error: 'Avtorizatsiya vaqti o\'tgan, ilovani qayta yuklang' });
    }
    const userStr = params.get('user');
    if (!userStr) return res.status(403).json({ success: false, error: 'Foydalanuvchi ma\'lumoti topilmadi' });
    req.telegramUser = JSON.parse(userStr);
    req.telegramStartParam = params.get('start_param') || null;
    return next();
  } catch (e) {
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
    username: z.string().min(3).max(50),
    password: z.string().min(8).max(128)
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
