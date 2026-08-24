import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';
import { verifyTelegramInitData } from '../shared.js';

export default function tmaRoutes(pool) {
  const router = Router();
  const DAY_NAMES = { 1:'Dushanba', 2:'Seshanba', 3:'Chorshanba', 4:'Payshanba', 5:'Juma', 6:'Shanba', 7:'Yakshanba' };

  // Barcha TMA endpointlari uchun Telegram autentifikatsiyasi majburiy —
  // bemor identifikatori faqat imzolangan initData'dan olinadi (header/query orqali soxtalashtirib bo'lmaydi)
  router.use(verifyTelegramInitData);

  // Klinikani Telegram deep-link start_param yoki oshkora clinic code orqali
  // tanlaymiz. Bu qiymat vakolat bermaydi: keyingi har bir query bir vaqtning
  // o'zida tenant_id va tasdiqlangan Telegram ID bilan cheklanadi.
  router.use(async (req, res, next) => {
    try {
      const startParam = String(req.telegramStartParam || '').replace(/^clinic[_:-]/i, '');
      const clinicRef = startParam || req.headers['x-clinic-code'];
      const fallback = process.env.NODE_ENV === 'production' ? null : 'default';
      const reference = clinicRef || fallback;
      if (!reference) {
        return res.status(400).json({ success: false, error: 'Klinika kodi talab qilinadi' });
      }

      const result = await pool.query(
        `SELECT id, code FROM tenants
         WHERE status = 'active' AND (LOWER(code) = LOWER($1) OR id = $1)
         LIMIT 1`,
        [String(reference)]
      );
      const tenant = result.rows[0];
      if (!tenant) return res.status(404).json({ success: false, error: 'Klinika topilmadi' });

      req.tenant_id = tenant.id;
      res.setHeader('x-tenant-id', tenant.id);
      next();
    } catch (e) { safeError(res, e); }
  });

  async function q(sql, params = []) {
    const r = await pool.query(sql, params);
    return /^SELECT/i.test(sql.trim()) ? r.rows : r;
  }
  async function qGet(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  }

  // Bemor identifikatori faqat tekshirilgan Telegram initData'dan (soxtalashtirib bo'lmaydi)
  function getTelegramId(req) {
    return req.telegramUser?.id?.toString() || '';
  }

  function getTenantId(req) {
    return req.tenant_id;
  }

  // ===== Sync/Link Telegram user =====
  router.post('/user/sync', async (req, res) => {
    try {
      const { first_name, username, patient_name } = req.body;
      const telegram_id = getTelegramId(req);
      const tenantId = getTenantId(req);
      if (!telegram_id) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

      const existing = await qGet(
        "SELECT id, tenant_id FROM telegram_users WHERE tenant_id = $1 AND telegram_id = $2",
        [tenantId, telegram_id]
      );
      if (existing) {
        await q("UPDATE telegram_users SET first_name = $1, username = $2 WHERE tenant_id = $3 AND telegram_id = $4",
          [first_name || '', username || '', tenantId, telegram_id]);
        return res.json({ success: true, synced: true });
      }

      await q(
        `INSERT INTO telegram_users (tenant_id, telegram_id, first_name, username, chat_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, telegram_id) DO UPDATE
         SET first_name = EXCLUDED.first_name, username = EXCLUDED.username`,
        [tenantId, telegram_id, first_name || '', username || '', telegram_id]
      );
      res.json({ success: true, synced: true });
    } catch (e) { safeError(res, e); }
  });

  // ===== Get patient data by telegram_id =====
  router.get('/my-data', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      const tenantId = getTenantId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

      const patient = await qGet(
        "SELECT id, tenant_id, first_name, last_name, phone, birth_date, telegram_id, created_at FROM patients WHERE tenant_id = $1 AND telegram_id = $2",
        [tenantId, telegramId]
      );
      if (!patient) return res.json({ success: true, registered: false, patient: null });

      res.json({ success: true, registered: true, patient });
    } catch (e) { safeError(res, e); }
  });

  // ===== Register patient with telegram_id =====
  router.post('/register-patient', async (req, res) => {
    try {
      const { first_name, last_name, phone, birth_date } = req.body;
      const telegram_id = getTelegramId(req);
      const tenantId = getTenantId(req);
      if (!telegram_id || !first_name) {
        return res.status(400).json({ success: false, error: 'Telegram ID va ism talab qilinadi' });
      }

      // Find existing patient by telegram_id or phone
      let patient = await qGet(
        "SELECT id, tenant_id FROM patients WHERE tenant_id = $1 AND telegram_id = $2",
        [tenantId, telegram_id]
      );
      if (patient) {
        return res.json({ success: true, registered: true, patient });
      }

      // Check if patient already exists by phone and link
      if (phone) {
        patient = await qGet(
          "SELECT id, tenant_id FROM patients WHERE tenant_id = $1 AND phone = $2 LIMIT 1",
          [tenantId, phone]
        );
        if (patient) {
          await q("UPDATE patients SET telegram_id = $1 WHERE tenant_id = $2 AND id = $3", [telegram_id, tenantId, patient.id]);
          return res.json({ success: true, registered: true, patient });
        }
      }

      // Telegram profil shu klinika kontekstida mavjud bo'lishini ta'minlaymiz.
      await q(
        `INSERT INTO telegram_users (tenant_id, telegram_id, first_name, chat_id)
         VALUES ($1, $2, $3, $2)
         ON CONFLICT (tenant_id, telegram_id) DO NOTHING`,
        [tenantId, telegram_id, first_name]
      );

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
      const tenantId = getTenantId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

      const patient = await qGet(
        "SELECT id, first_name, last_name, phone FROM patients WHERE tenant_id = $1 AND telegram_id = $2",
        [tenantId, telegramId]
      );
      if (!patient) return res.json({ success: true, queue: [] });

      const today = new Date().toISOString().slice(0, 10);
      const queue = await q(
        `SELECT pq.id, pq.department, pq.status, pq.queue_number, pq.appointment_time, pq.created_at,
                pq.doctor AS doctor_name
         FROM patient_queue pq
         WHERE pq.tenant_id = $1
           AND (pq.patient_id = $2 OR (pq.patient_id IS NULL AND pq.patient_name ILIKE $3))
           AND DATE(pq.created_at) = $4
         ORDER BY pq.created_at DESC LIMIT 10`,
        [tenantId, patient.id, `%${patient.first_name}%`, today]
      );

      res.json({ success: true, queue });
    } catch (e) { safeError(res, e); }
  });

  // ===== Consultation history =====
  router.get('/consultations', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      const tenantId = getTenantId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

      const patient = await qGet(
        "SELECT id, first_name, last_name, phone FROM patients WHERE tenant_id = $1 AND telegram_id = $2",
        [tenantId, telegramId]
      );
      if (!patient) return res.json({ success: true, consultations: [] });

      const consultations = await q(
        `SELECT pc.id, pc.patient_name, pc.raw_text, pc.data_json, pc.created_at,
                d.first_name || ' ' || d.last_name AS doctor_name
         FROM patient_consultations pc
         LEFT JOIN doctors d ON d.id = pc.doctor_id AND d.tenant_id = pc.tenant_id
         WHERE pc.tenant_id = $1
           AND (pc.patient_id = $2 OR (pc.patient_id IS NULL AND pc.patient_name ILIKE $3))
         ORDER BY pc.created_at DESC LIMIT 20`,
        [tenantId, patient.id, `%${patient.first_name}%`]
      );

      res.json({ success: true, consultations });
    } catch (e) { safeError(res, e); }
  });

  // ===== Referrals =====
  router.get('/referrals', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      const tenantId = getTenantId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

      const patient = await qGet(
        "SELECT id, first_name, last_name, phone FROM patients WHERE tenant_id = $1 AND telegram_id = $2",
        [tenantId, telegramId]
      );
      if (!patient) return res.json({ success: true, data: [], total: 0 });

      const referrals = await q(
        `SELECT r.*, rc.name AS receiver_name
         FROM referrals r
         LEFT JOIN referral_partners rc ON rc.id::text = r.receiver_clinic_id AND rc.tenant_id = r.tenant_id
         WHERE r.tenant_id = $1 AND (r.patient_id = $2 OR (r.patient_id IS NULL AND r.patient_name ILIKE $3))
         ORDER BY r.created_at DESC LIMIT 20`,
        [tenantId, patient.id, `%${patient.first_name}%`]
      );

      res.json({ success: true, data: referrals, total: referrals.length });
    } catch (e) { safeError(res, e); }
  });

  // ===== Reminders =====
  router.get('/reminders', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      const tenantId = getTenantId(req);
      if (!telegramId) return res.json({ success: true, data: [], total: 0 });

      const reminders = await q(
        "SELECT * FROM medication_reminders WHERE tenant_id = $1 AND telegram_id = $2 AND status = 'active' ORDER BY reminder_time ASC",
        [tenantId, telegramId]
      );

      res.json({ success: true, data: reminders, total: reminders.length });
    } catch (e) { safeError(res, e); }
  });

  router.post('/reminders', async (req, res) => {
    try {
      const { medicine_name, dosage, reminder_time, notes } = req.body;
      const telegram_id = getTelegramId(req);
      const tenantId = getTenantId(req);
      if (!telegram_id || !medicine_name || !reminder_time) {
        return res.status(400).json({ success: false, error: 'Telegram ID, dori nomi va vaqt talab qilinadi' });
      }

      const result = await q(
        "INSERT INTO medication_reminders (tenant_id, telegram_id, medicine_name, dosage, reminder_time) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [tenantId, telegram_id, medicine_name, dosage || '', reminder_time]
      );

      res.json({ success: true, id: result.rows[0]?.id || result[0]?.id });
    } catch (e) { safeError(res, e); }
  });

  router.delete('/reminders/:id', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      const tenantId = getTenantId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });
      // Faqat o'z eslatmasini o'chira oladi
      await q(
        "UPDATE medication_reminders SET status = 'deleted' WHERE id = $1 AND tenant_id = $2 AND telegram_id = $3",
        [req.params.id, tenantId, telegramId]
      );
      res.json({ success: true });
    } catch (e) { safeError(res, e); }
  });

  // ===== Doctors list for TMA =====
  router.get('/doctors', async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const docs = await q(
        "SELECT id, first_name, last_name, specialty, specialization FROM doctors WHERE tenant_id = $1 AND status = 'Faol' ORDER BY first_name",
        [tenantId]
      );
      res.json({ success: true, doctors: docs });
    } catch (e) { safeError(res, e); }
  });

  // ===== Available slots for TMA =====
  router.get('/slots', async (req, res) => {
    try {
      const { doctor_id, date } = req.query;
      const tenantId = getTenantId(req);
      if (!doctor_id || !date) {
        return res.status(400).json({ success: false, error: 'doctor_id va date talab qilinadi' });
      }
      const dateObj = new Date(date + 'T00:00:00');
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ success: false, error: 'Sana formati notogri. YYYY-MM-DD ishlating' });
      }
      const dayOfWeek = dateObj.getDay() || 7;
      const doctor = await qGet(
        "SELECT id FROM doctors WHERE tenant_id = $1 AND id = $2 AND status = 'Faol'",
        [tenantId, doctor_id]
      );
      if (!doctor) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });

      const schedule = await qGet(
        "SELECT * FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3",
        [tenantId, doctor_id, dayOfWeek]
      );
      if (!schedule) {
        return res.json({ success: true, date, day_name: DAY_NAMES[dayOfWeek] || 'Noma\'lum', doctor_id, slots: [], message: 'Shifokor bu kuni ishlamaydi' });
      }
      const bookedSlots = await q(
        "SELECT appointment_time FROM bookings WHERE tenant_id = $1 AND doctor_id = $2 AND appointment_date = $3 AND status != 'Bekor qilingan'",
        [tenantId, doctor_id, date]
      );
      const bookedSet = new Set(bookedSlots.map(b => b.appointment_time));
      const slots = [];
      const [startH, startM] = schedule.start_time.split(':').map(Number);
      const [endH, endM] = schedule.end_time.split(':').map(Number);
      const duration = schedule.slot_duration || 30;
      let current = startH * 60 + startM;
      const end = endH * 60 + endM;
      while (current + duration <= end) {
        const hh = String(Math.floor(current / 60)).padStart(2, '0');
        const mm = String(current % 60).padStart(2, '0');
        const timeStr = `${hh}:${mm}`;
        slots.push({ time: timeStr, available: !bookedSet.has(timeStr) });
        current += duration;
      }
      res.json({ success: true, date, day_name: DAY_NAMES[dayOfWeek], doctor_id, slots });
    } catch (e) { safeError(res, e); }
  });

  // ===== Book appointment via TMA =====
  router.post('/book', async (req, res) => {
    try {
      const { doctor_id, patient_name, date, time } = req.body;
      const telegram_id = getTelegramId(req);
      const tenantId = getTenantId(req);
      if (!doctor_id || !patient_name || !date || !time) {
        return res.status(400).json({ success: false, error: 'doctor_id, patient_name, date va time talab qilinadi' });
      }

      const dateObj = new Date(date + 'T' + time);
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ success: false, error: 'Sana yoki vaqt formati notogri' });
      }

      const existing = await qGet(
        "SELECT id FROM bookings WHERE tenant_id = $1 AND doctor_id = $2 AND appointment_date = $3 AND appointment_time = $4 AND status != 'Bekor qilingan'",
        [tenantId, doctor_id, date, time]
      );
      if (existing) {
        return res.status(409).json({ success: false, error: 'Bu vaqt allaqachon band qilingan' });
      }

      const dayOfWeek = dateObj.getDay() || 7;
      const doctor = await qGet(
        "SELECT id, first_name, last_name, specialty FROM doctors WHERE tenant_id = $1 AND id = $2 AND status = 'Faol'",
        [tenantId, doctor_id]
      );
      if (!doctor) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });

      const schedule = await qGet(
        "SELECT * FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3",
        [tenantId, doctor_id, dayOfWeek]
      );
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
        "INSERT INTO bookings (tenant_id, doctor_id, patient_name, telegram_id, appointment_date, appointment_time, status) VALUES ($1, $2, $3, $4, $5, $6, 'Kutilmoqda') RETURNING id",
        [tenantId, doctor_id, patient_name, telegram_id || null, date, time]
      );

      const bookingId = result.rows[0]?.id || result[0]?.id;

      if (telegram_id) {
        try {
          const doctorName = doctor ? `${doctor.first_name} ${doctor.last_name || ''}`.trim() : 'Shifokor';
          const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' });
          const msg = `✅ Navbat tasdiqlandi!\n\n👤 Bemor: ${patient_name}\n👨‍⚕️ Shifokor: ${doctorName}\n📅 Sana: ${dateFormatted}\n⏰ Vaqt: ${time}\n\nIltimos, belgilangan vaqtda klinikaga yetib keling.`;
          const internalSecret = process.env.INTERNAL_SECRET;
          if (internalSecret) {
            fetch(`${req.protocol}://${req.get('host')}/api/internal/send-telegram`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
              body: JSON.stringify({ chat_id: telegram_id, text: msg, parse_mode: 'Markdown' })
            }).catch(() => {});
          } else {
            console.warn('[TMA] INTERNAL_SECRET sozlanmagan, Telegram xabari yuborilmadi');
          }
        } catch (botErr) { console.warn('[TMA] Telegram xabarnoma xatosi:', botErr.message); }
      }

      res.status(201).json({
        success: true,
        booking: { id: bookingId, doctor_id, patient_name, appointment_date: date, appointment_time: time, status: 'Kutilmoqda' }
      });
    } catch (e) {
      if (e?.code === '23505' && e?.constraint === 'bookings_active_slot_unique') {
        return res.status(409).json({ success: false, error: 'Bu vaqt allaqachon band qilingan' });
      }
      safeError(res, e);
    }
  });

  // ===== My appointments =====
  router.get('/my-appointments', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      const tenantId = getTenantId(req);
      if (!telegramId) return res.json({ success: true, appointments: [] });

      const appointments = await q(
        `SELECT b.*, d.first_name || ' ' || d.last_name AS doctor_name, d.specialty
         FROM bookings b
         LEFT JOIN doctors d ON d.id = b.doctor_id AND d.tenant_id = b.tenant_id
         WHERE b.tenant_id = $1 AND b.telegram_id = $2
         ORDER BY b.appointment_date DESC, b.appointment_time DESC LIMIT 20`,
        [tenantId, telegramId]
      );

      res.json({ success: true, appointments });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
