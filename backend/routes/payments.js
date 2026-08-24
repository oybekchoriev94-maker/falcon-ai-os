// ============================================================
// FALCON AI OS — QR To'lov + Face Pay Routes
// QR generatsiya, to'lov yaratish, webhook, to'lov tarixi
// Klinika kartasiga to'g'ridan-to'g'ri tushadi
// ============================================================

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import QRCode from 'qrcode';
import rateLimit from 'express-rate-limit';
import { safeError } from '../services/safe-error.js';
import {
  createPayment,
  handlePaymeWebhook,
  handleClickWebhook,
  handleUzumWebhook,
  verifyPaymeAuth,
  verifyClickSign,
  verifyUzumAuth
} from '../services/payment-gateway.js';

export default function paymentRoutes(pool, authMiddleware, checkRole) {
  const router = Router();

  // ─── DB helper ──────────────────────────────────────────
  const q = async (sql, params = []) => {
    const r = await pool.query(sql, params);
    return r.rows;
  };
  const qGet = async (sql, params = []) => {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  };

  const sameAmount = (expected, received) => {
    if (received === null || received === undefined || received === '') return false;
    return Math.round(Number(expected) * 100) === Math.round(Number(received) * 100);
  };

  async function finalizePaidTransaction(txn, result, provider, rawBody) {
    if (!sameAmount(txn.amount, result.amount)) {
      await pool.query(
        `INSERT INTO payment_webhook_logs (tenant_id, provider, transaction_id, raw_json, status)
         VALUES ($1, $2, $3, $4, 'amount_mismatch')`,
        [txn.tenant_id, provider, txn.id, JSON.stringify(rawBody)]
      );
      return { applied: false, reason: 'amount_mismatch' };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE payment_transactions
         SET status = 'paid', paid_at = NOW(), provider_transaction_id = $1, raw_response = $2
         WHERE id = $3 AND tenant_id = $4 AND status = 'pending'
         RETURNING id`,
        [result.transactionId || null, JSON.stringify(result.raw || rawBody || {}), txn.id, txn.tenant_id]
      );

      // Provider callback'ni takror yuborsa moliyaviy ta'sir qayta ishlamaydi.
      if (updated.rowCount === 0) {
        await client.query('ROLLBACK');
        return { applied: false, reason: 'duplicate' };
      }

      if (txn.type === 'subscription_upgrade' || txn.type === 'subscription') {
        const metadata = typeof txn.services_json === 'string'
          ? JSON.parse(txn.services_json)
          : (txn.services_json || {});
        const cycle = metadata.billing_cycle === 'annual' ? 'annual' : 'monthly';
        const plan = await client.query(
          'SELECT id, code FROM subscription_plans WHERE id = $1 AND active = true',
          [metadata.plan_id]
        );
        if (!plan.rows[0]) throw new Error('Subscription tarifi topilmadi');

        await client.query(
          `INSERT INTO subscriptions
           (id, tenant_id, plan_id, billing_cycle, status, current_period_start, current_period_end, trial_ends_at, updated_at)
           VALUES ($1, $2, $3, $4, 'active', NOW(),
             CASE WHEN $4 = 'annual' THEN NOW() + INTERVAL '1 year' ELSE NOW() + INTERVAL '1 month' END,
             NULL, NOW())
           ON CONFLICT (tenant_id) DO UPDATE SET
             plan_id = EXCLUDED.plan_id,
             billing_cycle = EXCLUDED.billing_cycle,
             status = 'active',
             current_period_start = NOW(),
             current_period_end = EXCLUDED.current_period_end,
             trial_ends_at = NULL,
             updated_at = NOW()`,
          [uuidv4(), txn.tenant_id, plan.rows[0].id, cycle]
        );
        await client.query('UPDATE tenants SET plan = $1 WHERE id = $2', [plan.rows[0].code, txn.tenant_id]);
      } else if (txn.patient_id) {
        const cashbackPercent = 3.0;
        const cashback = Math.round(Number(txn.amount) * cashbackPercent / 100);
        if (cashback > 0) {
          const patient = await client.query(
            `UPDATE patients
             SET cashback_balance = COALESCE(cashback_balance, 0) + $1
             WHERE tenant_id = $2 AND id = $3
             RETURNING cashback_balance`,
            [cashback, txn.tenant_id, txn.patient_id]
          );
          if (patient.rows[0]) {
            const balanceAfter = Number(patient.rows[0].cashback_balance);
            await client.query(
              `INSERT INTO loyalty_ledger
               (tenant_id, patient_id, patient_name, type, amount, balance_before, balance_after, description, created_at)
               VALUES ($1, $2, $3, 'earned', $4, $5, $6, $7, NOW())`,
              [txn.tenant_id, txn.patient_id, txn.patient_name || 'Bemor', cashback,
               balanceAfter - cashback, balanceAfter,
               `Cashback ${cashbackPercent}%: ${txn.description || 'To\'lov'} #${txn.id.substring(0, 8)}`]
            );
          }
        }
      }

      await client.query(
        `INSERT INTO payment_webhook_logs (tenant_id, provider, transaction_id, raw_json, status)
         VALUES ($1, $2, $3, $4, 'paid')`,
        [txn.tenant_id, provider, txn.id, JSON.stringify(rawBody)]
      );
      await client.query('COMMIT');
      return { applied: true };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ─── Rate Limits ────────────────────────────────────────
  const payLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { error: 'Juda ko\'p to\'lov so\'rovi, 1 daqiqa kuting' },
    validate: { trustProxy: false },
  });

  const webhookLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60, // webhook'lar ko'p kelishi mumkin
    message: { error: 'Too many requests' },
    validate: { trustProxy: false },
  });

  // ============================================================
  // 1. TO'LOV YARATISH + QR KOD
  // ============================================================

  /**
   * POST /api/payments/create
   * Bemor yoki kassir to'lov yaratadi → QR kod qaytadi
   *
   * Body: {
   *   patient_id: "bemor ID",
   *   amount: 120000,
   *   description: "UZI tekshiruvi",
   *   provider: "payme|click|uzum|auto", (auto = eng arzon)
   *   services: [{ name, price }] (ixtiyoriy)
   * }
   */
  router.post('/payments/create', authMiddleware, payLimiter, async (req, res) => {
    try {
      const { patient_id, amount, description, provider, services } = req.body;
      const tenantId = req.user.tenant_id;

      // Validatsiya
      if (!amount || amount <= 0) {
        return res.status(400).json({ success: false, error: 'Summa noto\'g\'ri' });
      }

      const orderId = uuidv4();
      const totalAmount = Math.round(parseFloat(amount));

      // To'lov yozuvini saqlaymiz
      const baseUrl = process.env.TUNNEL_URL || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
      const returnUrl = `${baseUrl}/qr-pay.html?order=${orderId}`;

      await q(
        `INSERT INTO payment_transactions
         (id, tenant_id, patient_id, amount, description, services_json, provider, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW())`,
        [
          orderId, tenantId, patient_id || null,
          totalAmount, description || `To'lov #${orderId.substring(0, 8)}`,
          services ? JSON.stringify(services) : null,
          provider || 'auto'
        ]
      );

      // Javobni darhol qaytaramiz — QR kod async generatsiya
      // Foydalanuvchi QR kodni skaner qiladi → Payme/Click da to'laydi
      res.json({
        success: true,
        orderId,
        amount: totalAmount,
        description: description || `Falcon OS #${orderId.substring(0, 8)}`,
        provider: provider || 'auto',
        status: 'pending',
        // QR kod URL — frontend buni QR qilib ko'rsatadi
        qrData: `${baseUrl}/api/payments/pay/${orderId}`,
        // To'lov URL — to'g'ridan-to'g'ri Payme/Click ga o'tish
        paymentUrl: null, // createPayment async chaqiriladi
        message: '✅ To\'lov yaratildi. QR kodni skaner qiling yoki to\'lov havolasini bosing.'
      });

      // Background'da to'lov link yaratamiz (agar Payme/Click sozlangan bo'lsa)
      createPayment({
        amount: totalAmount,
        description: description || `Falcon OS #${orderId.substring(0, 8)}`,
        orderId,
        returnUrl,
        provider: provider || 'auto'
      }).then(async payment => {
        // Payment URL ni saqlaymiz
        if (payment.success && payment.paymentUrl) {
          await q('UPDATE payment_transactions SET payment_url = $1, provider = $2 WHERE id = $3 AND tenant_id = $4',
            [payment.paymentUrl, payment.provider, orderId, tenantId]);
        }
      }).catch(e => {
        console.error('[PAYMENTS] Background payment yaratish xatosi:', e.message);
      });

    } catch (e) {
      safeError(res, e);
    }
  });

  // ============================================================
  // 2. TO'LOV MA'LUMOTI (QR skanerlaganda ko'rinadi)
  // ============================================================

  /**
   * GET /api/payments/pay/:orderId
   * QR kod skaner qilinganda ochiladigan sahifa (API ma'lumot)
   * Bemor bu yerdan to'laydi
   */
  router.get('/payments/pay/:orderId', async (req, res) => {
    try {
      const txn = await qGet(
        `SELECT pt.*, p.first_name, p.last_name
         FROM payment_transactions pt
         LEFT JOIN patients p ON p.id = pt.patient_id AND p.tenant_id = pt.tenant_id
         WHERE pt.id = $1`,
        [req.params.orderId]
      );

      if (!txn) {
        return res.status(404).json({ success: false, error: 'To\'lov topilmadi' });
      }

      // Agar to'lov allaqachon bo'lgan bo'lsa
      if (txn.status === 'paid') {
        return res.json({
          success: true,
          status: 'paid',
          orderId: txn.id,
          amount: txn.amount,
          paid_at: txn.paid_at,
          patient_name: txn.first_name ? `${txn.first_name} ${txn.last_name || ''}`.trim() : null
        });
      }

      // To'lov URL (Payme/Click ga o'tish uchun)
      const payUrl = txn.payment_url;

      res.json({
        success: true,
        status: txn.status,
        orderId: txn.id,
        amount: txn.amount,
        description: txn.description,
        provider: txn.provider,
        patient_name: txn.first_name ? `${txn.first_name} ${txn.last_name || ''}`.trim() : null,
        payment_url: payUrl,
        created_at: txn.created_at
      });

    } catch (e) {
      safeError(res, e);
    }
  });

  // ============================================================
  // 3. TO'LOV STATUSINI TEKSHIRISH
  // ============================================================

  /**
   * GET /api/payments/status/:orderId
   * Bemor yoki kassir to'lov statusini tekshiradi
   */
  router.get('/payments/status/:orderId', authMiddleware, async (req, res) => {
    try {
      const txn = await qGet(
        'SELECT * FROM payment_transactions WHERE id = $1 AND tenant_id = $2',
        [req.params.orderId, req.user.tenant_id]
      );
      if (!txn) {
        return res.status(404).json({ success: false, error: 'To\'lov topilmadi' });
      }

      res.json({
        success: true,
        orderId: txn.id,
        status: txn.status,
        amount: txn.amount,
        provider: txn.provider,
        paid_at: txn.paid_at,
        created_at: txn.created_at
      });
    } catch (e) {
      safeError(res, e);
    }
  });

  // ============================================================
  // 4. PAYME WEBHOOK
  // ============================================================

  /**
   * POST /api/payments/webhook/payme
   * Payme to'lov tugaganidan keyin chaqiradi
   */
  router.post('/payments/webhook/payme', webhookLimiter, async (req, res) => {
    try {
      // Imzo tekshiruvi — soxta to'lov tasdiqlaridan himoya
      if (!verifyPaymeAuth(req)) {
        return res.status(401).json({ error: -32504, message: 'Avtorizatsiya xatosi' });
      }
      const result = handlePaymeWebhook(req.body);

      if (!result) {
        return res.status(400).json({ error: 'Invalid webhook payload' });
      }

      console.log('[WEBHOOK:PAYME]', JSON.stringify(result));

      // Transaction ni topamiz
      const txn = result.orderId
        ? await qGet('SELECT * FROM payment_transactions WHERE id = $1', [result.orderId])
        : null;

      if (!txn) {
        console.warn('[WEBHOOK:PAYME] Noma\'lum order:', result.orderId);
        return res.json({ success: true }); // Payme har doim 200 qaytarish kerak
      }

      if (result.status === 'paid') {
        const finalized = await finalizePaidTransaction(txn, result, 'payme', req.body);
        if (finalized.reason === 'amount_mismatch') {
          return res.status(400).json({ success: false, error: 'To\'lov summasi mos emas' });
        }
      }

      // Payme doimo 200 qaytarish kerak
      res.json({ success: true });

    } catch (e) {
      console.error('[WEBHOOK:PAYME] Xatolik:', e.message);
      // Payme doimo 200 qaytarish kerak — aks holda qayta yuboradi
      res.json({ success: true, error: e.message });
    }
  });

  // ============================================================
  // 5. CLICK WEBHOOK
  // ============================================================

  /**
   * POST /api/payments/webhook/click
   * Click to'lov tugaganidan keyin chaqiradi
   */
  router.post('/payments/webhook/click', webhookLimiter, async (req, res) => {
    try {
      // Imzo tekshiruvi (MD5 sign_string) — soxta to'lov tasdiqlaridan himoya
      if (!verifyClickSign(req.body)) {
        return res.status(401).json({ error: -1, error_note: 'SIGN CHECK FAILED' });
      }
      const result = handleClickWebhook(req.body);

      if (!result) {
        return res.status(400).json({ error: 'Invalid Click webhook' });
      }

      const txn = result.orderId
        ? await qGet('SELECT * FROM payment_transactions WHERE id = $1', [result.orderId])
        : null;

      if (!txn) {
        console.warn('[WEBHOOK:CLICK] Noma\'lum order:', result.orderId);
        return res.json({ success: true });
      }

      if (result.status === 'paid') {
        const finalized = await finalizePaidTransaction(txn, result, 'click', req.body);
        if (finalized.reason === 'amount_mismatch') {
          return res.status(400).json({ error: -2, error_note: 'AMOUNT MISMATCH' });
        }
      }

      res.json({ success: true });

    } catch (e) {
      console.error('[WEBHOOK:CLICK] Xatolik:', e.message);
      res.json({ success: true, error: e.message });
    }
  });

  // ============================================================
  // 6. UZUM WEBHOOK
  // ============================================================

  router.post('/payments/webhook/uzum', webhookLimiter, async (req, res) => {
    try {
      if (!verifyUzumAuth(req)) {
        return res.status(401).json({ success: false, error: 'SIGN CHECK FAILED' });
      }
      const result = handleUzumWebhook(req.body);
      if (!result) return res.json({ success: true });

      const txn = result.orderId
        ? await qGet('SELECT * FROM payment_transactions WHERE id = $1', [result.orderId])
        : null;

      if (!txn) {
        console.warn('[WEBHOOK:UZUM] Noma\'lum order:', result.orderId);
        return res.json({ success: true });
      }

      if (result.status === 'paid') {
        const finalized = await finalizePaidTransaction(txn, result, 'uzum', req.body);
        if (finalized.reason === 'amount_mismatch') {
          return res.status(400).json({ success: false, error: 'AMOUNT MISMATCH' });
        }
      }

      res.json({ success: true });

    } catch (e) {
      console.error('[WEBHOOK:UZUM] Xatolik:', e.message);
      res.json({ success: true });
    }
  });

  // ============================================================
  // 8. WALLET — BALANS TEKSHIRISH VA TO'LDIRISH
  // ============================================================

  /**
   * GET /api/payments/wallet/:patientId
   * Bemorning wallet balansini ko'rish
   */
  router.get('/payments/wallet/:patientId', authMiddleware, async (req, res) => {
    try {
      const patient = await qGet(
        'SELECT id, first_name, last_name, phone, cashback_balance, wallet_balance FROM patients WHERE id = $1 AND tenant_id = $2',
        [req.params.patientId, req.user?.tenant_id || 'default']
      );
      if (!patient) {
        return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      }

      res.json({
        success: true,
        patient: {
          id: patient.id,
          name: `${patient.first_name} ${patient.last_name || ''}`.trim(),
          phone: patient.phone
        },
        balance: parseFloat(patient.wallet_balance || patient.cashback_balance || 0),
        currency: 'so\'m'
      });
    } catch (e) {
      safeError(res, e);
    }
  });

  /**
   * POST /api/payments/wallet/topup
   * Wallet ni to'ldirish (QR orqali)
   */
  router.post('/payments/wallet/topup', authMiddleware, payLimiter, async (req, res) => {
    try {
      const { patient_id, amount } = req.body;
      const tenantId = req.user?.tenant_id || 'default';

      if (!patient_id || !amount || amount <= 0) {
        return res.status(400).json({ success: false, error: 'Noto\'g\'ri ma\'lumot' });
      }

      const patient = await qGet('SELECT id, first_name, last_name FROM patients WHERE id = $1 AND tenant_id = $2', [patient_id, tenantId]);
      if (!patient) {
        return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      }

      // Wallet to'ldirish uchun to'lov yaratamiz
      const orderId = uuidv4();
      const baseUrl = process.env.TUNNEL_URL || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

      await q(
        `INSERT INTO payment_transactions
         (id, tenant_id, patient_id, amount, description, provider, type, status, created_at)
         VALUES ($1, $2, $3, $4, 'Wallet to\'ldirish', 'auto', 'wallet_topup', 'pending', NOW())`,
        [orderId, tenantId, patient_id, Math.round(amount)]
      );

      // QR kod yaratamiz
      QRCode.toDataURL(`${baseUrl}/api/payments/pay/${orderId}`, {
        width: 400,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' }
      }).then(qrDataUrl => {
        res.json({
          success: true,
          orderId,
          amount: Math.round(amount),
          qrCode: qrDataUrl,
          paymentUrl: `${baseUrl}/api/payments/pay/${orderId}`,
          message: `💰 ${Math.round(amount).toLocaleString('uz-UZ')} so'm wallet to'ldirish`
        });
      }).catch(e => {
        res.json({
          success: true,
          orderId,
          amount: Math.round(amount),
          paymentUrl: `${baseUrl}/api/payments/pay/${orderId}`,
          message: `💰 Wallet to'ldirish`
        });
      });

    } catch (e) {
      safeError(res, e);
    }
  });

  // ============================================================
  // 9. TO'LOV TARIXI
  // ============================================================

  /**
   * GET /api/payments/history/:patientId
   * Bemorning to'lov tarixi
   */
  router.get('/payments/history/:patientId', authMiddleware, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const txns = await q(
        `SELECT * FROM payment_transactions
         WHERE patient_id = $1 AND tenant_id = $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [req.params.patientId, req.user?.tenant_id || 'default', limit]
      );

      res.json({
        success: true,
        total: txns.length,
        transactions: txns.map(t => ({
          id: t.id,
          amount: t.amount,
          description: t.description,
          provider: t.provider,
          status: t.status,
          paid_at: t.paid_at,
          created_at: t.created_at
        }))
      });
    } catch (e) {
      safeError(res, e);
    }
  });

  /**
   * GET /api/payments/history
   * Klinika bo'yicha barcha to'lovlar (admin/ceo)
   */
  router.get('/payments/history', authMiddleware, checkRole('ceo', 'admin'), async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const status = req.query.status || null;
      const tenantId = req.user?.tenant_id || 'default';

      let sql = `SELECT pt.*, p.first_name, p.last_name, p.phone
                 FROM payment_transactions pt
                 LEFT JOIN patients p ON p.id = pt.patient_id
                 WHERE pt.tenant_id = $1`;
      const params = [tenantId];

      if (status) {
        sql += ' AND pt.status = $2';
        params.push(status);
      }

      sql += ' ORDER BY pt.created_at DESC LIMIT $' + (params.length + 1);
      params.push(limit);

      const txns = await q(sql, params);

      res.json({
        success: true,
        total: txns.length,
        transactions: txns
      });
    } catch (e) {
      safeError(res, e);
    }
  });

  // ============================================================
  // 10. QR GENERATOR (Frontend uchun)
  // ============================================================

  /**
   * GET /api/payments/qr/:orderId
   * To'lov uchun QR kod rasm qaytaradi
   */
  router.get('/payments/qr/:orderId', async (req, res) => {
    try {
      const txn = await qGet('SELECT * FROM payment_transactions WHERE id = $1', [req.params.orderId]);
      if (!txn) {
        return res.status(404).json({ success: false, error: 'To\'lov topilmadi' });
      }

      const baseUrl = process.env.TUNNEL_URL || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
      const payUrl = txn.payment_url || `${baseUrl}/api/payments/pay/${txn.id}`;

      const qrBuffer = await QRCode.toBuffer(payUrl, {
        width: 400,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' }
      });

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(qrBuffer);

    } catch (e) {
      res.status(500).json({ success: false, error: 'QR yaratishda xatolik' });
    }
  });

  return router;
}
