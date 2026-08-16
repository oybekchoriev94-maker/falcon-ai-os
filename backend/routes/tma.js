import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';
import { verifyTelegramInitData } from '../shared.js';
import { checkInAppointment } from '../services/appointment-checkin.js';

// bookingCore — booking.js bilan BIR XIL bron yozish/vaqt hisoblash
// mantig'i (backend/routes/booking.js: createBookingCore). Shu tufayli
// Telegram orqali yozilgan bemor registratura va kiosk bilan bir xil
// `appointments` jadvalida, bir xil navbatda ko'rinadi.
export default function tmaRoutes(pool, bookingCore) {
  const router = Router();
  const DAY_NAMES = { 1:'Dushanba', 2:'Seshanba', 3:'Chorshanba', 4:'Payshanba', 5:'Juma', 6:'Shanba', 7:'Yakshanba' };

  // Barcha TMA endpointlari uchun Telegram autentifikatsiyasi majburiy —
  // bemor identifikatori faqat imzolangan initData'dan olinadi (header/query orqali soxtalashtirib bo'lmaydi)
  router.use(verifyTelegramInitData);

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

  // tenant_id — telegram_users yozuvidan; hali sync bo'lmagan bo'lsa 'default'
  // (production hozircha yagona tenant, booking.js'dagi resolvePublicTenant bilan bir xil taxmin)
  async function getTenantId(telegramId) {
    const row = await qGet('SELECT tenant_id FROM telegram_users WHERE telegram_id = $1', [telegramId]);
    return row?.tenant_id || 'default';
  }

  // Bemor kartasini telegram_id orqali topadi — check-in va navbat uchun kerak
  async function getPatientByTelegram(telegramId) {
    return qGet('SELECT id, tenant_id, first_name, last_name, phone FROM patients WHERE telegram_id = $1', [telegramId]);
  }

  // ===== Sync/Link Telegram user =====
  router.post('/user/sync', async (req, res) => {
    try {
      const { first_name, username, patient_name } = req.body;
      const telegram_id = getTelegramId(req);
      if (!telegram_id) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

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
      const { first_name, last_name, phone, birth_date } = req.body;
      const telegram_id = getTelegramId(req);
      if (!telegram_id || !first_name) {
        return res.status(400).json({ success: false, error: 'Telegram ID va ism talab qilinadi' });
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

  // ===== Current queue status — bugungi appointments, kiosk/registratura bilan bir xil manba =====
  router.get('/my-queue', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });

      const patient = await getPatientByTelegram(telegramId);
      if (!patient) return res.json({ success: true, queue: [] });

      const rows = await q(
        `SELECT a.id, a.access_code, a.status, a.scheduled_at, a.arrived_at,
                a.doctor_name, d.specialization AS department, s.name AS service_name
           FROM appointments a
           LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
           LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1 AND a.patient_id = $2
            AND a.scheduled_at::date = CURRENT_DATE
            AND a.status NOT IN ('cancelled', 'no_show')
          ORDER BY a.scheduled_at ASC LIMIT 10`,
        [patient.tenant_id, patient.id]
      );

      const queue = rows.map((r) => ({
        id: r.id,
        access_code: r.access_code,
        department: r.department,
        doctor_name: r.doctor_name,
        service_name: r.service_name,
        // Frontend eski nomlarni kutadi — moslikni saqlaymiz
        status: r.status === 'in_progress' ? 'active' : (r.arrived_at ? 'waiting' : 'scheduled'),
        arrived: !!r.arrived_at,
        appointment_time: new Date(r.scheduled_at).toISOString().slice(11, 16),
        created_at: r.scheduled_at,
      }));

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
      const { medicine_name, dosage, reminder_time, notes } = req.body;
      const telegram_id = getTelegramId(req);
      if (!telegram_id || !medicine_name || !reminder_time) {
        return res.status(400).json({ success: false, error: 'Telegram ID, dori nomi va vaqt talab qilinadi' });
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
      const telegramId = getTelegramId(req);
      if (!telegramId) return res.status(400).json({ success: false, error: 'Telegram ID topilmadi' });
      // Faqat o'z eslatmasini o'chira oladi
      await q("UPDATE medication_reminders SET status = 'deleted' WHERE id = $1 AND telegram_id = $2", [req.params.id, telegramId]);
      res.json({ success: true });
    } catch (e) { safeError(res, e); }
  });

  // ===== Doctors list for TMA =====
  router.get('/doctors', async (req, res) => {
    try {
      const docs = await q("SELECT id, first_name, last_name, specialty, specialization FROM doctors WHERE status = 'Faol' ORDER BY first_name");
      res.json({ success: true, doctors: docs });
    } catch (e) { safeError(res, e); }
  });

  // ===== Services list for TMA (bron uchun xizmat tanlash) =====
  router.get('/services', async (req, res) => {
    try {
      const rows = await q(
        `SELECT id, name, category, specialty, price::float8 AS price, duration_min
           FROM services_catalog WHERE active = TRUE ORDER BY category NULLS LAST, name`
      );
      res.json({ success: true, services: rows });
    } catch (e) { safeError(res, e); }
  });

  // ===== Available slots for TMA — booking.js bilan bir xil hisoblash =====
  router.get('/slots', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      const { doctor_id, date, service_id } = req.query;
      if (!doctor_id || !date) {
        return res.status(400).json({ success: false, error: 'doctor_id va date talab qilinadi' });
      }
      const dateObj = new Date(date + 'T00:00:00');
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ success: false, error: 'Sana formati notogri. YYYY-MM-DD ishlating' });
      }
      const tenantId = await getTenantId(telegramId);
      const r = await bookingCore.computeSlots(tenantId, doctor_id, date, service_id ? [service_id] : []);
      const dayOfWeek = dateObj.getDay() || 7;
      res.status(r.status).json({ ...r.body, day_name: DAY_NAMES[dayOfWeek] });
    } catch (e) { safeError(res, e); }
  });

  // ===== Book appointment via TMA — booking.js bilan BIR XIL yozuv =====
  router.post('/book', async (req, res) => {
    try {
      const { doctor_id, service_id, patient_name, date, time, payment_method } = req.body;
      const telegram_id = getTelegramId(req);
      if (!telegram_id) return res.status(401).json({ success: false, error: 'Telegram ID topilmadi' });
      if (!doctor_id || !service_id || !patient_name || !date || !time) {
        return res.status(400).json({ success: false, error: 'doctor_id, service_id, patient_name, date va time talab qilinadi' });
      }

      const scheduledAt = new Date(`${date}T${time}:00`);
      if (isNaN(scheduledAt.getTime())) {
        return res.status(400).json({ success: false, error: 'Sana yoki vaqt formati notogri' });
      }

      const tenantId = await getTenantId(telegram_id);
      // Bemorning saqlangan telefoni bor bo'lsa — shundan foydalanamiz
      // (kartani telefon bo'yicha bog'lash uchun), client kiritgan
      // qiymatga ishonmaymiz.
      const patient = await getPatientByTelegram(telegram_id);

      await bookingCore.handleCreate(req, res, tenantId, {
        patient_name,
        phone: patient?.phone || null,
        patient_id: patient?.id || null,
        doctor_id,
        service_id,
        scheduled_at: scheduledAt.toISOString(),
        payment_method: payment_method === 'online' ? 'online' : 'cashier',
        source: 'telegram',
        telegram_id,
      });
    } catch (e) { safeError(res, e); }
  });

  // ===== Men keldim — Telegram identifikatori orqali, kod kiritish shart emas =====
  // Kiosk/registratura kirish kodi so'raydi, chunki ularda bemor kim ekani
  // noma'lum. Bu yerda esa Telegram initData allaqachon tasdiqlangan —
  // shuning uchun bemorning BUGUNGI, hali kelmagan eng yaqin bronini
  // to'g'ridan-to'g'ri belgilaymiz.
  router.post('/checkin', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      if (!telegramId) return res.status(401).json({ success: false, error: 'Telegram ID topilmadi' });
      const patient = await getPatientByTelegram(telegramId);
      if (!patient) return res.status(404).json({ success: false, error: 'Bemor kartasi topilmadi' });

      let appointmentId = req.body?.appointment_id || null;
      if (!appointmentId) {
        const next = await qGet(
          `SELECT id FROM appointments
            WHERE tenant_id = $1 AND patient_id = $2
              AND scheduled_at::date = CURRENT_DATE
              AND status IN ('scheduled', 'confirmed')
              AND arrived_at IS NULL
            ORDER BY scheduled_at ASC LIMIT 1`,
          [patient.tenant_id, patient.id]
        );
        if (!next) return res.status(404).json({ success: false, error: 'Bugungi faol bron topilmadi' });
        appointmentId = next.id;
      }

      const r = await checkInAppointment(pool, {
        tenantId: patient.tenant_id,
        appointmentId,
        source: 'telegram',
      });
      res.json({ success: true, already: r.already, appointment: r.appointment });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ success: false, error: e.message, code: e.code });
      safeError(res, e);
    }
  });

  // ===== My appointments — appointments jadvalidan, registratura ko'rgani bilan bir xil =====
  router.get('/my-appointments', async (req, res) => {
    try {
      const telegramId = getTelegramId(req);
      if (!telegramId) return res.json({ success: true, appointments: [] });

      const patient = await getPatientByTelegram(telegramId);
      if (!patient) return res.json({ success: true, appointments: [] });

      const rows = await q(
        `SELECT a.id, a.access_code, a.status, a.payment_status, a.scheduled_at, a.arrived_at,
                a.amount::float8 AS amount, a.doctor_name, d.specialty, d.specialization,
                s.name AS service_name
           FROM appointments a
           LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
           LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1 AND a.patient_id = $2
          ORDER BY a.scheduled_at DESC LIMIT 20`,
        [patient.tenant_id, patient.id]
      );

      const appointments = rows.map((r) => ({
        id: r.id,
        access_code: r.access_code,
        doctor_name: r.doctor_name,
        specialty: r.specialty || r.specialization,
        service_name: r.service_name,
        status: r.status,
        arrived: !!r.arrived_at,
        payment_status: r.payment_status,
        amount: r.amount,
        appointment_date: r.scheduled_at,
        appointment_time: new Date(r.scheduled_at).toISOString().slice(11, 16),
      }));

      res.json({ success: true, appointments });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
