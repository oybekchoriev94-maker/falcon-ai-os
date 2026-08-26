import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { q, qGet } from '../db.js';
import { authMiddleware } from '../shared.js';
import { createPayment } from '../services/payment-gateway.js';

export default function subscriptionRoutes() {
  const router = Router();

  // Tenant har doim JWT dan olinadi (header/query orqali soxtalashtirib bo'lmaydi)
  const tenantOf = (req) => req.user?.tenant_id || 'default';

  // /plans — ochiq (marketing uchun tarif ro'yxati)
  router.get('/plans', async (req, res) => {
    try {
      const plans = await q("SELECT * FROM subscription_plans WHERE active = true ORDER BY monthly_price ASC");
      res.json({ success: true, plans });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/current', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const sub = await qGet(`
        SELECT s.*, sp.name as plan_name, sp.code as plan_code,
          sp.max_doctors, sp.max_patients, sp.ai_requests_limit,
          sp.b2b_referrals_enabled, sp.inpatient_enabled,
          sp.reports_enabled, sp.api_access_enabled,
          sp.monthly_price, sp.annual_price
        FROM subscriptions s
        JOIN subscription_plans sp ON sp.id = s.plan_id
        WHERE s.tenant_id = $1
      `, [tenantId]);
      if (!sub) return res.status(404).json({ error: 'Obuna topilmadi' });
      res.json({ success: true, subscription: sub });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Tarifni faqat tenant egasi (ceo/admin) o'zgartira oladi
  router.post('/change', authMiddleware, async (req, res) => {
    try {
      if (!['ceo', 'admin', 'superadmin'].includes(req.user?.role)) {
        return res.status(403).json({ error: 'Tarifni faqat klinika ma\'muri o\'zgartira oladi' });
      }
      const tenantId = tenantOf(req);
      const { plan_id, billing_cycle } = req.body;
      if (!plan_id) return res.status(400).json({ error: 'Tarif (plan_id) talab qilinadi' });

      const plan = await qGet("SELECT * FROM subscription_plans WHERE id = $1 AND active = true", [plan_id]);
      if (!plan) return res.status(404).json({ error: 'Tarif topilmadi' });

      const cycle = billing_cycle === 'annual' ? 'annual' : 'monthly';
      const amount = Number(cycle === 'annual' ? plan.annual_price : plan.monthly_price);

      // Bepul tarif to'lovsiz darhol faollashishi mumkin. Pulli tarif esa
      // faqat provider webhook'i tasdiqlagandan keyin o'zgaradi.
      if (amount <= 0) {
        const existing = await qGet("SELECT id FROM subscriptions WHERE tenant_id = $1", [tenantId]);
        if (existing) {
          await q(
            `UPDATE subscriptions SET plan_id = $1, billing_cycle = $2, status = 'active', updated_at = NOW() WHERE tenant_id = $3`,
            [plan_id, cycle, tenantId]
          );
        } else {
          await q(
            `INSERT INTO subscriptions (id, tenant_id, plan_id, billing_cycle, status) VALUES ($1, $2, $3, $4, 'active')`,
            [uuidv4(), tenantId, plan_id, cycle]
          );
        }
        await q('UPDATE tenants SET plan = $1 WHERE id = $2', [plan.code, tenantId]);
        return res.json({ success: true, activated: true, message: `Tarif "${plan.name}" ga o'zgartirildi` });
      }

      const transactionId = uuidv4();
      const baseUrl = process.env.PUBLIC_URL || process.env.API_URL || 'http://localhost:3000';
      const payment = await createPayment({
        amount,
        description: `Falcon AI OS — ${plan.name} (${cycle})`,
        orderId: transactionId,
        returnUrl: `${baseUrl.replace(/\/+$/, '')}/dashboard?payment=${transactionId}`,
        provider: req.body.provider || 'auto',
      });

      await q(
        `INSERT INTO payment_transactions
         (id, tenant_id, amount, description, services_json, provider, type, status, payment_url, provider_transaction_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'subscription_upgrade', 'pending', $7, $8, NOW())`,
        [
          transactionId, tenantId, amount, `Subscription upgrade: ${plan.name} (${cycle})`,
          JSON.stringify({ plan_id, billing_cycle: cycle }), payment.provider || 'offline',
          payment.paymentUrl || null, payment.transactionId || null,
        ]
      );

      res.status(202).json({
        success: true,
        activated: false,
        transaction_id: transactionId,
        amount,
        payment_url: payment.paymentUrl || null,
        provider: payment.provider || 'offline',
        message: 'Tarif to\'lov tasdiqlangandan keyin faollashadi',
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/usage', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const today = new Date().toISOString().slice(0, 10);
      const usage = await qGet(`
        SELECT
          (SELECT COUNT(*) FROM doctors WHERE tenant_id = $1) as doctors_count,
          (SELECT COUNT(*) FROM patients WHERE tenant_id = $1) as patients_count,
          (SELECT COUNT(*) FROM appointments WHERE tenant_id = $1 AND date(created_at) = $2) as appointments_today,
          COALESCE((SELECT SUM(CASE WHEN metric = 'ai_requests' THEN count ELSE 0 END) FROM usage_metering WHERE tenant_id = $1 AND date = $2), 0) as ai_requests_today,
          COALESCE((SELECT SUM(amount) FROM payment_transactions WHERE tenant_id = $1 AND status = 'paid' AND date(created_at) = $2), 0) as revenue_today
      `, [tenantId, today]);
      res.json({ success: true, usage, date: today });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/invoices', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const invoices = await q(
        `SELECT * FROM invoices WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [tenantId]
      );
      res.json({ success: true, invoices });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
