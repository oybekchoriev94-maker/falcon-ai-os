import { Router } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';
import { unsafeQuery } from '../db.js';
import { runWithTenantDbContext } from '../request-tenant-context.js';

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

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'username va password talab qilinadi' });
      const user = await unsafeQuery.qGet("SELECT * FROM users WHERE username = $1", [username]);
      if (!user) return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
      const token = signToken(user);
      res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role, name: user.name } });
    } catch (e) { safeError(res, e); }
  });

  router.post('/doctor-login', async (req, res) => {
    try {
      const { username, password } = req.body;
      const doctor = await unsafeQuery.qGet("SELECT * FROM doctors WHERE username = $1", [username]);
      if (!doctor) return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
      if (!doctor.password_hash) return res.status(401).json({ error: 'Doctor paroli sozlanmagan' });
      const MAX_ATTEMPTS = 5;
      const LOCKOUT_MINUTES = 15;
      if (doctor.failed_attempts >= MAX_ATTEMPTS && doctor.locked_until) {
        const lockTime = new Date(doctor.locked_until).getTime();
        if (Date.now() < lockTime) {
          const remaining = Math.ceil((lockTime - Date.now()) / 60000);
          return res.status(429).json({ error: `Shifokor hisobi vaqtincha bloklangan. ${remaining} daqiqadan keyin qayta urinib ko'ring.` });
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
        return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
      }
      await unsafeQuery.q("UPDATE doctors SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [doctor.id]);
      const token = signToken(doctor);
      res.json({
        success: true, token,
        user: {
          id: doctor.id, username: doctor.username,
          name: `${doctor.first_name} ${doctor.last_name}`,
          role: 'doctor', specialization: doctor.specialization,
          specialty: doctor.specialty
        }
      });
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
        decoded = jwt.verify(oldToken, process.env.JWT_SECRET, { ignoreExpiration: true });
      } catch (e) {
        return res.status(401).json({ success: false, error: 'Token yaroqsiz' });
      }
      const blacklisted = await qGet("SELECT id FROM token_blacklist WHERE jti = $1", [decoded.jti]);
      if (blacklisted) return res.status(401).json({ success: false, error: 'Token bekor qilingan' });
      const newToken = signToken(decoded);
      const freshUser = await unsafeQuery.qGet(
        "SELECT id, username, role, name FROM users WHERE id = $1 AND tenant_id = $2",
        [decoded.id, decoded.tenant_id]
      );
      res.json({ success: true, token: newToken, user: freshUser || null, message: 'Token yangilandi' });
    } catch (e) { safeError(res, e); }
  });

  router.post('/logout', authMiddleware, async (req, res) => {
    try {
      await q("INSERT INTO token_blacklist (jti, expires_at) VALUES ($1, NOW() + INTERVAL '24 hours') ON CONFLICT (jti) DO NOTHING",
        [req.user.jti]);
      res.json({ success: true, message: 'Chiqish bajarildi' });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
