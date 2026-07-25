import { Router } from 'express';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { q, qGet } from '../db.js';
import { signToken, authMiddleware, checkRole } from '../shared.js';
import { afterRegistration } from '../services/onboarding.js';

const TRIAL_DAYS = 14;

export default function tenantRoutes() {
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
