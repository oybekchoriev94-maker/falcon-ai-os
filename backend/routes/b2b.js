import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

export default function b2bRoutes(pool, authMiddleware, checkRole, validate, schemas, serverError, platformPool = pool) {
  const router = Router();

  async function q(sql, params = []) {
    const r = await pool.query(sql, params);
    return /^SELECT/i.test(sql.trim()) ? r.rows : r;
  }
  async function qGet(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  }
  async function platformQGet(sql, params = []) {
    const r = await platformPool.query(sql, params);
    return r.rows[0] || null;
  }

  router.post('/referral', authMiddleware, checkRole('admin', 'doctor'), validate(schemas.b2bReferral), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const { sender_clinic, sender_doctor, receiver_clinic, patient_name, service, amount, idempotency_key } = req.body;
      if (idempotency_key) {
        const existing = await qGet("SELECT response FROM idempotency_keys WHERE tenant_id = $1 AND key = $2", [tenantId, idempotency_key]);
        if (existing) return res.json({ ...existing.response, idempotent: true });
      }
      const doctorId = req.user.doctor_id;
      if (!doctorId) return res.status(403).json({ success: false, error: 'Shifokor identifikatsiyasi topilmadi' });
      const doc = await qGet("SELECT id, first_name, last_name, referrer_bonus_percent FROM doctors WHERE tenant_id = $1 AND id = $2", [tenantId, doctorId]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const refId = 'REF-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const qrToken = 'QR-' + uuidv4().replace(/-/g, '').substring(0, 16).toUpperCase();
      const id = uuidv4();
      const doctorName = `${doc.first_name} ${doc.last_name}`.trim();
      await q("INSERT INTO referrals (id, tenant_id, referral_id, sender_clinic_id, receiver_clinic_id, patient_name, service_required, qr_code_token, referring_doctor, notes, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')",
        [id, tenantId, refId, sender_clinic || null, receiver_clinic || null, patient_name, service, qrToken, doctorName, null]);
      const total = parseFloat(amount) || 0;
      const platformAmount = Math.round(total * 0.03 * 100) / 100;
      const referrerBonusPercent = doc.referrer_bonus_percent || 10.0;
      const referrerAmount = Math.round(total * (referrerBonusPercent / 100) * 100) / 100;
      const clinicAmount = Math.round((total - platformAmount - referrerAmount) * 100) / 100;
      const txId = uuidv4();
      await q("INSERT INTO financial_transactions (id, tenant_id, referral_id, total_amount, partner_commission, doctor_share, platform_fee, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'unpaid')",
        [txId, tenantId, id, total, referrerAmount, referrerAmount, platformAmount]);
      const responsePayload = {
        success: true, referral: { id: refId, qr_code: qrToken, patient_name, service },
        split: { total, platform_fee_percent: 3.0, platform_amount: platformAmount, referrer_bonus_percent: referrerBonusPercent, referrer_amount: referrerAmount, clinic_amount: clinicAmount }
      };
      if (idempotency_key) {
        await q("INSERT INTO idempotency_keys (tenant_id, key, response) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, key) DO NOTHING",
          [tenantId, idempotency_key, JSON.stringify(responsePayload)]);
      }
      res.json(responsePayload);
    } catch (e) { serverError(res, e); }
  });

  router.get('/stats', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const total = await qGet("SELECT COUNT(*) as c FROM referrals WHERE tenant_id = $1", [tenantId]);
      const pending = await qGet("SELECT COUNT(*) as c FROM referrals WHERE tenant_id = $1 AND status='pending'", [tenantId]);
      const completed = await qGet("SELECT COUNT(*) as c FROM referrals WHERE tenant_id = $1 AND status='completed'", [tenantId]);
      const paid = await qGet("SELECT COALESCE(SUM(total_amount), 0) as s FROM financial_transactions WHERE tenant_id = $1 AND status='paid'", [tenantId]);
      const unpaid = await qGet("SELECT COALESCE(SUM(partner_commission), 0) as s FROM financial_transactions WHERE tenant_id = $1 AND status='unpaid'", [tenantId]);
      res.json({ success: true, total_referrals: parseInt(total.c || 0), pending_referrals: parseInt(pending.c || 0), completed_referrals: parseInt(completed.c || 0), total_financial: parseFloat(paid.s || 0), unpaid_commission: parseFloat(unpaid.s || 0) });
    } catch (e) { serverError(res, e); }
  });

  router.get('/referrals', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const offset = (page - 1) * limit;
      const { status: fStatus } = req.query;
      let countSql = "SELECT COUNT(*) as c FROM referrals WHERE tenant_id = $1";
      let dataSql = "SELECT * FROM referrals WHERE tenant_id = $1";
      const countParams = [tenantId];
      const dataParams = [tenantId];
      if (fStatus) { countSql += " AND status = $2"; dataSql += " AND status = $2"; countParams.push(fStatus); dataParams.push(fStatus); }
      dataSql += " ORDER BY created_at DESC LIMIT $" + (dataParams.length + 1) + " OFFSET $" + (dataParams.length + 2);
      dataParams.push(limit, offset);
      const totalC = await qGet(countSql, countParams);
      const refs = await q(dataSql, dataParams);
      res.json({ success: true, total: parseInt(totalC.c || 0), page, limit, total_pages: Math.ceil((totalC.c || 0) / limit), data: refs, referrals: refs });
    } catch (e) { serverError(res, e); }
  });

  router.get('/qr/:token', async (req, res) => {
    try {
      // Public QR token is the capability used to discover its tenant.
      const ref = await platformQGet(
        `SELECT referral_id, patient_name, service_required, sender_clinic_id, status, created_at
         FROM referrals
         WHERE qr_code_token = $1 OR referral_id = $1`,
        [req.params.token]
      );
      if (!ref) return res.status(404).json({ success: false, error: 'Yo\'llanma topilmadi' });
      res.json({ success: true, referral: { referral_id: ref.referral_id, patient_name: ref.patient_name, service_required: ref.service_required, sender_clinic_id: ref.sender_clinic_id, status: ref.status, created_at: ref.created_at } });
    } catch (e) { serverError(res, e); }
  });

  router.post('/redeem', authMiddleware, checkRole('admin', 'receptionist'), validate(schemas.referralsRedeem), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const { referral_id, receiver_clinic_id, idempotency_key } = req.body;
      if (idempotency_key) {
        const existing = await qGet("SELECT response FROM idempotency_keys WHERE tenant_id = $1 AND key = $2", [tenantId, idempotency_key]);
        if (existing) return res.json({ ...existing.response, idempotent: true });
      }
      const ref = await qGet("SELECT * FROM referrals WHERE tenant_id = $1 AND (referral_id = $2 OR qr_code_token = $2)", [tenantId, referral_id]);
      if (!ref) return res.status(404).json({ success: false, error: 'Yo\'llanma topilmadi' });
      if (ref.status !== 'pending') return res.status(400).json({ success: false, error: `Yo\'llanma allaqachon ${ref.status}` });
      await q("UPDATE referrals SET status = 'completed' WHERE tenant_id = $1 AND id = $2", [tenantId, ref.id]);
      if (receiver_clinic_id) await q("UPDATE referrals SET receiver_clinic_id = $1 WHERE tenant_id = $2 AND id = $3", [receiver_clinic_id, tenantId, ref.id]);
      const fin = await qGet("SELECT * FROM financial_transactions WHERE tenant_id = $1 AND referral_id = $2", [tenantId, ref.id]);
      if (fin) await q("UPDATE financial_transactions SET status = 'paid' WHERE tenant_id = $1 AND id = $2", [tenantId, fin.id]);
      const responsePayload = { success: true, message: 'Yo\'llanma tasdiqlandi', referral: ref.referral_id, split: fin };
      if (idempotency_key) {
        await q("INSERT INTO idempotency_keys (tenant_id, key, response) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, key) DO NOTHING",
          [tenantId, idempotency_key, JSON.stringify(responsePayload)]);
      }
      res.json(responsePayload);
    } catch (e) { serverError(res, e); }
  });

  return router;
}
