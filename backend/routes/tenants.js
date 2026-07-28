import { Router } from 'express';
import bcrypt from 'bcrypt';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';
import { q, qGet } from '../db.js';
import { signToken, authMiddleware, checkRole } from '../shared.js';
import { afterRegistration } from '../services/onboarding.js';

const TRIAL_DAYS = 14;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'logos');
// Faqat rasm; svg ataylab yo'q — ichida skript bo'lishi mumkin (XSS)
const LOGO_TYPES = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
};
const LOGO_MAX = 2 * 1024 * 1024; // 2 MB

export default function tenantRoutes(upload) {
  const router = Router();

  router.post('/register', async (req, res) => {
    try {
      const { name, email, phone, password, clinic_name, region, city } = req.body;
      if (!name || !email || !password) {
        return res.status(400).json({ error: 'name, email va password talab qilinadi' });
      }
      if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
        return res.status(400).json({ error: 'Parol kamida 8 belgi, katta/kichik harf va raqamdan iborat bo\'lishi kerak' });
      }

      const existing = await qGet("SELECT id FROM tenants WHERE email = $1", [email]);
      if (existing) return res.status(409).json({ error: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
      const existingUser = await qGet("SELECT id FROM users WHERE username = $1", [email]);
      if (existingUser) return res.status(409).json({ error: 'Bu email allaqachon ro\'yxatdan o\'tgan' });

      const tenantId = uuidv4();
      const prefix = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
      const code = prefix + '-' + Date.now().toString(36);
      const trialEnd = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();

      await q(
        `INSERT INTO tenants (id, code, name, short_name, type, region, city, status, verified, plan, trial_ends_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', false, 'free', $8)`,
        [tenantId, code, clinic_name || name, name, 'private', region || '', city || '', trialEnd]
      );

      const subId = uuidv4();
      await q(
        `INSERT INTO subscriptions (id, tenant_id, plan_id, billing_cycle, status, trial_ends_at, current_period_start, current_period_end)
         VALUES ($1, $2, 'plan_free', 'monthly', 'trialing', $3, NOW(), $3)`,
        [subId, tenantId, trialEnd]
      );

      const userId = uuidv4();
      const hashedPwd = await bcrypt.hash(password, 10);
      await q(
        `INSERT INTO users (id, tenant_id, username, password, role, name)
         VALUES ($1, $2, $3, $4, 'ceo', $5)`,
        [userId, tenantId, email, hashedPwd, name]
      );

      const token = signToken({ id: userId, username: email, role: 'ceo', name, tenant_id: tenantId });

      afterRegistration(tenantId, userId, clinic_name || name).catch(e =>
        console.warn('[ONBOARDING] Xatolik:', e.message)
      );
      import('../services/email.js').then(({ sendWelcomeEmail }) =>
        sendWelcomeEmail(email, clinic_name || name, TRIAL_DAYS)
      ).catch(e => console.warn('[EMAIL] Welcome xatolik:', e.message));

      res.status(201).json({
        success: true,
        message: `Klinika muvaffaqiyatli ro'yxatdan o'tdi. ${TRIAL_DAYS} kunlik bepul sinov muddati boshlandi.`,
        tenant: { id: tenantId, code, name: clinic_name || name },
        user: { id: userId, email, role: 'ceo', name },
        token,
        trial_days: TRIAL_DAYS,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /me — klinika kartasi: nomi, kod (Telegram havolasi uchun), tarif,
  // sinov muddati va sozlash checklist'i (onboarding sehrgari shundan foydalanadi).
  router.get('/me', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const t = await qGet(
        `SELECT t.id, t.code, t.name, t.phone, t.address, t.city, t.trial_ends_at,
                COALESCE(sp.code, 'free') AS plan_code, COALESCE(sp.name, 'Bepul') AS plan_name,
                s.status AS sub_status
         FROM tenants t
         LEFT JOIN subscriptions s ON s.tenant_id = t.id AND s.status IN ('active','trialing')
         LEFT JOIN subscription_plans sp ON sp.id = s.plan_id
         WHERE t.id = $1`,
        [tenantId]
      );
      if (!t) return res.status(404).json({ success: false, error: 'Klinika topilmadi' });

      // Haqiqiy sozlash bosqichlari — bularsiz bron ishlamaydi
      const logoRow = await qGet("SELECT value FROM clinic_settings WHERE tenant_id = $1 AND key = 'logo_url'", [tenantId]);

      const c = await qGet(
        `SELECT
           (SELECT COUNT(*) FROM doctors WHERE tenant_id = $1)::int AS doctors,
           (SELECT COUNT(DISTINCT doctor_id) FROM doctor_schedules WHERE tenant_id = $1)::int AS scheduled_doctors,
           (SELECT COUNT(*) FROM services_catalog WHERE tenant_id = $1 AND active = TRUE)::int AS services,
           (SELECT COUNT(*) FROM users WHERE tenant_id = $1)::int AS users,
           (SELECT COUNT(*) FROM appointments WHERE tenant_id = $1)::int AS appointments`,
        [tenantId]
      );

      const steps = [
        { key: 'doctor',   label: 'Shifokor qo\'shish',        done: c.doctors > 0,            count: c.doctors },
        { key: 'schedule', label: 'Ish jadvalini belgilash',   done: c.scheduled_doctors > 0,  count: c.scheduled_doctors },
        { key: 'service',  label: 'Xizmat va narx qo\'shish',  done: c.services > 0,           count: c.services },
        { key: 'staff',    label: 'Xodimlarni taklif qilish',  done: c.users > 1,              count: c.users },
      ];
      // Bron qabul qilish uchun birinchi uchtasi yetarli (xodim ixtiyoriy)
      const ready = steps.slice(0, 3).every((s) => s.done);

      let daysLeft = null;
      if (t.trial_ends_at) {
        daysLeft = Math.max(0, Math.ceil((new Date(t.trial_ends_at) - Date.now()) / 86400000));
      }

      res.json({
        success: true,
        tenant: {
          id: t.id, code: t.code, name: t.name, phone: t.phone,
          address: t.address, city: t.city, logo_url: logoRow?.value || null,
        },
        subscription: {
          plan_code: t.plan_code, plan_name: t.plan_name,
          status: t.sub_status || 'none',
          trial_ends_at: t.trial_ends_at, trial_days_left: daysLeft,
        },
        onboarding: { ready, steps, appointments: c.appointments },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /logo — klinika logotipini yuklash (rahbar/admin)
  router.post('/logo', authMiddleware, checkRole('ceo', 'admin', 'superadmin'),
    upload.single('logo'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      if (!tenantId) return res.status(400).json({ success: false, error: 'Tenant aniqlanmadi' });
      if (!req.file) return res.status(400).json({ success: false, error: 'Rasm tanlanmagan' });

      const ext = LOGO_TYPES[req.file.mimetype];
      if (!ext) {
        return res.status(400).json({ success: false, error: 'Faqat PNG, JPG yoki WEBP rasm qabul qilinadi' });
      }
      if (req.file.size > LOGO_MAX) {
        return res.status(413).json({ success: false, error: 'Rasm 2 MB dan katta bo\'lmasin' });
      }

      await fs.mkdir(LOGO_DIR, { recursive: true });
      // Fayl nomi tenant id dan — bemor/klinika nomi URL ga chiqmaydi.
      // Versiya qo'shamiz: brauzer eski logoni keshdan ko'rsatmasin.
      const version = Date.now().toString(36);
      const fileName = `${tenantId}-${version}${ext}`;

      // Eski logolarni tozalaymiz (bir tenantda bittasi yetarli)
      try {
        const old = await fs.readdir(LOGO_DIR);
        await Promise.all(old.filter((f) => f.startsWith(tenantId + '-'))
          .map((f) => fs.unlink(path.join(LOGO_DIR, f)).catch(() => {})));
      } catch { /* papka endi yaratildi */ }

      await fs.writeFile(path.join(LOGO_DIR, fileName), req.file.buffer);
      const url = `/uploads/logos/${fileName}`;

      await q(
        `INSERT INTO clinic_settings (tenant_id, key, value, updated_at)
         VALUES ($1, 'logo_url', $2, NOW())
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [tenantId, url]
      );
      res.json({ success: true, logo_url: url });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // DELETE /logo — logotipni olib tashlash
  router.delete('/logo', authMiddleware, checkRole('ceo', 'admin', 'superadmin'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const row = await qGet("SELECT value FROM clinic_settings WHERE tenant_id = $1 AND key = 'logo_url'", [tenantId]);
      if (row?.value) {
        const f = path.join(LOGO_DIR, path.basename(row.value));
        await fs.unlink(f).catch(() => {});
      }
      await q("DELETE FROM clinic_settings WHERE tenant_id = $1 AND key = 'logo_url'", [tenantId]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get('/stats', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const stats = await qGet(`
        SELECT
          (SELECT COUNT(*) FROM doctors WHERE tenant_id = $1) as doctors_count,
          (SELECT COUNT(*) FROM patients WHERE tenant_id = $1) as patients_count,
          (SELECT COUNT(*) FROM appointments WHERE tenant_id = $1) as appointments_count,
          (SELECT COUNT(*) FROM referrals WHERE tenant_id = $1) as referrals_count,
          (SELECT COALESCE(SUM(amount), 0) FROM payment_transactions WHERE tenant_id = $1 AND status = 'paid') as total_revenue
      `, [tenantId]);
      res.json({ success: true, stats });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/settings', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const tenant = await qGet("SELECT id, code, name, short_name, type, region, city, address, phone, status, plan, created_at FROM tenants WHERE id = $1", [tenantId]);
      const settings = await q("SELECT key, value FROM clinic_settings WHERE tenant_id = $1", [tenantId]);
      const settingsMap = {};
      for (const s of settings) settingsMap[s.key] = s.value;
      res.json({ success: true, tenant, settings: settingsMap });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/settings', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const allowed = ['patient_referral_percent', 'patient_campaign_mode', 'timezone', 'language', 'currency'];
      for (const [key, value] of Object.entries(req.body)) {
        if (allowed.includes(key)) {
          await q(
            `INSERT INTO clinic_settings (tenant_id, key, value, updated_at) VALUES ($1, $2, $3, NOW())
             ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
            [tenantId, key, String(value)]
          );
        }
      }
      res.json({ success: true, message: 'Sozlamalar saqlandi' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/users', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const users = await q(
        "SELECT id, username, role, name, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at DESC",
        [tenantId]
      );
      res.json({ success: true, users });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  const INVITABLE_ROLES = ['admin', 'receptionist', 'doctor'];
  router.post('/users/invite', authMiddleware, checkRole('ceo', 'admin', 'superadmin'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const { email, role, name } = req.body;
      if (!email || !role || !name) return res.status(400).json({ error: 'email, role va name talab qilinadi' });
      if (!INVITABLE_ROLES.includes(role)) {
        return res.status(400).json({ error: `Ruxsat etilgan rollar: ${INVITABLE_ROLES.join(', ')}` });
      }
      const existingUser = await qGet("SELECT id FROM users WHERE username = $1", [email]);
      if (existingUser) return res.status(409).json({ error: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
      const hashedPwd = await bcrypt.hash(uuidv4().slice(0, 12), 10);
      const userId = uuidv4();
      await q(
        "INSERT INTO users (id, tenant_id, username, password, role, name) VALUES ($1, $2, $3, $4, $5, $6)",
        [userId, tenantId, email, hashedPwd, role, name]
      );
      res.json({ success: true, message: `${name} (${email}) tizimga qo'shildi`, user_id: userId });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/onboarding-status', authMiddleware, async (req, res) => {
    try {
      const { checkOnboardingStatus } = await import('../services/onboarding.js');
      const status = await checkOnboardingStatus(req.user?.tenant_id || req.tenant_id || 'default');
      res.json({ success: true, ...status });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
