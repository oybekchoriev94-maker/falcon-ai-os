import { Router } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';

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

  const seedUsers = [
    { username: 'ceo',        password: process.env.SEED_CEO_PASSWORD        || 'ceo-change-me-now',        role: 'ceo',          name: 'Bosh direktor' },
    { username: 'admin',      password: process.env.SEED_ADMIN_PASSWORD      || 'admin-change-me-now',      role: 'admin',        name: 'Admin' },
    { username: 'receptionist', password: process.env.SEED_RECEPTION_PASSWORD || 'reception-change-me-now', role: 'receptionist', name: 'Reception xodimi' },
    { username: 'doctor',     password: process.env.SEED_DOCTOR_PASSWORD     || 'doctor-change-me-now',     role: 'doctor',       name: 'Shifokor' },
  ];

  async function initSeed() {
    const tenantId = process.env.TENANT_ID || 'default';
    for (const u of seedUsers) {
      const existing = await qGet("SELECT id FROM users WHERE username = $1", [u.username]);
      if (!existing) {
        const hashed = bcrypt.hashSync(u.password, 10);
        await q("INSERT INTO users (id, tenant_id, username, password, role, name) VALUES ($1, $2, $3, $4, $5, $6)",
          [uuidv4(), tenantId, u.username, hashed, u.role, u.name]);
      }
    }
    console.log('[AUTH] Users seeded — 4 roles ready');
  }
  initSeed().catch(e => console.error('[AUTH] Seed error:', e.message));

  router.post('/login', async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: 'username va password talab qilinadi' });
      const user = await qGet("SELECT * FROM users WHERE username = $1", [username]);
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
      const doctor = await qGet("SELECT * FROM doctors WHERE username = $1", [username]);
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
        await q("UPDATE doctors SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [doctor.id]);
        doctor.failed_attempts = 0;
      }
      const valid = await bcrypt.compare(password, doctor.password_hash);
      if (!valid) {
        const newAttempts = (doctor.failed_attempts || 0) + 1;
        if (newAttempts >= MAX_ATTEMPTS) {
          await q("UPDATE doctors SET failed_attempts = $1, locked_until = NOW() + INTERVAL '$2 minutes' WHERE id = $3",
            [newAttempts, LOCKOUT_MINUTES, doctor.id]);
        } else {
          await q("UPDATE doctors SET failed_attempts = $1 WHERE id = $2", [newAttempts, doctor.id]);
        }
        return res.status(401).json({ error: 'Login yoki parol noto\'g\'ri' });
      }
      await q("UPDATE doctors SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [doctor.id]);
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

  router.post('/refresh', authMiddleware, (req, res) => {
    try {
      const newToken = signToken(req.user);
      res.json({ success: true, token: newToken, message: 'Token yangilandi' });
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
