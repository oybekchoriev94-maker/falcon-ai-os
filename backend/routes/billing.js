import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';
import { redeemPatientCashback } from '../services/finance-engine.js';
import { withTransaction } from '../db.js';

const IS_PROD = process.env.NODE_ENV === 'production';

export default function billingRoutes(pool, authMiddleware, validate, schemas) {
  const router = Router();

  const q = async (sql, params = []) => { const r = await pool.query(sql, params); return r.rows; };
  const qGet = async (sql, params = []) => { const r = await pool.query(sql, params); return r.rows[0] || null; };

  router.post('/redeem', authMiddleware, validate(schemas.billingRedeem), async (req, res) => {
    try {
      const { patient_id, booking_id, base_cost, points_to_redeem, idempotency_key } = req.body;

      if (idempotency_key) {
        const existing = await qGet('SELECT response FROM idempotency_keys WHERE key = $1', [idempotency_key]);
        if (existing) {
          return res.json({ ...JSON.parse(existing.response), idempotent: true });
        }
      }

      if (req.user.role !== 'admin' && req.user.patient_id !== patient_id) {
        return res.status(403).json({ error: 'Siz faqat o\'z ballaringizni yechishingiz mumkin' });
      }

      const cost = parseFloat(base_cost);
      const redeemPoints = parseFloat(points_to_redeem);
      const PLATFORM_FEE_PERCENT = 3.0;

      const result = await withTransaction(async (client) => {
        const tq = async (sql, params = []) => { const r = await client.query(sql, params); return r.rows; };
        const tqGet = async (sql, params = []) => { const r = await client.query(sql, params); return r.rows[0] || null; };

        const patient = await tqGet(
          'SELECT id, first_name, last_name, cashback_balance FROM patients WHERE id = $1',
          [patient_id]
        );
        if (!patient) throw new Error('Bemor topilmadi');

        const currentBalance = parseFloat(patient.cashback_balance) || 0;

        if (redeemPoints > currentBalance) {
          throw new Error(
            `Yetarli ball mavjud emas. Joriy balans: ${currentBalance.toLocaleString('uz-UZ')} so'm, so'ralgan: ${redeemPoints.toLocaleString('uz-UZ')} so'm`
          );
        }

        const platformFeeAmount = Math.round(cost * (PLATFORM_FEE_PERCENT / 100) * 100) / 100;
        const netCashPaid = Math.round((cost - redeemPoints) * 100) / 100;
        const invoiceId = uuidv4();

        const ok = await redeemPatientCashback(tq, patient_id, redeemPoints);
        if (!ok) {
          throw new Error('Ballarni yechishda xatolik. Balans o\'zgargan bo\'lishi mumkin.');
        }

        await tq(
          `INSERT INTO invoices (id, booking_id, patient_id, patient_name, base_cost, loyalty_points_redeemed, net_cash_paid, platform_fee_percent, platform_fee_amount, status, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'paid', NOW())`,
          [
            invoiceId, booking_id, patient_id,
            (patient.first_name || '') + ' ' + (patient.last_name || ''),
            cost, redeemPoints, netCashPaid,
            PLATFORM_FEE_PERCENT, platformFeeAmount
          ]
        );

        const newBalance = currentBalance - redeemPoints;
        await tq(
          `INSERT INTO loyalty_ledger (patient_id, patient_name, booking_id, invoice_id, type, amount, balance_before, balance_after, description)
           VALUES ($1, $2, $3, $4, 'redeemed', $5, $6, $7, $8)`,
          [
            patient_id,
            (patient.first_name || '') + ' ' + (patient.last_name || ''),
            booking_id, invoiceId,
            redeemPoints, currentBalance, newBalance,
            `${redeemPoints} so'm ballar yechildi. Xizmat narxi: ${cost} so'm. To'landi: ${netCashPaid} so'm. Platforma ulushi (3%): ${platformFeeAmount} so'm`
          ]
        );

        return {
          invoice_id: invoiceId, patient_id,
          patient_name: (patient.first_name || '') + ' ' + (patient.last_name || ''),
          base_cost: cost, loyalty_points_redeemed: redeemPoints,
          net_cash_paid: netCashPaid,
          platform_fee_percent: PLATFORM_FEE_PERCENT,
          platform_fee_amount: platformFeeAmount,
          balance_before: currentBalance,
          balance_after: newBalance
        };
      });

      if (idempotency_key) {
        await q(
          "INSERT INTO idempotency_keys (key, response, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO NOTHING",
          [idempotency_key, JSON.stringify(result)]
        );
      }

      res.json({ success: true, message: 'Ballar muvaffaqiyatli yechildi', data: result });
    } catch (e) {
      safeError(res, e);
    }
  });

  router.get('/loyalty-ledger/:patient_id', authMiddleware, async (req, res) => {
    try {
      if (req.user.role !== 'admin' && req.user.patient_id !== req.params.patient_id) {
        return res.status(403).json({ error: 'Siz faqat o\'z ballar tarixingizni ko\'rishingiz mumkin' });
      }
      const entries = await q(
        'SELECT * FROM loyalty_ledger WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 100',
        [req.params.patient_id]
      );
      res.json({ success: true, entries });
    } catch (e) {
      safeError(res, e);
    }
  });

  router.get('/invoices/:patient_id', authMiddleware, async (req, res) => {
    try {
      if (req.user.role !== 'admin' && req.user.patient_id !== req.params.patient_id) {
        return res.status(403).json({ error: 'Siz faqat o\'z hisob-fakturalaringizni ko\'rishingiz mumkin' });
      }
      const invoices = await q(
        'SELECT * FROM invoices WHERE patient_id = $1 ORDER BY created_at DESC LIMIT 50',
        [req.params.patient_id]
      );
      res.json({ success: true, invoices });
    } catch (e) {
      safeError(res, e);
    }
  });

  return router;
}
