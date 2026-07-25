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

  // GET /api/doctors — klinikaning shifokorlar ro'yxati (public, tenant bo'yicha)
  router.get('/doctors', async (req, res) => {
    try {
      const tenantId = req.tenant_id || 'default';
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
      const offset = (page - 1) * limit;
      const total = await qGet("SELECT COUNT(*) as c FROM doctors WHERE tenant_id = $1", [tenantId]);
      const docs = await q("SELECT * FROM doctors WHERE tenant_id = $1 ORDER BY first_name LIMIT $2 OFFSET $3", [tenantId, limit, offset]);
      res.json({ success: true, total: total.c, page, limit, total_pages: Math.ceil(total.c / limit), doctors: docs });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/auth/register-doctor — admin yangi shifokor qo'shishi
  router.post('/auth/register-doctor', authMiddleware, checkRole('admin'), validate(schemas.registerDoctor), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const { name, username, password, specialization } = req.body;
      const existing = await qGet("SELECT id FROM doctors WHERE username = $1", [username]);
      if (existing) return res.status(409).json({ success: false, error: 'Bu username allaqachon mavjud' });
      const id = uuidv4();
      const hash = await bcrypt.hash(password, 10);
      const nameParts = name.trim().split(/\s+/);
      const firstName = nameParts[0] || name;
      const lastName = nameParts.slice(1).join(' ') || '';
      await q(
        "INSERT INTO doctors (id, tenant_id, first_name, last_name, specialty, username, password_hash, specialization, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Faol')",
        [id, tenantId, firstName, lastName, name, username, hash, specialization]
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
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const docs = await q("SELECT id, first_name, last_name, specialty, username, specialization, status, balance, referrer_bonus_percent, created_at FROM doctors WHERE tenant_id = $1 ORDER BY created_at DESC", [tenantId]);
      res.json({ success: true, total: docs.length, doctors: docs });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/doctors/toggle-status — admin shifokor faolligini o'zgartirishi
  router.post('/doctors/toggle-status', authMiddleware, checkRole('admin'), validate(schemas.doctorToggleStatus), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const { doctor_id } = req.body;
      const doc = await qGet("SELECT id, status FROM doctors WHERE id = $1 AND tenant_id = $2", [doctor_id, tenantId]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const newStatus = doc.status === 'Faol' ? 'Bloklangan' : 'Faol';
      await q("UPDATE doctors SET status = $1 WHERE id = $2 AND tenant_id = $3", [newStatus, doctor_id, tenantId]);
      res.json({ success: true, doctor_id, previous_status: doc.status, new_status: newStatus });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/doctors/update-bonus-percent — admin shifokorning referral bonus foizini o'zgartirishi
  router.post('/doctors/update-bonus-percent', authMiddleware, checkRole('admin'), validate(schemas.doctorUpdateBonusPercent), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const { doctor_id, referrer_bonus_percent } = req.body;
      const percent = Math.max(0, Math.min(100, parseFloat(referrer_bonus_percent)));
      const doc = await qGet("SELECT id, first_name, last_name, referrer_bonus_percent FROM doctors WHERE id = $1 AND tenant_id = $2", [doctor_id, tenantId]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const previous = doc.referrer_bonus_percent || 10.0;
      await q("UPDATE doctors SET referrer_bonus_percent = $1 WHERE id = $2 AND tenant_id = $3", [percent, doctor_id, tenantId]);
      res.json({ success: true, doctor_id, doctor_name: `${doc.first_name} ${doc.last_name || ''}`.trim(), previous_percent: previous, new_percent: percent });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/doctors/topup-balance — admin shifokor balansini to'ldirishi
  router.post('/doctors/topup-balance', authMiddleware, checkRole('admin'), validate(schemas.doctorTopupBalance), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const { doctor_id, amount } = req.body;
      const amt = Math.round(parseFloat(amount) * 100) / 100;
      const doc = await qGet("SELECT id, first_name, last_name, balance FROM doctors WHERE id = $1 AND tenant_id = $2", [doctor_id, tenantId]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const oldBalance = doc.balance || 0;
      const newBalance = oldBalance + amt;
      await q("UPDATE doctors SET balance = $1 WHERE id = $2 AND tenant_id = $3", [newBalance, doctor_id, tenantId]);
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

  // GET /api/campaign/settings — joriy kampaniya sozlamalarini olish (tenant bo'yicha)
  router.get('/campaign/settings', async (req, res) => {
    try {
      const tenantId = req.tenant_id || 'default';
      const mode = await qGet("SELECT value FROM clinic_settings WHERE tenant_id = $1 AND key = 'patient_campaign_mode'", [tenantId]);
      const pct = await qGet("SELECT value FROM clinic_settings WHERE tenant_id = $1 AND key = 'patient_referral_percent'", [tenantId]);
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
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      const { campaign_mode } = req.body;
      await q(
        "INSERT INTO clinic_settings (tenant_id, key, value, updated_at) VALUES ($1, 'patient_campaign_mode', $2, NOW()) ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()",
        [tenantId, campaign_mode]
      );
      res.json({ success: true, message: 'Kampaniya rejimi yangilandi', campaign_mode });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // RECEPTION ENDPOINTS
  // ============================================================

  // GET /api/reception/voice-register — ovozli ro'yxatdan o'tkazish (faqat POST)
  router.get('/reception/voice-register', authMiddleware, checkRole('receptionist', 'admin', 'doctor', 'ceo'), (req, res) => {
    res.status(405).json({ error: 'POST method ishlatilsin' });
  });

  // POST /api/reception/voice-register — ovozli ro'yxatdan o'tkazish
  router.post('/reception/voice-register', authMiddleware, checkRole('receptionist', 'admin', 'doctor', 'ceo'), upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Audio fayl majburiy' });
      const { text, error } = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm', { language: req.body?.language });
      if (error) return res.status(500).json({ success: false, error });
      if (!text || !text.trim()) return res.status(400).json({ success: false, error: 'Ovoz tushunarli emas, qaytadan urinib ko\'ring' });
      // Imlo tuzatish faqat o'zbekcha diktant uchun — ruscha matnni buzmasligi kerak
      const isRu = String(req.body?.language || '').toLowerCase().startsWith('ru');
      let cleaned = text;
      if (!isRu) {
        const fixed = await llm(
          `Quyidagi matnni o'zbek lotin alifbosiga to'g'rilang (faqat matn qaytaring, izohsiz):
        • ö,õ→o'  ü→u'  ğ,ģ→g'  ş→sh  ç→ch  ý→y  ı→i  â→a  ê→e  î→i
        • Turkcha so'zlarni o'zbekchasiga almashtiring`,
          text,
          { temperature: 0.0 }
        );
        if (typeof fixed === 'string') cleaned = fixed;
      }
      const raw = await llm(
        `Bemor ma'lumotlarini ajratib, faqat JSON qaytaring. Matn o'zbek yoki rus tilida bo'lishi mumkin — ikkalasini ham tushunasiz:
{
  "patient_name": "bemor ismi",
  "phone": "telefon raqami yoki bo'sh",
  "doctor_specialty": "shifokor mutaxassisligi yoki ismi",
  "department": "bo'lim (Terapiya/Kardiologiya/Nevrologiya/Pediatriya/Xirurgiya/Stomatologiya yoki bo'sh)",
  "preferred_time": "vaqt yoki bo'sh",
  "notes": "qo'shimcha ma'lumot yoki bo'sh"
}`,
        cleaned,
        { temperature: 0.0 }
      );
      const transcript = cleaned;
      const extraction = (typeof raw === 'object' && raw !== null && !raw.error)
        ? raw
        : { patient_name: '', phone: '', doctor_specialty: '', department: '', preferred_time: '', notes: text };
      res.json({ success: true, transcript, extraction });
    } catch (e) { safeError(res, e); }
  });

  // POST /api/reception/confirm — receptionist tomonidan qabulni tasdiqlash
  router.post('/reception/confirm', authMiddleware, checkRole('receptionist', 'admin', 'doctor', 'ceo'), validate(schemas.receptionConfirm), async (req, res) => {
    try {
      const { patient_name, phone, doctor_name, department, notes, appointment_time, status } = req.body;
      const tenantId = req.user?.tenant_id || req.tenant_id || 'default';
      // Agar status berilgan bo'lsa, queue statusini yangilash
      if (status && req.body.id) {
        await q(
          "UPDATE patient_queue SET status = $1 WHERE id = $2 AND tenant_id = $3",
          [status, req.body.id, tenantId]
        );
        return res.json({ success: true, status });
      }
      const aptId = 'apt-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6);
      await q("INSERT INTO appointments (appointment_id, tenant_id, patient_name, phone, doctor_name, department, notes, source) VALUES ($1, $2, $3, $4, $5, $6, $7, 'reception')",
        [aptId, tenantId, patient_name, phone || '', doctor_name || '', department || 'therapy', notes || '']);
      // Queue — navbat raqami har bir klinika ichida alohida sanaladi.
      // patient_queue'da department/appointment_time ustunlari yo'q — ma'lumot notes'ga yoziladi.
      const queueNotes = [department, appointment_time, notes].filter(Boolean).join(' · ') || null;
      const maxQ = await qGet("SELECT COALESCE(MAX(queue_number),0) + 1 as n FROM patient_queue WHERE status='waiting' AND tenant_id = $1", [tenantId]);
      await q("INSERT INTO patient_queue (queue_number, patient_name, phone, doctor, notes, tenant_id) VALUES ($1, $2, $3, $4, $5, $6)",
        [maxQ.n, patient_name, phone || '', doctor_name || '', queueNotes, tenantId]);
      // Doctor analytics — faqat shifokor nomi bo'yicha topilsa (analitika asosiy oqimni buzmasligi kerak)
      if (doctor_name) {
        try {
          const period = new Date().toISOString().slice(0, 10);
          const doc = await qGet(
            "SELECT id FROM doctors WHERE tenant_id = $1 AND (LOWER(first_name || ' ' || COALESCE(last_name,'')) LIKE LOWER($2) OR LOWER(COALESCE(specialty,'')) LIKE LOWER($2)) ORDER BY created_at LIMIT 1",
            [tenantId, `%${doctor_name}%`]
          );
          if (doc) {
            await q(
              `INSERT INTO doctor_analytics (tenant_id, doctor_id, doctor_name, patients_count, period_start, period_end) VALUES ($1, $2, $3, 1, $4, $5)
               ON CONFLICT (tenant_id, doctor_id, period_start) DO UPDATE SET patients_count = doctor_analytics.patients_count + 1`,
              [tenantId, doc.id, doctor_name, period, period]
            );
          }
        } catch (aErr) { /* analitika ixtiyoriy — xatosi qabulni bekor qilmasin */ }
      }
      res.json({ success: true, appointment: { appointment_id: aptId, patient_name, phone, doctor_name, queue: maxQ.n } });
    } catch (e) { safeError(res, e); }
  });

  // GET /voice/queues — navbatdagi bemorlar ro'yxati
  router.get('/voice/queues', authMiddleware, async (req, res) => {
    try {
      const queues = await q(
        `SELECT id, patient_name, doctor as doctor_name, department,
                status, appointment_time, notes, created_at,
                row_number() OVER (ORDER BY
                  CASE status
                    WHEN 'in_progress' THEN 0
                    WHEN 'waiting' THEN 1
                    WHEN 'completed' THEN 2
                    WHEN 'cancelled' THEN 3
                    ELSE 4
                  END, created_at ASC
                ) as queue_number
         FROM patient_queue
         WHERE tenant_id = $1
         ORDER BY
           CASE status
             WHEN 'in_progress' THEN 0
             WHEN 'waiting' THEN 1
             WHEN 'completed' THEN 2
             WHEN 'cancelled' THEN 3
             ELSE 4
           END, created_at ASC`,
        [req.tenant_id]
      );
      res.json({ success: true, queues });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
