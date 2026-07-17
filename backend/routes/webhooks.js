import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { q, qGet } from '../db.js';
import { handlePaymeWebhook } from '../services/payment-gateway.js';
import { sendInvoiceEmail } from '../services/email.js';

export default function webhookRoutes() {
  const router = Router();

  router.post('/payme', async (req, res) => {
    try {
      const result = handlePaymeWebhook(req.body);
      if (result.success && result.tenant_id) {
        await q(
          `UPDATE subscriptions SET current_period_start = current_period_end,
            current_period_end = current_period_end + INTERVAL '1 month' WHERE tenant_id = $1`,
          [result.tenant_id]
        );
        await q("UPDATE tenants SET status = 'active' WHERE id = $1", [result.tenant_id]);
        await q(
          "UPDATE payment_transactions SET status = 'paid', paid_at = NOW() WHERE provider_transaction_id = $1",
          [result.transactionId]
        );
        const tenant = await qGet("SELECT name, email FROM tenants WHERE id = $1", [result.tenant_id]);
        if (tenant?.email) {
          const sub = await qGet(`
            SELECT sp.name as plan_name, sp.monthly_price FROM subscriptions s
            JOIN subscription_plans sp ON sp.id = s.plan_id WHERE s.tenant_id = $1
          `, [result.tenant_id]);
          sendInvoiceEmail(tenant.email, tenant.name, sub?.plan_name || '', sub?.monthly_price || 0, 'monthly')
            .catch(e => console.warn('[WEBHOOK] Email xatolik:', e.message));
        }
        return res.json({ success: true, message: 'Subscription renewed' });
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/click', async (req, res) => {
    try {
      const { click_trans_id, service_id, merchant_trans_id, amount, status } = req.body;
      if (status === 0) {
        await q(
          `UPDATE subscriptions SET current_period_start = current_period_end,
            current_period_end = current_period_end + INTERVAL '1 month' WHERE tenant_id = $1`,
          [merchant_trans_id]
        );
        await q("UPDATE tenants SET status = 'active' WHERE id = $1", [merchant_trans_id]);
        const txnId = uuidv4();
        await q(
          "INSERT INTO payment_transactions (id,tenant_id,amount,provider,type,status,provider_transaction_id,paid_at) VALUES ($1,$2,$3,'click','subscription','paid',$4,NOW()) ON CONFLICT DO NOTHING",
          [txnId, merchant_trans_id, amount, String(click_trans_id)]
        );
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
