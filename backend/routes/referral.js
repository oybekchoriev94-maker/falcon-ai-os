import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';

export default function referralRoutes(pool, authMiddleware, checkRole) {
  const router = Router();

  async function q(sql, params = []) {
    const result = await pool.query(sql, params);
    if (/^SELECT/i.test(sql.trim())) return result.rows;
    return result;
  }
  async function qGet(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
  }

  const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      return res.status(400).json({ error: 'Validatsiya xatosi', details: errors });
    }
    req.body = result.data;
    next();
  };

  const generateSchema = z.object({
    partner_name: z.string().min(2).max(255),
    partner_phone: z.string().max(20).optional(),
    notes: z.string().optional()
  });

  const convertSchema = z.object({
    referral_code: z.string().optional(),
    patient_id: z.string().uuid(),
    total_amount: z.number().nonnegative(),
    idempotency_key: z.string().optional()
  });

  const adjustSchema = z.object({
    partner_id: z.string().uuid(),
    type: z.enum(['topup', 'payout']),
    amount: z.number().positive(),
    note: z.string().min(3).max(500)
  });

  // POST /api/referral/generate — hamkor uchun QR kod yaratish
  router.post('/generate', authMiddleware, checkRole('admin', 'ceo'), validate(generateSchema), async (req, res) => {
    try {
      const { partner_name, partner_phone, notes } = req.body;
      const id = uuidv4();
      const referralCode = 'PRT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const qrToken = 'QR-' + uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();

      await q(
        'INSERT INTO referral_partners (id, name, phone, referral_code, qr_code_base64, balance, notes) VALUES ($1, $2, $3, $4, $5, 0, $6)',
        [id, partner_name, partner_phone || '', referralCode, qrToken, notes || '']
      );

      const qrData = JSON.stringify({
        type: 'referral', code: referralCode, token: qrToken,
        partner: partner_name, phone: partner_phone || ''
      });

      res.json({
        success: true,
        partner: { id, name: partner_name, referral_code: referralCode, qr_code_token: qrToken },
        qr_data: qrData,
        qr_endpoint: `/api/referral/qr/${qrToken}`
      });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/referral/convert — Face ID orqali kelgan bemor referalini konvertatsiya qilish
  router.post('/convert', authMiddleware, checkRole('admin', 'receptionist'), validate(convertSchema), async (req, res) => {
    try {
      const { referral_code, patient_id, total_amount, idempotency_key } = req.body;

      // Idempotency key tekshirish
      if (idempotency_key) {
        const existing = await qGet("SELECT response FROM idempotency_keys WHERE key = $1", [idempotency_key]);
        if (existing) {
          return res.json({ ...JSON.parse(existing.response), idempotent: true });
        }
      }
      let partner = null;

      if (referral_code) {
        partner = await qGet('SELECT * FROM referral_partners WHERE referral_code = $1', [referral_code]);
        if (!partner) return res.status(404).json({ success: false, error: 'Referral kod topilmadi' });
      }

      const patient = await qGet('SELECT id, first_name, last_name, phone FROM patients WHERE id = $1', [patient_id]);
      if (!patient) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });

      const refId = 'REF-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const qrToken = 'QR-' + uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
      const id = uuidv4();
      const total = Math.abs(total_amount);
      const partnerCommission = Math.round(total * 0.4);
      const doctorShare = Math.round(total * 0.2);
      const platformFee = 2000;
      const patientName = `${patient.first_name} ${patient.last_name || ''}`.trim();

      await q(
        'INSERT INTO referrals (id, referral_id, sender_clinic_id, patient_name, service_required, status, qr_code_token, referring_doctor, notes, partner_id, patient_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)',
        [id, refId, null, patientName, 'Face ID orqali', 'completed', qrToken, partner ? partner.name : null, null, partner ? partner.id : null, patient_id]
      );

      const txId = uuidv4();
      await q(
        'INSERT INTO financial_transactions (id, referral_id, total_amount, partner_commission, doctor_share, platform_fee, status) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [txId, id, total, partnerCommission, doctorShare, platformFee, 'paid']
      );

      if (partner) {
        await q('UPDATE referral_partners SET balance = balance + $1 WHERE id = $2', [partnerCommission, partner.id]);
        await q(
          'INSERT INTO partner_transactions (partner_id, type, amount, note) VALUES ($1, $2, $3, $4)',
          [partner.id, 'referral_commission', partnerCommission, `Referal: ${patientName}`]
        );
      }

      const responsePayload = {
        success: true,
        referral: { id: refId, patient_name: patientName, total, status: 'completed' },
        split: { partner_commission: partnerCommission, doctor_share: doctorShare, platform_fee: platformFee },
        partner_balance: partner ? (partner.balance + partnerCommission) : null
      };

      if (idempotency_key) {
        await q(
          "INSERT INTO idempotency_keys (key, response, created_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO NOTHING",
          [idempotency_key, JSON.stringify(responsePayload)]);
      }

      res.json(responsePayload);
    } catch (e) { safeError(res, e); }
  });

  // POST /api/referral/adjust-balance — admin tomonidan balansni boshqarish
  router.post('/adjust-balance', authMiddleware, checkRole('admin', 'ceo'), validate(adjustSchema), async (req, res) => {
    try {
      const { partner_id, type, amount, note } = req.body;
      const partner = await qGet('SELECT * FROM referral_partners WHERE id = $1', [partner_id]);
      if (!partner) return res.status(404).json({ success: false, error: 'Hamkor topilmadi' });

      const adjAmount = Math.abs(amount);
      if (type === 'payout' && partner.balance < adjAmount) {
        return res.status(400).json({
          success: false, error: `Balans yetarli emas. Mavjud: ${partner.balance.toLocaleString()} so'm`
        });
      }

      const delta = type === 'topup' ? adjAmount : -adjAmount;
      await q('UPDATE referral_partners SET balance = balance + $1 WHERE id = $2', [delta, partner_id]);
      await q(
        'INSERT INTO partner_transactions (partner_id, type, amount, note) VALUES ($1, $2, $3, $4)',
        [partner_id, type, adjAmount, note]
      );

      const updated = await qGet('SELECT * FROM referral_partners WHERE id = $1', [partner_id]);
      res.json({
        success: true, partner_id, type, amount: adjAmount, note,
        previous_balance: partner.balance,
        new_balance: updated.balance
      });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/referral/partners — hamkorlar ro'yxati
  router.get('/partners', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const partners = await q('SELECT id, name, phone, referral_code, qr_code_base64, balance, notes, created_at FROM referral_partners ORDER BY balance DESC');
      res.json({ success: true, total: partners.length, partners });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/referral/stats — statistika
  router.get('/stats', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const partnerStats = await q('SELECT COUNT(*) as total, COALESCE(SUM(balance), 0) as total_balance FROM referral_partners');
      const referralStats = await qGet("SELECT COUNT(*) as total FROM referrals WHERE partner_id IS NOT NULL");
      const completedStats = await qGet("SELECT COUNT(*) as total FROM referrals WHERE partner_id IS NOT NULL AND status = 'completed'");
      const pendingStats = await qGet("SELECT COUNT(*) as total FROM referrals WHERE partner_id IS NOT NULL AND status = 'pending'");
      const patientCount = await qGet("SELECT COUNT(*) as total FROM patients");
      const todayCheckins = await qGet("SELECT COUNT(*) as total FROM face_logs WHERE DATE(created_at) = CURRENT_DATE AND action IN ('checked_in','patient_register')");
      res.json({
        success: true,
        total_partners: partnerStats[0]?.total || 0,
        total_balance: partnerStats[0]?.total_balance || 0,
        total_referrals: referralStats?.total || 0,
        completed_referrals: completedStats?.total || 0,
        pending_referrals: pendingStats?.total || 0,
        total_patients: patientCount?.total || 0,
        today_checkins: todayCheckins?.total || 0
      });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/referral/partner/:id — hamkor detallari
  router.get('/partner/:id', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const partner = await qGet('SELECT * FROM referral_partners WHERE id = $1', [req.params.id]);
      if (!partner) return res.status(404).json({ success: false, error: 'Hamkor topilmadi' });
      const txs = await q('SELECT * FROM partner_transactions WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 50', [partner.id]);
      const refs = await q("SELECT id, referral_id, patient_name, service_required, status, created_at FROM referrals WHERE partner_id = $1 ORDER BY created_at DESC LIMIT 50", [partner.id]);
      res.json({ success: true, partner, transactions: txs, referrals: refs });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/referral/qr/:token — QR token orqali hamkor ma'lumoti
  router.get('/qr/:token', async (req, res) => {
    try {
      const partner = await qGet('SELECT id, name, phone, referral_code FROM referral_partners WHERE qr_code_base64 = $1', [req.params.token]);
      if (!partner) return res.status(404).json({ success: false, error: 'QR kod topilmadi' });
      res.json({ success: true, partner });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
