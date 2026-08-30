import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';
import { unsafeQuery } from '../db.js';
import { runWithTenantDbContext } from '../request-tenant-context.js';
import { JWT_VERIFY_OPTIONS } from '../shared.js';

const DEFAULT_REFRESH_WINDOW_DAYS = 7;

export function refreshWindowSeconds(env = process.env) {
  const configuredDays = Number(env.JWT_REFRESH_WINDOW_DAYS || DEFAULT_REFRESH_WINDOW_DAYS);
  if (!Number.isInteger(configuredDays) || configuredDays < 1 || configuredDays > 30) {
    throw new Error('JWT_REFRESH_WINDOW_DAYS 1 dan 30 gacha butun son bo\'lishi kerak');
  }
  return configuredDays * 24 * 60 * 60;
}

export function validateRefreshClaims(decoded, nowSeconds = Math.floor(Date.now() / 1000), windowSeconds = refreshWindowSeconds()) {
  if (!decoded?.jti || !decoded?.id || !decoded?.tenant_id || !Number.isInteger(decoded?.iat)) {
    throw new Error('Token majburiy session ma\'lumotlariga ega emas');
  }
  if (decoded.iat > nowSeconds + 60 || nowSeconds - decoded.iat > windowSeconds) {
    throw new Error('Tokenni yangilash muddati tugagan');
  }
  return decoded.iat + windowSeconds;
}

const seedUsers = [
  { username: 'ceo',          passwordEnv: 'SEED_CEO_PASSWORD',       role: 'ceo',          name: 'Bosh direktor' },
  { username: 'admin',        passwordEnv: 'SEED_ADMIN_PASSWORD',     role: 'admin',        name: 'Admin' },
  { username: 'receptionist', passwordEnv: 'SEED_RECEPTION_PASSWORD', role: 'receptionist', name: 'Reception xodimi' },
  { username: 'doctor',       passwordEnv: 'SEED_DOCTOR_PASSWORD',    role: 'doctor',       name: 'Shifokor' },
];

/**
 * Seed foydalanuvchilarini route yaratilishidan alohida ishga tushiramiz.
 * Bu server startup va integration testlarida seed tugashini kutish imkonini
 * beradi; avvalgi fire-and-forget chaqiruv login bilan poyga hosil qilardi.
 */
export async function seedDefaultUsers(pool) {
  const tenantId = process.env.TENANT_ID || 'default';
  const missingPasswordVars = seedUsers
    .map(({ passwordEnv }) => passwordEnv)
    .filter((passwordEnv) => !process.env[passwordEnv]);
  if (missingPasswordVars.length) {
    throw new Error(`Seed foydalanuvchilari uchun parollar sozlanmagan: ${missingPasswordVars.join(', ')}`);
  }

  await runWithTenantDbContext(tenantId, async () => {
    for (const user of seedUsers) {
      const existing = await pool.query(
        'SELECT id FROM users WHERE username = $1 AND tenant_id = $2',
        [user.username, tenantId]
      );
      if (existing.rows[0]) continue;

      const password = process.env[user.passwordEnv];
      const hashed = await bcrypt.hash(password, 10);
      await pool.query(
        `INSERT INTO users (id, tenant_id, username, password, role, name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (username) DO NOTHING`,
        [uuidv4(), tenantId, user.username, hashed, user.role, user.name]
      );
    }
  });
}

export default function(pool, authMiddleware, checkRole, validate, schemas, telegramOrJwtAuth, signToken) {
  const router = Router();

  async function q(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
  }
  async function qGet(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
  }
  async function qExec(sql, params = []) {
    return pool.query(sql, params);
  }

  /**
   * `doctors` jadvali bo'yicha kirishga urinish.
   *
   * NEGA KERAK: shifokorlar `users` da EMAS, `doctors` jadvalida saqlanadi
   * (username + password_hash o'sha yerda). Login sahifasi faqat /login ni
   * chaqiradi, shuning uchun /login avval `users`ni, keyin shu yordamchi
   * orqali `doctors`ni tekshiradi.
   *
   * unsafeQuery: login paytida hali sessiya yo'q — RLS tenant konteksti
   * o'rnatilmagan, shuning uchun tenant-chegarali oddiy so'rov ishlamaydi.
   * Tenant holati (t.status) va shifokor holati (d.status) shu yerda aniq
   * tekshiriladi.
   *
   * @returns {null} shunday username umuman yo'q — chaqiruvchi o'zi hal qiladi
   * @returns {{status:number, body:object}} javob (muvaffaqiyat yoki xato)
   */
  async function tryDoctorLogin(username, password) {
    const doctor = await unsafeQuery.qGet(
      `SELECT d.*, t.status AS tenant_status
       FROM doctors d JOIN tenants t ON t.id = d.tenant_id
       WHERE d.username = $1`,
      [username]
    );
    if (!doctor) return null;
    // Umumiy xabar beramiz — qaysi loginlar mavjudligini oshkor qilmaslik uchun.
    if (doctor.status !== 'Faol' || doctor.tenant_status !== 'active' || !doctor.password_hash) {
      return { status: 401, body: { error: 'Login yoki parol noto\'g\'ri' } };
    }

    const MAX_ATTEMPTS = 5;
    const LOCKOUT_MINUTES = 15;
    if (doctor.failed_attempts >= MAX_ATTEMPTS && doctor.locked_until) {
      const lockTime = new Date(doctor.locked_until).getTime();
      if (Date.now() < lockTime) {
        const remaining = Math.ceil((lockTime - Date.now()) / 60000);
        return { status: 429, body: { error: `Hisob vaqtincha bloklangan. ${remaining} daqiqadan keyin urinib ko'ring.` } };
      }
      await unsafeQuery.q("UPDATE doctors SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [doctor.id]);
      doctor.failed_attempts = 0;
    }

    const valid = await bcrypt.compare(password, doctor.password_hash);
    if (!valid) {
      const newAttempts = (doctor.failed_attempts || 0) + 1;
      if (newAttempts >= MAX_ATTEMPTS) {
        await unsafeQuery.q("UPDATE doctors SET failed_attempts = $1, locked_until = NOW() + make_interval(mins => $2) WHERE id = $3",
          [newAttempts, LOCKOUT_MINUTES, doctor.id]);
      } else {
        await unsafeQuery.q("UPDATE doctors SET failed_attempts = $1 WHERE id = $2", [newAttempts, doctor.id]);
      }
      return { status: 401, body: { error: 'Login yoki parol noto\'g\'ri' } };
    }

    await unsafeQuery.q("UPDATE doctors SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [doctor.id]);
    return {
      status: 200,
      body: {
        success: true,
        token: signToken(doctor),
        user: {
          id: doctor.id, username: doctor.username,
          name: `${doctor.first_name} ${doctor.last_name || ''}`.trim(),
          role: 'doctor', specialization: doctor.specialization,
          specialty: doctor.specialty,
        },
      },
    };
  }

  /**
   * Yagona kirish nuqtasi: avval `users`, topilmasa `doctors`.
   *
   * NEGA IKKALASI: shifokorlar `users` da EMAS, `doctors` jadvalida
   * saqlanadi (username + password_hash o'sha yerda). Ilgari bu endpoint
   * faqat `users` ni tekshirardi, `doctors` uchun esa alohida
   * /doctor-login bor edi — lekin login sahifasi FAQAT shu endpointni
   * chaqiradi. Natijada HECH BIR SHIFOKOR tizimga kira olmasdi:
   * parol to'g'ri bo'lsa ham "Login yoki parol noto'g'ri" chiqardi.
   * Shifokorlar uchun alohida login sahifasi ham yo'q edi.
   */
  router.post('/login', validate(schemas.login), async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'username va password talab qilinadi' });

      const user = await unsafeQuery.qGet(
        `SELECT u.*, t.status AS tenant_status
         FROM users u JOIN tenants t ON t.id = u.tenant_id
         WHERE u.username = $1`,
        [username]
      );
      if (user) {
        if (user.tenant_status !== 'active') return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });

        // HISOB BLOKLASH — shifokorlarникi bilan bir xil qoida.
        // Ilgari bu FAQAT `doctors` uchun bor edi, ya'ni eng ko'p
        // huquqli hisoblar (ceo, admin) cheksiz parol tanlashga ochiq
        // edi. HTTP cheklovi (authLimiter) xotirada saqlanadi va
        // konteyner qayta ishga tushganda nolga tushadi; bazadagi
        // hisoblagich esa deploydan keyin ham qoladi.
        const MAX_ATTEMPTS = 5;
        const LOCKOUT_MINUTES = 15;
        if (user.failed_attempts >= MAX_ATTEMPTS && user.locked_until) {
          const lockTime = new Date(user.locked_until).getTime();
          if (Date.now() < lockTime) {
            const remaining = Math.ceil((lockTime - Date.now()) / 60000);
            return res.status(429).json({ error: `Hisob vaqtincha bloklangan. ${remaining} daqiqadan keyin urinib ko'ring.` });
          }
          await unsafeQuery.q('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
          user.failed_attempts = 0;
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
          const attempts = (user.failed_attempts || 0) + 1;
          if (attempts >= MAX_ATTEMPTS) {
            await unsafeQuery.q(
              'UPDATE users SET failed_attempts = $1, locked_until = NOW() + make_interval(mins => $2) WHERE id = $3',
              [attempts, LOCKOUT_MINUTES, user.id]);
          } else {
            await unsafeQuery.q('UPDATE users SET failed_attempts = $1 WHERE id = $2', [attempts, user.id]);
          }
          return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
        }

        await unsafeQuery.q('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
        const token = signToken(user);
        return res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
      }

      const asDoctor = await tryDoctorLogin(username, password);
      if (asDoctor) return res.status(asDoctor.status).json(asDoctor.body);

      res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
    } catch (e) { safeError(res, e); }
  });

  // Eski endpoint — orqaga moslik uchun saqlanadi (public/dashboard.html
  // va tashqi integratsiyalar shuni chaqirishi mumkin). Mantiq bir xil.
  router.post('/doctor-login', validate(schemas.login), async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'username va password talab qilinadi' });
      const r = await tryDoctorLogin(username, password);
      if (!r) return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
      res.status(r.status).json(r.body);
    } catch (e) { safeError(res, e); }
  });

  router.get('/me', telegramOrJwtAuth(), (req, res) => {
    res.json({ success: true, user: req.user });
  });

  router.post('/refresh', async (req, res) => {
    try {
      const bearer = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : null;
      const oldToken = req.body?.token || bearer;
      if (!oldToken) return res.status(400).json({ success: false, error: 'Token talab qilinadi' });
      let decoded;
      try {
        decoded = jwt.verify(oldToken, process.env.JWT_SECRET, {
          ...JWT_VERIFY_OPTIONS,
          ignoreExpiration: true,
        });
      } catch (e) {
        return res.status(401).json({ success: false, error: 'Token yaroqsiz' });
      }
      let refreshExpiresAt;
      try {
        refreshExpiresAt = validateRefreshClaims(decoded);
      } catch (e) {
        return res.status(401).json({ success: false, error: e.message });
      }

      let freshUser = await unsafeQuery.qGet(
        `SELECT u.id, u.tenant_id, u.username, u.role, u.name
         FROM users u JOIN tenants t ON t.id = u.tenant_id
         WHERE u.id = $1 AND u.tenant_id = $2 AND t.status = 'active'`,
        [decoded.id, decoded.tenant_id]
      );
      if (!freshUser) {
        const doctor = await unsafeQuery.qGet(
          `SELECT d.id, d.tenant_id, d.username, d.first_name, d.last_name,
                  d.specialization, d.specialty
           FROM doctors d JOIN tenants t ON t.id = d.tenant_id
           WHERE d.id = $1 AND d.tenant_id = $2
             AND d.status = 'Faol' AND t.status = 'active'`,
          [decoded.id, decoded.tenant_id]
        );
        if (doctor) {
          freshUser = {
            ...doctor,
            role: 'doctor',
            doctor_id: doctor.id,
            name: `${doctor.first_name} ${doctor.last_name || ''}`.trim(),
          };
        }
      }
      if (!freshUser) {
        return res.status(401).json({ success: false, error: 'Foydalanuvchi faol emas yoki topilmadi' });
      }

      // Refresh token rotation: faqat birinchi parallel/replay so'rov eski JTI'ni
      // atomik ravishda egallaydi. Qolganlari ON CONFLICT sabab rad etiladi.
      const claimed = await unsafeQuery.qGet(
        `INSERT INTO token_blacklist (jti, expires_at)
         VALUES ($1, to_timestamp($2))
         ON CONFLICT (jti) DO NOTHING
         RETURNING id`,
        [decoded.jti, refreshExpiresAt]
      );
      if (!claimed) return res.status(401).json({ success: false, error: 'Token allaqachon yangilangan yoki bekor qilingan' });

      const newToken = signToken(freshUser);
      res.json({
        success: true,
        token: newToken,
        user: { id: freshUser.id, username: freshUser.username, role: freshUser.role, name: freshUser.name },
        message: 'Token yangilandi',
      });
    } catch (e) { safeError(res, e); }
  });

  router.post('/logout', authMiddleware, async (req, res) => {
    try {
      const refreshExpiresAt = validateRefreshClaims(req.user);
      await q(
        `INSERT INTO token_blacklist (jti, expires_at)
         VALUES ($1, to_timestamp($2))
         ON CONFLICT (jti) DO NOTHING`,
        [req.user.jti, refreshExpiresAt]
      );
      res.json({ success: true, message: 'Chiqish bajarildi' });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
