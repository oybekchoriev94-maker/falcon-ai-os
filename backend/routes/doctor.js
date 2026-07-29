// ============================================================
// FALCON AI OS — Shifokor ish stoli.
// Bugungi navbat, ko'rikni yakunlash, ichki yo'llanma.
// Barcha yozuvlar bir bemor kartasiga (patient_id) bog'lanadi.
// ============================================================
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

export default function doctorRoutes(pool, authMiddleware, checkRole, serverError) {
  const router = Router();

  async function q(sql, params = []) {
    const r = await pool.query(sql, params);
    return /^SELECT/i.test(sql.trim()) ? r.rows : r;
  }
  async function qGet(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  }
  const tenantOf = (req) => req.user?.tenant_id || req.tenant_id || 'default';

  // ── ESKI ENDPOINTLAR (dashboard kartalarga kerak — buzmasdan qoldirdik) ──
  router.get('/my-patients', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const patients = await q(
        "SELECT * FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY created_at DESC LIMIT 50",
        [tenantId, req.user.id]
      );
      const appointments = await q(
        "SELECT * FROM appointments WHERE tenant_id = $1 AND doctor_name = $2 ORDER BY created_at DESC LIMIT 20",
        [tenantId, req.user.name]
      );
      res.json({ success: true, patients: patients.length, consultations: patients, appointments });
    } catch (e) { serverError(res, e); }
  });

  router.get('/my-stats', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const stats = await qGet(
        "SELECT * FROM doctor_analytics WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY period_start DESC LIMIT 1",
        [tenantId, req.user.id]
      );
      const recent = await qGet(
        "SELECT COUNT(*) as c FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 AND date(created_at) = CURRENT_DATE",
        [tenantId, req.user.id]
      );
      res.json({ success: true, stats: stats || { patients_count: 0, total_revenue: 0 }, today_patients: parseInt(recent?.c || 0) });
    } catch (e) { serverError(res, e); }
  });

  // ── YANGI: BUGUNGI NAVBAT ──
  // Shifokor kirganda birinchi ko'rishi kerak bo'lgan narsa —
  // bugungi bronlar, holati bilan (kutmoqda / ko'rilmoqda / tugadi).
  router.get('/queue', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const date = String(req.query.date || '').trim() || null;
      const dateFilter = date
        ? "AND date(a.scheduled_at) = $3"
        : "AND date(a.scheduled_at) = CURRENT_DATE";
      const params = date ? [tenantId, req.user.id, date] : [tenantId, req.user.id];

      const rows = await q(
        `SELECT a.id, a.appointment_id, a.patient_id, a.patient_name, a.phone,
                a.scheduled_at, a.status, a.payment_status, a.amount::float8 AS amount,
                a.notes, s.name AS service_name,
                p.medical_record_number, p.district, p.address,
                EXISTS(SELECT 1 FROM patient_consultations c
                       WHERE c.tenant_id = a.tenant_id AND c.appointment_id = a.id) AS has_consultation
         FROM appointments a
         LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
         LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND a.doctor_id = $2 ${dateFilter}
           AND a.status NOT IN ('cancelled', 'no_show')
         ORDER BY a.scheduled_at ASC`,
        params
      );
      res.json({ success: true, date: date || new Date().toISOString().slice(0, 10), queue: rows });
    } catch (e) { serverError(res, e); }
  });

  // ── YANGI: KO'RIKNI YAKUNLASH ──
  // Shifokor xulosa (diagnoz, muolaja, dori) yozadi va appointment yopiladi.
  // Xulosa patient_consultations ga tushadi (patient_id + appointment_id bilan).
  const completeSchema = z.object({
    diagnosis: z.string().max(2000).optional(),
    procedure: z.string().max(1000).optional(),
    medicines: z.string().max(2000).optional(),
    notes: z.string().max(2000).optional(),
    raw_text: z.string().max(10000).optional(),
  });

  router.post('/visit/:appointmentId/complete', authMiddleware, checkRole('doctor'), async (req, res) => {
    const validated = completeSchema.safeParse(req.body || {});
    if (!validated.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: validated.error.flatten().fieldErrors });
    }
    const b = validated.data;

    const client = await pool.connect();
    try {
      const tenantId = tenantOf(req);
      const appointmentId = req.params.appointmentId;

      await client.query('BEGIN');

      // Bron mavjudmi va shu shifokornikimi?
      const appt = (await client.query(
        `SELECT id, patient_id, patient_name, status FROM appointments
         WHERE tenant_id = $1 AND id = $2 AND doctor_id = $3 FOR UPDATE`,
        [tenantId, appointmentId, req.user.id]
      )).rows[0];
      if (!appt) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Bron topilmadi yoki sizga tegishli emas' });
      }

      const consId = uuidv4();
      const dataJson = {
        diagnosis: b.diagnosis || '',
        procedure: b.procedure || '',
        medicines: b.medicines || '',
        notes: b.notes || '',
      };
      await client.query(
        `INSERT INTO patient_consultations (id, tenant_id, doctor_id, patient_id, appointment_id, patient_name, raw_text, data_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [consId, tenantId, req.user.id, appt.patient_id, appt.id, appt.patient_name,
         b.raw_text || '', JSON.stringify(dataJson)]
      );

      await client.query(
        `UPDATE appointments SET status = 'completed' WHERE id = $1 AND tenant_id = $2`,
        [appt.id, tenantId]
      );

      await client.query('COMMIT');
      res.json({ success: true, consultation_id: consId, appointment_id: appt.id });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      serverError(res, e);
    } finally {
      client.release();
    }
  });

  // ── YANGI: ICHKI YO'LLANMA ──
  // Ginekolog roddomga, terapevt xirurgiyaga jo'natadi.
  // to_doctor_id yoki to_department dan bittasi majburiy.
  const referralSchema = z.object({
    patient_id: z.string().uuid().optional(),
    patient_name: z.string().max(200).optional(),
    to_doctor_id: z.string().uuid().optional(),
    to_department: z.string().max(100).optional(),
    service_required: z.string().min(1).max(500),
    notes: z.string().max(2000).optional(),
  }).refine((d) => d.to_doctor_id || d.to_department, {
    message: 'to_doctor_id yoki to_department kerak',
  }).refine((d) => d.patient_id || d.patient_name, {
    message: 'patient_id yoki patient_name kerak',
  });

  router.post('/referral', authMiddleware, checkRole('doctor'), async (req, res) => {
    const validated = referralSchema.safeParse(req.body || {});
    if (!validated.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: validated.error.flatten().fieldErrors });
    }
    const b = validated.data;
    try {
      const tenantId = tenantOf(req);
      // Bemor ismini kartadan olamiz (patient_id bo'lsa)
      let patientName = b.patient_name || '';
      if (b.patient_id && !patientName) {
        const p = await qGet(
          'SELECT first_name, last_name, middle_name FROM patients WHERE tenant_id = $1 AND id = $2',
          [tenantId, b.patient_id]
        );
        if (p) patientName = `${p.last_name || ''} ${p.first_name} ${p.middle_name || ''}`.replace(/\s+/g, ' ').trim();
      }

      const id = uuidv4();
      const referralId = 'R' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();
      const qrToken = uuidv4().replace(/-/g, '');

      await q(
        `INSERT INTO referrals
           (id, tenant_id, referral_id, kind, patient_id, patient_name,
            service_required, status, qr_code_token,
            from_doctor_id, to_doctor_id, to_department,
            referring_doctor, notes)
         VALUES ($1,$2,$3,'internal',$4,$5,$6,'pending',$7,$8,$9,$10,$11,$12)`,
        [id, tenantId, referralId, b.patient_id || null, patientName || "Noma'lum",
         b.service_required, qrToken,
         req.user.id, b.to_doctor_id || null, b.to_department || null,
         req.user.name || req.user.username || null, b.notes || null]
      );

      res.status(201).json({ success: true, referral: { id, referral_id: referralId, status: 'pending' } });
    } catch (e) { serverError(res, e); }
  });

  // ── YANGI: KELGAN YO'LLANMALAR ──
  // Roddom/xirurgiya qabuli boshqa shifokordan kelgan yo'llanmalarni ko'radi.
  router.get('/referrals/incoming', authMiddleware, checkRole('doctor', 'admin', 'receptionist'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      // Shifokor uchun — o'ziga kelganlar; qabulxona/admin uchun — bo'limga kelganlar
      const status = String(req.query.status || 'pending');
      let rows;
      if (req.user.role === 'doctor') {
        rows = await q(
          `SELECT r.id, r.referral_id, r.patient_id, r.patient_name, r.service_required,
                  r.status, r.referring_doctor, r.notes, r.to_department, r.created_at,
                  p.medical_record_number, p.phone
           FROM referrals r
           LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
           WHERE r.tenant_id = $1 AND r.kind = 'internal'
             AND r.to_doctor_id = $2 AND r.status = $3
           ORDER BY r.created_at DESC LIMIT 100`,
          [tenantId, req.user.id, status]
        );
      } else {
        const dept = String(req.query.department || '').trim();
        const deptFilter = dept ? 'AND r.to_department ILIKE $3' : '';
        const params = dept ? [tenantId, status, `%${dept}%`] : [tenantId, status];
        rows = await q(
          `SELECT r.id, r.referral_id, r.patient_id, r.patient_name, r.service_required,
                  r.status, r.referring_doctor, r.notes, r.to_department, r.created_at,
                  p.medical_record_number, p.phone
           FROM referrals r
           LEFT JOIN patients p ON p.id = r.patient_id AND p.tenant_id = r.tenant_id
           WHERE r.tenant_id = $1 AND r.kind = 'internal' AND r.status = $2 ${deptFilter}
           ORDER BY r.created_at DESC LIMIT 100`,
          params
        );
      }
      res.json({ success: true, referrals: rows });
    } catch (e) { serverError(res, e); }
  });

  return router;
}
