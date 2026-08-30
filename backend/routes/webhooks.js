import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { q, qGet } from '../db.js';
import { handlePaymeWebhook, verifyPaymeAuth, verifyClickSign } from '../services/payment-gateway.js';
import { sendInvoiceEmail } from '../services/email.js';

export default function webhookRoutes() {
  const router = Router();

  router.post('/payme', async (req, res) => {
    try {
      if (!verifyPaymeAuth(req)) {
        return res.status(401).json({ error: -32504, message: 'Avtorizatsiya xatosi' });
      }
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
      if (!verifyClickSign(req.body)) {
        return res.status(401).json({ error: -1, error_note: 'SIGN CHECK FAILED' });
      }
      const { click_trans_id, service_id, merchant_trans_id, amount, status } = req.body;

      // Bizning service_id ekanini tekshiramiz. U imzoga kiradi, ya'ni
      // soxtalashtirib bo'lmaydi — lekin noto'g'ri sozlangan boshqa
      // merchant hisobidan kelgan to'lov obunani uzaytirib yubormasin.
      const expectedService = process.env.CLICK_SERVICE_ID || '';
      if (expectedService && String(service_id) !== String(expectedService)) {
        console.warn(`[CLICK] Boshqa service_id: ${service_id} (kutilgan ${expectedService})`);
        return res.status(400).json({ error: -1, error_note: 'WRONG SERVICE' });
      }

      if (status === 0) {
        // TO'LANGAN SUMMA REJA NARXIGA YETADIMI.
        //
        // Ilgari summa UMUMAN tekshirilmasdi: 1000 so'mlik to'lov ham
        // to'liq bir oylik obunani ochib berardi. Imzo to'g'ri bo'lgani
        // uchun bu "haqiqiy" to'lov hisoblanardi — ya'ni klinika
        // istalgan kichik summa bilan oyni uzaytira olardi.
        const plan = await qGet(
          `SELECT p.monthly_price
             FROM subscriptions s
             JOIN subscription_plans p ON p.id = s.plan_id
            WHERE s.tenant_id = $1`,
          [merchant_trans_id]
        );
        if (!plan) {
          console.error(`[CLICK] Obuna/reja topilmadi: tenant=${merchant_trans_id}`);
          return res.status(400).json({ error: -5, error_note: 'SUBSCRIPTION NOT FOUND' });
        }
        // Kichik farqga yo'l qo'yamiz (yaxlitlash, komissiya)
        const paid = Number(amount) || 0;
        const price = Number(plan.monthly_price) || 0;
        if (price > 0 && paid < price - 1) {
          console.error(`[CLICK] Summa yetarli emas: to'landi ${paid}, kerak ${price} (tenant=${merchant_trans_id})`);
          return res.status(400).json({ error: -2, error_note: 'INCORRECT AMOUNT' });
        }

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
