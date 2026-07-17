import { Router } from 'express';
import { generateReferralPassPdf } from '../services/pdfGenerator.js';
import { safeError } from '../services/safe-error.js';

export default function referralPassRoutes(pool, authMiddleware, checkRole) {
  const router = Router();

  async function qGet(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
  }

  // GET /api/referrals/details/:id — Referral details
  router.get('/details/:id', async (req, res) => {
    try {
      const ref = await qGet('SELECT * FROM referrals WHERE referral_id = $1 OR id = $2', [req.params.id, req.params.id]);
      if (!ref) return res.status(404).json({ error: 'Yo\'llanma topilmadi' });

      res.json({
        success: true,
        referral: {
          id: ref.id,
          referral_id: ref.referral_id,
          patient_name: ref.patient_name,
          service_required: ref.service_required,
          referring_doctor: ref.referring_doctor,
          receiver_clinic_id: ref.receiver_clinic_id,
          sender_clinic_id: ref.sender_clinic_id,
          status: ref.status,
          notes: ref.notes,
          created_at: ref.created_at
        }
      });
    } catch (e) {
      safeError(res, e);
    }
  });

  // GET /api/referrals/:id/download-pdf — Download referral pass PDF
  router.get('/:id/download-pdf', async (req, res) => {
    try {
      const ref = await qGet('SELECT * FROM referrals WHERE referral_id = $1 OR id = $2', [req.params.id, req.params.id]);
      if (!ref) return res.status(404).json({ error: 'Yo\'llanma topilmadi' });

      const result = await generateReferralPassPdf(ref);
      res.download(result.filePath, result.filename, (err) => {
        if (err && !res.headersSent) res.status(500).json({ error: 'Yuklab olishda xatolik' });
      });
    } catch (e) {
      safeError(res, e);
    }
  });

  // GET /api/referrals/:id/qr — QR Base64
  router.get('/:id/qr', async (req, res) => {
    try {
      const ref = await qGet('SELECT * FROM referrals WHERE referral_id = $1 OR id = $2', [req.params.id, req.params.id]);
      if (!ref) return res.status(404).json({ error: 'Yo\'llanma topilmadi' });

      const QRCode = (await import('qrcode')).default;
      const qrLink = `https://t.me/falcon_ai_bot/app?startapp=ref_${ref.referral_id || ref.id}`;
      const qrDataUrl = await QRCode.toDataURL(qrLink, { width: 300, margin: 2, color: { dark: '#1e3a5f', light: '#ffffff' } });

      res.json({ success: true, qr: qrDataUrl, link: qrLink });
    } catch (e) {
      safeError(res, e);
    }
  });

  return router;
}
