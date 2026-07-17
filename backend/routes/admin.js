import { Router } from 'express';
import { q, qGet } from '../db.js';

function requireSuperAdmin(req, res, next) {
  const role = req.user?.role || req.role;
  if (role !== 'superadmin') return res.status(403).json({ error: 'Faqat super-admin uchun' });
  next();
}

export default function adminRoutes() {
  const router = Router();

  router.get('/tenants', async (req, res) => {
    try {
      const tenants = await q(`
        SELECT t.id, t.code, t.name, t.short_name, t.type, t.region, t.city,
          t.status, t.plan, t.trial_ends_at, t.created_at, t.email,
          t.verified,
          (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as users_count,
          (SELECT COUNT(*) FROM patients WHERE tenant_id = t.id) as patients_count,
          (SELECT COALESCE(SUM(amount), 0) FROM payment_transactions WHERE tenant_id = t.id AND status = 'paid') as total_revenue
        FROM tenants t
        ORDER BY t.created_at DESC
      `);
      res.json({ success: true, tenants, total: tenants.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/tenants/:id', async (req, res) => {
    try {
      const tenant = await qGet(`
        SELECT t.*,
          (SELECT json_agg(json_build_object('id', u.id, 'username', u.username, 'role', u.role, 'name', u.name, 'created_at', u.created_at)) FROM users u WHERE u.tenant_id = t.id) as users,
          (SELECT json_agg(json_build_object('key', cs.key, 'value', cs.value)) FROM clinic_settings cs WHERE cs.tenant_id = t.id) as settings
        FROM tenants t WHERE t.id = $1
      `, [req.params.id]);
      if (!tenant) return res.status(404).json({ error: 'Tenant topilmadi' });
      const sub = await qGet("SELECT * FROM subscriptions WHERE tenant_id = $1", [req.params.id]);
      res.json({ success: true, tenant, subscription: sub });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch('/tenants/:id', async (req, res) => {
    try {
      const allowed = ['plan', 'status', 'verified', 'short_name'];
      const updates = [];
      const values = [];
      let idx = 1;
      for (const [key, value] of Object.entries(req.body)) {
        if (allowed.includes(key)) {
          updates.push(`${key} = $${idx++}`);
          values.push(value);
        }
      }
      if (updates.length === 0) return res.status(400).json({ error: 'O\'zgartirish uchun maydon yo\'q' });
      values.push(req.params.id);
      await q(`UPDATE tenants SET ${updates.join(', ')} WHERE id = $${idx}`, values);
      res.json({ success: true, message: 'Tenant yangilandi' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/usage', async (req, res) => {
    try {
      const { getTenantUsage } = await import('../tenant-rate-limit.js');
      const tenants = await q("SELECT id, code, name, plan, status FROM tenants ORDER BY created_at DESC");
      const usage = tenants.map(t => ({ ...t, ...getTenantUsage(t.id) }));
      res.json({ success: true, usage });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/subscriptions', async (req, res) => {
    try {
      const subs = await q(`
        SELECT s.*, t.name as tenant_name, t.code as tenant_code, t.email,
          sp.name as plan_name, sp.code as plan_code, sp.monthly_price
        FROM subscriptions s
        JOIN tenants t ON t.id = s.tenant_id
        JOIN subscription_plans sp ON sp.id = s.plan_id
        ORDER BY s.created_at DESC
      `);
      res.json({ success: true, subscriptions: subs, total: subs.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/transactions', async (req, res) => {
    try {
      const txns = await q(`
        SELECT pt.*, t.name as tenant_name, t.code as tenant_code
        FROM payment_transactions pt
        JOIN tenants t ON t.id = pt.tenant_id
        WHERE pt.type = 'subscription'
        ORDER BY pt.created_at DESC LIMIT 50
      `);
      res.json({ success: true, transactions: txns });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/stats', async (req, res) => {
    try {
      const [totalTenants, activeTenants, totalRevenue, totalPatients, planDist] = await Promise.all([
        qGet("SELECT COUNT(*) as c FROM tenants"),
        qGet("SELECT COUNT(*) as c FROM tenants WHERE status = 'active'"),
        qGet("SELECT COALESCE(SUM(amount), 0) as s FROM payment_transactions WHERE status = 'paid' AND type = 'subscription'"),
        qGet("SELECT COUNT(*) as c FROM patients"),
        q("SELECT plan, COUNT(*) as count FROM tenants GROUP BY plan"),
      ]);
      res.json({
        success: true,
        stats: {
          total_tenants: Number(totalTenants.c),
          active_tenants: Number(activeTenants.c),
          total_revenue: Number(totalRevenue.s),
          total_patients: Number(totalPatients.c),
          plan_distribution: planDist.reduce((acc, r) => ({ ...acc, [r.plan]: Number(r.count) }), {}),
        }
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/backups', async (req, res) => {
    try {
      const { listBackups } = await import('../services/backup.js');
      const result = listBackups();
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/backup', async (req, res) => {
    try {
      const { createBackup } = await import('../services/backup.js');
      const result = await createBackup();
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.post('/backup/restore', async (req, res) => {
    try {
      const { restoreBackup } = await import('../services/backup.js');
      const result = await restoreBackup(req.body.filename);
      res.json(result);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.patch('/users/:id/reset-password', async (req, res) => {
    try {
      const { newPassword } = req.body;
      if (!newPassword || newPassword.length < 4) {
        return res.status(400).json({ error: 'Yangi parol kamida 4 belgi bo\'lishi kerak' });
      }
      const bcrypt = await import('bcrypt');
      const hashed = bcrypt.hashSync(newPassword, 10);
      await q("UPDATE users SET password = $1 WHERE id = $2", [hashed, req.params.id]);
      res.json({ success: true, message: 'Parol tiklandi' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}
