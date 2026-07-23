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
  verifyClickSign
} from '../services/payment-gateway.js';
import { findBestMatch } from '../services/face-engine.js';

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
      const tenantId = req.user?.tenant_id || 'default';

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
          await q('UPDATE payment_transactions SET payment_url = $1, provider = $2 WHERE id = $3',
            [payment.paymentUrl, payment.provider, orderId]);
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
        `SELECT pt.*, p.first_name, p.last_name, p.phone
         FROM payment_transactions pt
         LEFT JOIN patients p ON p.id = pt.patient_id
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
        patient_phone: txn.phone || null,
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
      const txn = await qGet('SELECT * FROM payment_transactions WHERE id = $1', [req.params.orderId]);
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
        // Noma'lum transaction — log ga yozamiz
        await q('INSERT INTO payment_webhook_logs (provider, raw_json, status) VALUES ($1, $2, $3)',
          ['payme', JSON.stringify(req.body), 'unknown_order']);
        return res.json({ success: true }); // Payme har doim 200 qaytarish kerak
      }

      if (result.status === 'paid') {
        // To'lovni tasdiqlaymiz
        await q(`UPDATE payment_transactions
           SET status = 'paid', paid_at = NOW(),
               provider_transaction_id = $1,
               raw_response = $2
           WHERE id = $3 AND status = 'pending'`,
          [result.transactionId || null, JSON.stringify(result.raw || {}), txn.id]);

        // Bemorga cashback (3%)
        if (txn.patient_id) {
          const cashbackPercent = 3.0;
          const cashback = Math.round(txn.amount * cashbackPercent / 100);
          if (cashback > 0) {
            await q("UPDATE patients SET cashback_balance = COALESCE(cashback_balance, 0) + $1 WHERE id = $2",
              [cashback, txn.patient_id]);
            await q(`INSERT INTO loyalty_ledger (tenant_id, patient_id, patient_name, type, amount, balance_before, balance_after, description, created_at)
                     VALUES ($1, $2, $3, 'earned', $4,
                       COALESCE((SELECT cashback_balance - $5 FROM patients WHERE id = $6), 0),
                       COALESCE((SELECT cashback_balance FROM patients WHERE id = $7), 0),
                       $8, NOW())`,
              [txn.tenant_id, txn.patient_id, txn.patient_name || 'Bemor', cashback, cashback, txn.patient_id, txn.patient_id,
               `Cashback ${cashbackPercent}%: ${txn.description || 'To\'lov'} #${txn.id.substring(0, 8)}`]);
          }
        }

        console.log(`[PAYMENT] ✅ To'lov tasdiqlandi: ${txn.id} — ${txn.amount} so'm`);
      }

      // Webhook log
      await q('INSERT INTO payment_webhook_logs (provider, transaction_id, raw_json, status) VALUES ($1, $2, $3, $4)',
        ['payme', txn.id, JSON.stringify(req.body), result.status]);

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
        await q('INSERT INTO payment_webhook_logs (provider, raw_json, status) VALUES ($1, $2, $3)',
          ['click', JSON.stringify(req.body), 'unknown_order']);
        return res.json({ success: true });
      }

      if (result.status === 'paid') {
        await q(`UPDATE payment_transactions
           SET status = 'paid', paid_at = NOW(),
               provider_transaction_id = $1,
               raw_response = $2
           WHERE id = $3 AND status = 'pending'`,
          [result.transactionId || null, JSON.stringify(result.raw || {}), txn.id]);

        // Bemorga cashback
        if (txn.patient_id) {
          const cashback = Math.round(txn.amount * 3 / 100);
          if (cashback > 0) {
            await q("UPDATE patients SET cashback_balance = COALESCE(cashback_balance, 0) + $1 WHERE id = $2",
              [cashback, txn.patient_id]);
          }
        }

        console.log(`[PAYMENT] ✅ Click to'lov: ${txn.id} — ${txn.amount} so'm`);
      }

      await q('INSERT INTO payment_webhook_logs (provider, transaction_id, raw_json, status) VALUES ($1, $2, $3, $4)',
        ['click', txn.id, JSON.stringify(req.body), result.status]);

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
      const result = handleUzumWebhook(req.body);
      if (!result) return res.json({ success: true });

      const txn = result.orderId
        ? await qGet('SELECT * FROM payment_transactions WHERE id = $1', [result.orderId])
        : null;

      if (txn && result.status === 'paid') {
        await q(`UPDATE payment_transactions SET status = 'paid', paid_at = NOW(), provider_transaction_id = $1 WHERE id = $2`,
          [result.transactionId || null, txn.id]);
      }

      await q('INSERT INTO payment_webhook_logs (provider, transaction_id, raw_json, status) VALUES ($1, $2, $3, $4)',
        ['uzum', txn?.id || null, JSON.stringify(req.body), result.status]);

      res.json({ success: true });

    } catch (e) {
      console.error('[WEBHOOK:UZUM] Xatolik:', e.message);
      res.json({ success: true });
    }
  });

  // ============================================================
  // 7. FACE ID + TO'LOV (Face Pay)
  // ============================================================

  /**
   * POST /api/payments/face-pay
   * Face ID orqali to'lov — bemor kameraga qaraydi → tizim taniydi → to'lov
   *
   * Body: {
   *   face_descriptor: [...],    // Face ID embedding
   *   liveness_score: 0.95,
   *   service_ids: ["srv-1", "srv-2"],  // xizmatlar
   *   amount: 120000,
   *   description: "UZI tekshiruvi",
   *   provider: "wallet|payme|click|auto"
   * }
   */
  router.post('/payments/face-pay', authMiddleware, payLimiter, async (req, res) => {
    try {
      const { face_descriptor, liveness_score, service_ids, amount, description, provider } = req.body;
      const tenantId = req.user?.tenant_id || 'default';

      // 0. Jonlilik (anti-spoofing) tekshiruvi — majburiy
      const LIVENESS_THRESHOLD = parseFloat(process.env.LIVENESS_THRESHOLD || '0.7');
      if (typeof liveness_score !== 'number' || liveness_score < LIVENESS_THRESHOLD) {
        return res.status(403).json({
          success: false,
          error: 'Jonlilik tekshiruvidan o\'tmadi. Iltimos, kameraga to\'g\'ridan-to\'g\'ri qarang (foto yoki ekran orqali to\'lov mumkin emas).',
          code: 'LIVENESS_FAILED'
        });
      }

      // 1. Face ID orqali bemorni topish (faqat shu klinika bemorlari)
      const patients = await q("SELECT id, first_name, last_name, phone, face_descriptor, wallet_balance, cashback_balance FROM patients WHERE face_descriptor IS NOT NULL AND tenant_id = $1", [tenantId]);

      if (!patients.length) {
        return res.status(404).json({ success: false, error: 'Ro\'yxatdan o\'tgan bemor topilmadi' });
      }

      // Face match
      const bestMatch = findBestMatch(face_descriptor, patients, 0.45);

      if (!bestMatch.match) {
        return res.status(404).json({ success: false, error: 'Yuz tanilmadi. Iltimos, avval ro\'yxatdan o\'ting.' });
      }

      const patient = bestMatch.match;
      const totalAmount = Math.round(parseFloat(amount || 0));

      if (totalAmount <= 0) {
        return res.status(400).json({ success: false, error: 'Summa noto\'g\'ri' });
      }

      // 2. To'lov usulini tanlash
      const payMethod = provider || 'wallet';

      if (payMethod === 'wallet') {
        // Wallet dan yechish
        const currentBalance = parseFloat(patient.wallet_balance || patient.cashback_balance || 0);

        if (currentBalance < totalAmount) {
          return res.json({
            success: false,
            error: `Balans yetarli emas. Balans: ${currentBalance.toLocaleString('uz-UZ')} so'm, kerak: ${totalAmount.toLocaleString('uz-UZ')} so'm`,
            balance: currentBalance,
            shortfall: totalAmount - currentBalance,
            suggest_qr: true,  // frontend QR to'lovni taklif qiladi
            patient: { id: patient.id, name: `${patient.first_name} ${patient.last_name || ''}`.trim() }
          });
        }

        // Wallet dan yechamiz
        const newBalance = currentBalance - totalAmount;
        await q("UPDATE patients SET cashback_balance = $1 WHERE id = $2", [newBalance, patient.id]);

        // Transaction yozuvi
        const orderId = uuidv4();
        await q(
          `INSERT INTO payment_transactions
           (id, tenant_id, patient_id, amount, description, provider, status, paid_at, created_at)
           VALUES ($1, $2, $3, $4, $5, 'wallet', 'paid', NOW(), NOW())`,
          [orderId, tenantId, patient.id, totalAmount, description || `Face Pay #${orderId.substring(0, 8)}`]
        );

        // Wallet log
        await q(`INSERT INTO wallet_log (tenant_id, patient_id, type, amount, balance_before, balance_after, note, created_at)
           VALUES ($1, $2, 'payment', $3, $4, $5, $6, NOW())`,
          [tenantId, patient.id, totalAmount, currentBalance, newBalance,
           `Face Pay: ${description || 'To\'lov'} #${orderId.substring(0, 8)}`]);

        return res.json({
          success: true,
          method: 'wallet',
          orderId,
          amount: totalAmount,
          balance_before: currentBalance,
          balance_after: newBalance,
          patient: { id: patient.id, name: `${patient.first_name} ${patient.last_name || ''}`.trim() },
          message: `✅ To'lov o'tdi! ${totalAmount.toLocaleString('uz-UZ')} so'm wallet dan yechildi`
        });

      } else {
        // Payme/Click orqali to'lov
        const orderId = uuidv4();
        const baseUrl = process.env.TUNNEL_URL || process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

        await q(
          `INSERT INTO payment_transactions
           (id, tenant_id, patient_id, amount, description, provider, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
          [orderId, tenantId, patient.id, totalAmount, description || `Face Pay #${orderId.substring(0, 8)}`, provider || 'auto']
        );

        // Background da to'lov link yaratamiz
        createPayment({
          amount: totalAmount,
          description: description || `Face Pay ${patient.first_name} ${patient.last_name || ''}`,
          orderId,
          returnUrl: `${baseUrl}/qr-pay.html?order=${orderId}&patient=${patient.id}`,
          provider: provider || 'auto'
        }).then(async payment => {
          if (payment.success && payment.paymentUrl) {
            await q('UPDATE payment_transactions SET payment_url = $1 WHERE id = $2', [payment.paymentUrl, orderId]);
          }
        }).catch(e => console.error('[FACE-PAY] Payment yaratish xatosi:', e.message));

        return res.json({
          success: true,
          method: provider || 'auto',
          orderId,
          amount: totalAmount,
          patient: { id: patient.id, name: `${patient.first_name} ${patient.last_name || ''}`.trim() },
          status: 'pending',
          message: `🔗 ${provider || 'Online'} to'lov havolasi yaratilmoqda...`,
          redirect_url: null // frontend polling qiladi
        });
      }

    } catch (e) {
      safeError(res, e);
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
