// ============================================================
// FALCON AI OS — Doctor Management Routes
// Shifokorlarni boshqarish, ro'yxatga olish, kampaniya
// sozlamalari va reception endpointlari
// ============================================================

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcrypt';
import { safeError } from '../services/safe-error.js';
import { llm, transcribe } from '../../ai/orchestrator.js';

export default function doctorRoutes(pool, authMiddleware, checkRole, validate, schemas, telegramOrJwtAuth, upload) {
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

  // ============================================================
  // DOCTORS ENDPOINTS
  // ============================================================

  // GET /api/doctors — barcha shifokorlar ro'yxati (public)
  router.get('/doctors', async (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
      const offset = (page - 1) * limit;
      const total = await qGet("SELECT COUNT(*) as c FROM doctors");
      const docs = await q("SELECT * FROM doctors ORDER BY first_name LIMIT $1 OFFSET $2", [limit, offset]);
      res.json({ success: true, total: total.c, page, limit, total_pages: Math.ceil(total.c / limit), doctors: docs });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/auth/register-doctor — admin yangi shifokor qo'shishi
  router.post('/auth/register-doctor', authMiddleware, checkRole('admin'), validate(schemas.registerDoctor), async (req, res) => {
    try {
      const { name, username, password, specialization } = req.body;
      const existing = await qGet("SELECT id FROM doctors WHERE username = $1", [username]);
      if (existing) return res.status(409).json({ success: false, error: 'Bu username allaqachon mavjud' });
      const id = uuidv4();
      const hash = await bcrypt.hash(password, 10);
      const nameParts = name.trim().split(/\s+/);
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(' ') || '';
      await q(
        "INSERT INTO doctors (id, first_name, last_name, specialty, username, password_hash, specialization, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Faol')",
        [id, firstName, lastName, name, username, hash, specialization]
      );
      res.status(201).json({
        success: true,
        doctor: {
          id, first_name: firstName, last_name: lastName,
          username, specialization, specialty: name, status: 'Faol'
        }
      });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/doctors/manage — admin uchun shifokorlar ro'yxati (login ma'lumotlari bilan)
  router.get('/doctors/manage', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const docs = await q("SELECT id, first_name, last_name, specialty, username, specialization, status, balance, referrer_bonus_percent, created_at FROM doctors ORDER BY created_at DESC");
      res.json({ success: true, total: docs.length, doctors: docs });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/doctors/toggle-status — admin shifokor faolligini o'zgartirishi
  router.post('/doctors/toggle-status', authMiddleware, checkRole('admin'), validate(schemas.doctorToggleStatus), async (req, res) => {
    try {
      const { doctor_id } = req.body;
      const doc = await qGet("SELECT id, status FROM doctors WHERE id = $1", [doctor_id]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const newStatus = doc.status === 'Faol' ? 'Bloklangan' : 'Faol';
      await q("UPDATE doctors SET status = $1 WHERE id = $2", [newStatus, doctor_id]);
      res.json({ success: true, doctor_id, previous_status: doc.status, new_status: newStatus });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/doctors/update-bonus-percent — admin shifokorning referral bonus foizini o'zgartirishi
  router.post('/doctors/update-bonus-percent', authMiddleware, checkRole('admin'), validate(schemas.doctorUpdateBonusPercent), async (req, res) => {
    try {
      const { doctor_id, referrer_bonus_percent } = req.body;
      const percent = Math.max(0, Math.min(100, parseFloat(referrer_bonus_percent)));
      const doc = await qGet("SELECT id, first_name, last_name, referrer_bonus_percent FROM doctors WHERE id = $1", [doctor_id]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const previous = doc.referrer_bonus_percent || 10.0;
      await q("UPDATE doctors SET referrer_bonus_percent = $1 WHERE id = $2", [percent, doctor_id]);
      res.json({ success: true, doctor_id, doctor_name: `${doc.first_name} ${doc.last_name || ''}`.trim(), previous_percent: previous, new_percent: percent });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/doctors/topup-balance — admin shifokor balansini to'ldirishi
  router.post('/doctors/topup-balance', authMiddleware, checkRole('admin'), validate(schemas.doctorTopupBalance), async (req, res) => {
    try {
      const { doctor_id, amount } = req.body;
      const amt = Math.round(parseFloat(amount) * 100) / 100;
      const doc = await qGet("SELECT id, first_name, last_name, balance FROM doctors WHERE id = $1", [doctor_id]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const oldBalance = doc.balance || 0;
      const newBalance = oldBalance + amt;
      await q("UPDATE doctors SET balance = $1 WHERE id = $2", [newBalance, doctor_id]);
      await q(`INSERT INTO platform_ledger (doctor_id, total_amount, platform_fee_percent, platform_amount, referrer_bonus_percent, referrer_amount, clinic_amount, remaining_balance, status) VALUES ($1, $2, 0, 0, 0, 0, $3, $4, 'topup')`,
        [doctor_id, amt, amt, newBalance]);
      res.json({ success: true, doctor_id, doctor_name: `${doc.first_name} ${doc.last_name || ''}`.trim(), previous_balance: oldBalance, new_balance: newBalance, topped_up: amt });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/doctors/balance — joriy shifokorning balansini qaytarish (dashboard/doctor uchun)
  router.get('/doctors/balance', authMiddleware, async (req, res) => {
    try {
      const doc = await qGet("SELECT id, first_name, last_name, balance FROM doctors WHERE id = $1", [req.user.id]);
      if (!doc) return res.json({ success: true, balance: 0, message: 'Doctor topilmadi, 0 qaytarildi' });
      res.json({ success: true, doctor_id: doc.id, doctor_name: `${doc.first_name} ${doc.last_name || ''}`.trim(), balance: doc.balance || 0 });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // DOCTOR SELF-SERVICE ENDPOINTS (o'z ma'lumotlari)
  // ============================================================

  // GET /api/doctor/my-patients — shifokorning o'z patientlari va qabullari
  router.get('/doctor/my-patients', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const patients = await q("SELECT * FROM patient_consultations WHERE doctor_id = $1 ORDER BY created_at DESC LIMIT 50", [req.user.id]);
      const appointments = await q("SELECT * FROM appointments WHERE doctor_name = $1 ORDER BY created_at DESC LIMIT 20", [req.user.name]);
      res.json({ success: true, patients: patients.length, consultations: patients, appointments });
    } catch (e) { safeError(res, e); }
  });

  // GET /api/doctor/my-stats — shifokorning statistikasi
  router.get('/doctor/my-stats', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const stats = await q("SELECT * FROM doctor_analytics WHERE doctor_id = $1 ORDER BY period_start DESC LIMIT 1", [req.user.id]);
      const recent = await qGet("SELECT COUNT(*) as c FROM patient_consultations WHERE doctor_id = $1 AND DATE(created_at) = CURRENT_DATE", [req.user.id]);
      res.json({ success: true, stats: stats || { patients_count: 0, total_revenue: 0 }, today_patients: recent ? recent.c : 0 });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // PATIENT CAMPAIGN SETTINGS (Admin panel)
  // ============================================================

  // GET /api/campaign/settings — joriy kampaniya sozlamalarini olish (ommaviy)
  router.get('/campaign/settings', async (req, res) => {
    try {
      const mode = await qGet("SELECT value FROM clinic_settings WHERE key = 'patient_campaign_mode'");
      const pct = await qGet("SELECT value FROM clinic_settings WHERE key = 'patient_referral_percent'");
      res.json({
        success: true,
        campaign_mode: mode ? mode.value : 'always',
        referral_percent: pct ? parseFloat(pct.value) : 3.0,
        platform_fee_percent: 3.0
      });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/campaign/settings — kampaniya rejimini o'zgartirish (faqat admin/ceo)
  router.post('/campaign/settings', authMiddleware, checkRole('admin', 'ceo'), validate(schemas.campaignSettings), async (req, res) => {
    try {
      const { campaign_mode } = req.body;
      await q(
        "INSERT INTO clinic_settings (key, value, updated_at) VALUES ('patient_campaign_mode', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
        [campaign_mode]
      );
      res.json({ success: true, message: 'Kampaniya rejimi yangilandi', campaign_mode });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // RECEPTION ENDPOINTS
  // ============================================================

  // GET /api/reception/voice-register — ovozli ro'yxatdan o'tkazish (faqat POST)
  router.get('/reception/voice-register', authMiddleware, checkRole('receptionist', 'admin'), (req, res) => {
    res.status(405).json({ error: 'POST method ishlatilsin' });
  });

  // POST /api/reception/voice-register — ovozli ro'yxatdan o'tkazish
  router.post('/reception/voice-register', authMiddleware, checkRole('receptionist', 'admin'), upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Audio fayl majburiy' });
      const { text, error } = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm');
      if (error) return res.status(500).json({ success: false, error });
      const result = await llm(
        'Siz reception uchun ma\'lumot yig\'uvchi AI asistentsiz. Ovozli matndan bemor ismi, telefoni, shifokor mutaxassisligi yoki ismi va vaqtini ajratib, faqat JSON formatda qaytaring: {"patient_name":"...", "phone":"...", "doctor":"...", "time":"..."}',
        text
      );
      res.json({ success: true, transcription: text, data: result });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/reception/confirm — receptionist tomonidan qabulni tasdiqlash
  router.post('/reception/confirm', authMiddleware, checkRole('receptionist', 'admin'), validate(schemas.receptionConfirm), async (req, res) => {
    try {
      const { patient_name, phone, doctor_name, department, notes } = req.body;
      const aptId = 'apt-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
      await q("INSERT INTO appointments (appointment_id, patient_name, phone, doctor_name, department, notes, source) VALUES ($1, $2, $3, $4, $5, $6, 'reception')",
        [aptId, patient_name, phone || '', doctor_name || '', department || 'therapy', notes || '']);
      // Queue
      const maxQ = await qGet("SELECT COALESCE(MAX(queue_number),0) + 1 as n FROM patient_queue WHERE status='waiting'");
      await q("INSERT INTO patient_queue (queue_number, patient_name, phone, doctor) VALUES ($1, $2, $3, $4)",
        [maxQ.n, patient_name, phone || '', doctor_name || '']);
      // Doctor analytics
      if (doctor_name) {
        const period = new Date().toISOString().slice(0, 10);
        await q(
          `INSERT INTO doctor_analytics (doctor_id, doctor_name, patients_count, period_start, period_end) VALUES ($1, $2, 1, $3, $4)
           ON CONFLICT (doctor_id, period_start) DO UPDATE SET patients_count = doctor_analytics.patients_count + 1`,
          [doctor_name.toLowerCase().replace(/\s/g, '_'), doctor_name, period, period]);
      }
      res.json({ success: true, appointment: { appointment_id: aptId, patient_name, phone, doctor_name, queue: maxQ.n } });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
