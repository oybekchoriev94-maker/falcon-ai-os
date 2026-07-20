import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';
import { verifyTelegramAuth } from '../shared.js';

export default function tmaRoutes(pool) {
  const router = Router();

  async function q(sql, params = []) {
    const r = await pool.query(sql, params);
    return /^SELECT/i.test(sql.trim()) ? r.rows : r;
  }
  async function qGet(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  }

  function getTelegramId(req) {
    return req.telegramUser?.id?.toString() ||
      req.headers['x-telegram-id'] ||
      req.query.telegram_id ||
      req.body?.telegram_id ||
      '';
  }

  // ===== Sync/Link Telegram user =====
  router.post('/user/sync', async (req, res) => {
    try {
      const { telegram_id, first_name, username, patient_name } = req.body;
      if (!telegram_id) return res.status(400).json({ success: false, error: 'telegram_id talab qilinadi' });

      const existing = await qGet("SELECT id, tenant_id FROM telegram_users WHERE telegram_id = $1", [telegram_id]);
      if (existing) {
        await q("UPDATE telegram_users SET first_name = $1, username = $2 WHERE telegram_id = $3",
          [first_name || '', username || '', telegram_id]);
        return res.json({ success: true, synced: true });
      }

      // Find tenant by looking up if this user already has a patient record
      let tenantId = 'default';
      const patientByPhone = await qGet("SELECT tenant_id FROM patients WHERE phone = $1 LIMIT 1", [req.body.phone || '']);
      if (patientByPhone) tenantId = patientByPhone.tenant_id;

      await q(
        "INSERT INTO telegram_users (tenant_id, telegram_id, first_name, username, chat_id) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (telegram_id) DO UPDATE SET first_name = EXCLUDED.first_name, username = EXCLUDED.username",
        [tenantId, telegram_id, first_name || '', username || '', telegram_id]
      );
      res.json({ success: true, synced: true });
    } catch (e) { safeError(res, e); }
  });

  // ===== Get patient data by telegram_id =====
  router.get('/my-data', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

      const patient = await qGet("SELECT id, tenant_id, first_name, last_name, phone, birth_date, telegram_id, created_at FROM patients WHERE telegram_id = $1", [telegramId]);
      if (!patient) return res.json({ success: true, registered: false, patient: null });

      res.json({ success: true, registered: true, patient });
    } catch (e) { safeError(res, e); }
  });

  // ===== Register patient with telegram_id =====
  router.post('/register-patient', async (req, res) => {
    try {
      const { telegram_id, first_name, last_name, phone, birth_date } = req.body;
      if (!telegram_id || !first_name) {
        return res.status(400).json({ success: false, error: 'telegram_id va first_name talab qilinadi' });
      }

      // Find existing patient by telegram_id or phone
      let patient = await qGet("SELECT id, tenant_id FROM patients WHERE telegram_id = $1", [telegram_id]);
      if (patient) {
        return res.json({ success: true, registered: true, patient });
      }

      // Check if patient already exists by phone and link
      if (phone) {
        patient = await qGet("SELECT id, tenant_id FROM patients WHERE phone = $1 LIMIT 1", [phone]);
        if (patient) {
          await q("UPDATE patients SET telegram_id = $1 WHERE id = $2", [telegram_id, patient.id]);
          return res.json({ success: true, registered: true, patient });
        }
      }

      // Verify telegram user exists or create one
      let telegramUser = await qGet("SELECT tenant_id FROM telegram_users WHERE telegram_id = $1", [telegram_id]);
      const tenantId = telegramUser?.tenant_id || req.headers['x-tenant-id'] || 'default';

      // Create new patient
      const id = uuidv4();
      await q(
        "INSERT INTO patients (id, tenant_id, first_name, last_name, phone, birth_date, telegram_id) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [id, tenantId, first_name, last_name || '', phone || '', birth_date || null, telegram_id]
      );

      res.json({
        success: true, registered: true,
        patient: { id, tenant_id: tenantId, first_name, last_name, phone, birth_date, telegram_id }
      });
    } catch (e) { safeError(res, e); }
  });

  // ===== Current queue status =====
  router.get('/my-queue', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

      const patient = await qGet("SELECT id, first_name, last_name, phone FROM patients WHERE telegram_id = $1", [telegramId]);
      if (!patient) return res.json({ success: true, queue: [] });

      const today = new Date().toISOString().slice(0, 10);
      const queue = await q(
        `SELECT pq.id, pq.department, pq.status, pq.priority, pq.appointment_time, pq.created_at,
                d.first_name || ' ' || d.last_name AS doctor_name
         FROM patient_queue pq
         LEFT JOIN doctors d ON d.id::text = pq.doctor_id
         WHERE pq.patient_name ILIKE $1 AND DATE(pq.created_at) = $2
         ORDER BY pq.created_at DESC LIMIT 10`,
        [`%${patient.first_name}%`, today]
      );

      res.json({ success: true, queue });
    } catch (e) { safeError(res, e); }
  });

  // ===== Consultation history =====
  router.get('/consultations', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

      const patient = await qGet("SELECT id, first_name, last_name, phone FROM patients WHERE telegram_id = $1", [telegramId]);
      if (!patient) return res.json({ success: true, consultations: [] });

      const consultations = await q(
        `SELECT pc.id, pc.patient_name, pc.raw_text, pc.data_json, pc.created_at,
                d.first_name || ' ' || d.last_name AS doctor_name
         FROM patient_consultations pc
         LEFT JOIN doctors d ON d.id = pc.doctor_id
         WHERE pc.patient_name ILIKE $1
         ORDER BY pc.created_at DESC LIMIT 20`,
        [`%${patient.first_name}%`]
      );

      res.json({ success: true, consultations });
    } catch (e) { safeError(res, e); }
  });

  // ===== Referrals =====
  router.get('/referrals', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

      const patient = await qGet("SELECT id, first_name, last_name, phone FROM patients WHERE telegram_id = $1", [telegramId]);
      if (!patient) return res.json({ success: true, data: [], total: 0 });

      const referrals = await q(
        `SELECT r.*, rc.name AS receiver_name
         FROM referrals r
         LEFT JOIN referral_partners rc ON rc.id::text = r.receiver_clinic_id
         WHERE r.patient_name ILIKE $1 OR r.patient_id = $2
         ORDER BY r.created_at DESC LIMIT 20`,
        [`%${patient.first_name}%`, patient.id]
      );

      res.json({ success: true, data: referrals, total: referrals.length });
    } catch (e) { safeError(res, e); }
  });

  // ===== Reminders =====
  router.get('/reminders', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      if (!telegramId) return res.json({ success: true, data: [], total: 0 });

      const reminders = await q(
        "SELECT * FROM medication_reminders WHERE telegram_id = $1 AND status = 'active' ORDER BY reminder_time ASC",
        [telegramId]
      );

      res.json({ success: true, data: reminders, total: reminders.length });
    } catch (e) { safeError(res, e); }
  });

  router.post('/reminders', async (req, res) => {
    try {
      const { telegram_id, medicine_name, dosage, reminder_time, notes } = req.body;
      if (!telegram_id || !medicine_name || !reminder_time) {
        return res.status(400).json({ success: false, error: 'telegram_id, medicine_name va reminder_time talab qilinadi' });
      }

      const user = await qGet("SELECT tenant_id FROM telegram_users WHERE telegram_id = $1", [telegram_id]);
      const tenantId = user?.tenant_id || 'default';

      const result = await q(
        "INSERT INTO medication_reminders (tenant_id, telegram_id, medicine_name, dosage, reminder_time) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [tenantId, telegram_id, medicine_name, dosage || '', reminder_time]
      );

      res.json({ success: true, id: result.rows[0]?.id || result[0]?.id });
    } catch (e) { safeError(res, e); }
  });

  router.delete('/reminders/:id', async (req, res) => {
    try {
      await q("UPDATE medication_reminders SET status = 'deleted' WHERE id = $1", [req.params.id]);
      res.json({ success: true });
    } catch (e) { safeError(res, e); }
  });

  // ===== Book appointment via TMA =====
  router.post('/book', async (req, res) => {
    try {
      const { doctor_id, patient_name, telegram_id, date, time } = req.body;
      if (!doctor_id || !patient_name || !date || !time) {
        return res.status(400).json({ success: false, error: 'doctor_id, patient_name, date va time talab qilinadi' });
      }

      const dateObj = new Date(date + 'T' + time);
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ success: false, error: 'Sana yoki vaqt formati notogri' });
      }

      const existing = await qGet(
        "SELECT id FROM bookings WHERE doctor_id = $1 AND appointment_date = $2 AND appointment_time = $3 AND status != 'Bekor qilingan'",
        [doctor_id, date, time]
      );
      if (existing) {
        return res.status(409).json({ success: false, error: 'Bu vaqt allaqachon band qilingan' });
      }

      const dayOfWeek = dateObj.getDay() || 7;
      const schedule = await qGet("SELECT * FROM doctor_schedules WHERE doctor_id = $1 AND day_of_week = $2", [doctor_id, dayOfWeek]);
      if (!schedule) {
        return res.status(400).json({ success: false, error: 'Shifokor bu kuni ishlamaydi' });
      }

      const timeMinutes = time.split(':').reduce((h, m) => parseInt(h) * 60 + parseInt(m), 0);
      const startMinutes = schedule.start_time.split(':').reduce((h, m) => parseInt(h) * 60 + parseInt(m), 0);
      const endMinutes = schedule.end_time.split(':').reduce((h, m) => parseInt(h) * 60 + parseInt(m), 0);
      if (timeMinutes < startMinutes || timeMinutes + (schedule.slot_duration || 30) > endMinutes) {
        return res.status(400).json({ success: false, error: 'Bu vaqt ish soatlaridan tashqari' });
      }

      const result = await q(
        "INSERT INTO bookings (doctor_id, patient_name, telegram_id, appointment_date, appointment_time, status) VALUES ($1, $2, $3, $4, $5, 'Kutilmoqda') RETURNING id",
        [doctor_id, patient_name, telegram_id || null, date, time]
      );

      const bookingId = result.rows[0]?.id || result[0]?.id;

      if (telegram_id) {
        try {
          const doctor = await qGet("SELECT first_name, last_name, specialty FROM doctors WHERE id = $1", [doctor_id]);
          const doctorName = doctor ? `${doctor.first_name} ${doctor.last_name || ''}`.trim() : 'Shifokor';
          const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' });
          const msg = `✅ Navbat tasdiqlandi!\n\n👤 Bemor: ${patient_name}\n👨‍⚕️ Shifokor: ${doctorName}\n📅 Sana: ${dateFormatted}\n⏰ Vaqt: ${time}\n\nIltimos, belgilangan vaqtda klinikaga yetib keling.`;
          fetch(`${req.protocol}://${req.get('host')}/api/internal/send-telegram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET || 'falcon-internal' },
            body: JSON.stringify({ chat_id: telegram_id, text: msg, parse_mode: 'Markdown' })
          }).catch(() => {});
        } catch (botErr) { console.warn('[TMA] Telegram xabarnoma xatosi:', botErr.message); }
      }

      res.status(201).json({
        success: true,
        booking: { id: bookingId, doctor_id, patient_name, appointment_date: date, appointment_time: time, status: 'Kutilmoqda' }
      });
    } catch (e) { safeError(res, e); }
  });

  // ===== My appointments =====
  router.get('/my-appointments', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      if (!telegramId) return res.json({ success: true, appointments: [] });

      const appointments = await q(
        `SELECT b.*, d.first_name || ' ' || d.last_name AS doctor_name, d.specialty
         FROM bookings b
         LEFT JOIN doctors d ON d.id = b.doctor_id
         WHERE b.telegram_id = $1
         ORDER BY b.appointment_date DESC, b.appointment_time DESC LIMIT 20`,
        [telegramId]
      );

      res.json({ success: true, appointments });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
