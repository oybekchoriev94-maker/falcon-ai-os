// ============================================================
// FALCON AI OS — Statsionar (Inpatient) Routes
// Palatalar, koykalar, yotqizish, chiqarish, kunlik kuzatuv
// Multi-tenant: tenant_id JWT token dan olinadi
// ============================================================

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { upsertPatientByPhone } from '../services/patient-store.js';

export default function(pool, authMiddleware, checkRole, upload) {
  const router = Router();

  // ─── DB helperlar ────────────────────────────────────────
  async function q(sql, params = []) {
    const result = await pool.query(sql, params);
    if (/^SELECT/i.test(sql.trim())) return result.rows;
    return result;
  }
  async function qGet(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
  }

  // ─── Clinic ID ni JWT dan olish ─────────────────────────
  function getTenantId(req) {
    return req.user?.tenant_id || req.tenant_id || 'default';
  }

  // ============================================================
  // WARDS (Palatalar)
  // ============================================================

  // GET /api/inpatient/wards — Barcha palatalar ro'yxati
  router.get('/inpatient/wards', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const wards = await q(
        `SELECT w.*,
          (SELECT COUNT(*) FROM beds b WHERE b.ward_id = w.id) as total_beds,
          (SELECT COUNT(*) FROM beds b WHERE b.ward_id = w.id AND b.status = 'free') as free_beds,
          (SELECT COUNT(*) FROM beds b WHERE b.ward_id = w.id AND b.status = 'occupied') as occupied_beds
         FROM wards w WHERE w.tenant_id = $1 ORDER BY w.name`,
        [tenantId]
      );
      res.json({ success: true, data: wards });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/inpatient/wards — Yangi palata qo'shish
  router.post('/inpatient/wards', authMiddleware, checkRole('ceo', 'admin'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const { name, floor, room_number, bed_count, department } = req.body;
      if (!name) return res.status(400).json({ success: false, error: 'Palata nomi majburiy' });

      const id = uuidv4();
      await q(
        `INSERT INTO wards (id, tenant_id, name, floor, room_number, bed_count, department) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, tenantId, name, floor || null, room_number || null, bed_count || 0, department || null]
      );

      // Avtomatik koykalar yaratish
      const totalBeds = parseInt(bed_count) || 0;
      for (let i = 1; i <= totalBeds; i++) {
        const bedId = uuidv4();
        await q(
          `INSERT INTO beds (id, ward_id, bed_number, tenant_id) VALUES ($1,$2,$3,$4)`,
          [bedId, id, String(i), tenantId]
        );
      }

      res.json({ success: true, data: { id }, message: 'Palata qo\'shildi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PATCH /inpatient/wards/:id — Palatani tahrirlash
  router.patch('/inpatient/wards/:id', authMiddleware, checkRole('ceo', 'admin'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const ward = await qGet('SELECT * FROM wards WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
      if (!ward) return res.status(404).json({ success: false, error: 'Palata topilmadi' });

      const { name, floor, room_number, bed_count, department, status } = req.body;
      const updates = [];
      const params = [];
      let paramIndex = 1;

      if (name !== undefined) { updates.push(`name = $${paramIndex++}`); params.push(name); }
      if (floor !== undefined) { updates.push(`floor = $${paramIndex++}`); params.push(floor); }
      if (room_number !== undefined) { updates.push(`room_number = $${paramIndex++}`); params.push(room_number); }
      if (department !== undefined) { updates.push(`department = $${paramIndex++}`); params.push(department); }
      if (status !== undefined) { updates.push(`status = $${paramIndex++}`); params.push(status); }

      if (updates.length === 0) return res.status(400).json({ success: false, error: 'O\'zgarish kiritilmadi' });

      params.push(req.params.id);
      await q(`UPDATE wards SET ${updates.join(', ')} WHERE id = $${paramIndex}`, params);

      // Agar bed_count o'zgargan bo'lsa, koykalarni moslash
      if (bed_count !== undefined && parseInt(bed_count) !== ward.bed_count) {
        const currentBedsResult = await q('SELECT COUNT(*) as cnt FROM beds WHERE ward_id = $1', [ward.id]);
        const currentBeds = currentBedsResult[0].cnt;
        if (parseInt(bed_count) > currentBeds) {
          for (let i = currentBeds + 1; i <= parseInt(bed_count); i++) {
            await q('INSERT INTO beds (id, ward_id, bed_number, tenant_id) VALUES ($1,$2,$3,$4)', [uuidv4(), ward.id, String(i), tenantId]);
          }
        }
      }

      res.json({ success: true, message: 'Palata yangilandi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // BEDS (Koykalar)
  // ============================================================

  // GET /api/inpatient/wards/:wardId/beds — Palatadagi koykalar
  router.get('/inpatient/wards/:wardId/beds', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const wardCheck = await qGet('SELECT id FROM wards WHERE id = $1 AND tenant_id = $2', [req.params.wardId, tenantId]);
      if (!wardCheck) return res.status(404).json({ success: false, error: 'Palata topilmadi yoki huquq yo\'q' });

      const beds = await q(
        `SELECT b.*, a.patient_name, a.admission_date, a.diagnosis_initial,
                a.attending_doctor_name, a.id as admission_id
         FROM beds b
         LEFT JOIN admissions a ON a.bed_id = b.id AND a.status = 'active'
         WHERE b.ward_id = $1
         ORDER BY b.bed_number`,
        [req.params.wardId]
      );
      res.json({ success: true, data: beds });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PATCH /api/inpatient/beds/:id — Koyka statusini o'zgartirish
  router.patch('/inpatient/beds/:id', authMiddleware, checkRole('ceo', 'admin', 'receptionist'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const bedCheck = await qGet('SELECT b.id FROM beds b JOIN wards w ON w.id = b.ward_id WHERE b.id = $1 AND w.tenant_id = $2', [req.params.id, tenantId]);
      if (!bedCheck) return res.status(404).json({ success: false, error: 'Koyka topilmadi yoki huquq yo\'q' });

      const { status } = req.body;
      if (!status || !['free', 'occupied', 'maintenance', 'cleaning'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Noto\'g\'ri status' });
      }
      await q('UPDATE beds SET status = $1 WHERE id = $2', [status, req.params.id]);
      res.json({ success: true, message: 'Koyka statusi yangilandi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // ADMISSIONS (Yotqizish)
  // ============================================================

  // GET /api/inpatient/admissions — Aktiv yotqizilgan bemorlar
  router.get('/inpatient/admissions', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const { status, ward_id, date } = req.query;
      let sql = `SELECT a.*, w.name as ward_name, w.floor, w.room_number, b.bed_number
                 FROM admissions a
                 LEFT JOIN wards w ON w.id = a.ward_id
                 LEFT JOIN beds b ON b.id = a.bed_id
                 WHERE a.tenant_id = $1`;
      const params = [tenantId];
      let paramIndex = 2;

      if (status) { sql += ` AND a.status = $${paramIndex++}`; params.push(status); }
      else { sql += " AND a.status = 'active'"; }
      if (ward_id) { sql += ` AND a.ward_id = $${paramIndex++}`; params.push(ward_id); }
      if (date) { sql += ` AND DATE(a.admission_date) = $${paramIndex++}`; params.push(date); }

      sql += ' ORDER BY a.admission_date DESC';

      res.json({ success: true, data: await q(sql, params) });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/inpatient/admissions/:id — Bitta yotqizish batafsil
  router.get('/inpatient/admissions/:id', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const admission = await qGet(
        `SELECT a.*, w.name as ward_name, w.floor, w.room_number, b.bed_number,
                d.epicrisis_text, d.discharge_date, d.discharge_type, d.icd10_code,
                d.recommendations, d.follow_up_date
         FROM admissions a
         LEFT JOIN wards w ON w.id = a.ward_id
         LEFT JOIN beds b ON b.id = a.bed_id
         LEFT JOIN discharges d ON d.admission_id = a.id
         WHERE a.id = $1 AND a.tenant_id = $2`,
        [req.params.id, tenantId]
      );
      if (!admission) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

      // Kunlik kuzatuvlar
      const notes = await q(
        'SELECT * FROM daily_notes WHERE admission_id = $1 ORDER BY date DESC, created_at DESC',
        [req.params.id]
      );

      // Dorilar
      const prescriptions = await q(
        'SELECT * FROM prescriptions WHERE admission_id = $1 ORDER BY created_at DESC',
        [req.params.id]
      );

      // Xizmatlar
      const services = await q(
        'SELECT * FROM inpatient_services WHERE admission_id = $1 ORDER BY date DESC',
        [req.params.id]
      );

      res.json({ success: true, data: { ...admission, notes, prescriptions, services } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/inpatient/admissions — Yangi bemorni yotqizish
  router.post('/inpatient/admissions', authMiddleware, checkRole('ceo', 'admin', 'doctor', 'receptionist'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const {
        patient_name, patient_phone, patient_id: bodyPatientId,
        appointment_id,
        ward_id, bed_id,
        admission_type, diagnosis_initial, admission_date,
        attending_doctor_id, attending_doctor_name,
        payment_type, notes
      } = req.body;

      if (!patient_name) return res.status(400).json({ success: false, error: 'Bemor ismi majburiy' });

      // Bemor kartasi: berilmagan bo'lsa telefon bo'yicha upsert.
      // Statsionar tarixi ham bir kartada yig'iladi (poliklinik bilan bir joyda).
      let patientId = bodyPatientId || null;
      if (!patientId && patient_phone) {
        patientId = await upsertPatientByPhone(pool, tenantId, {
          phone: patient_phone,
          patient_name,
        });
      }

      // Koyka bandligini tekshirish (tenant izolyatsiya bilan)
      if (bed_id) {
        const bed = await qGet(
          'SELECT b.* FROM beds b JOIN wards w ON w.id = b.ward_id WHERE b.id = $1 AND w.tenant_id = $2',
          [bed_id, tenantId]
        );
        if (!bed) return res.status(400).json({ success: false, error: 'Koyka topilmadi' });
        if (bed.status === 'occupied') return res.status(400).json({ success: false, error: 'Koyka band' });
        await q('UPDATE beds SET status = $1 WHERE id = $2', ['occupied', bed_id]);
      }

      const id = uuidv4();
      await q(
        `INSERT INTO admissions (id, tenant_id, patient_id, appointment_id, patient_name, patient_phone,
           ward_id, bed_id, admission_date, admission_type, diagnosis_initial,
           attending_doctor_id, attending_doctor_name, payment_type, notes, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [id, tenantId, patientId, appointment_id || null, patient_name, patient_phone || null,
         ward_id || null, bed_id || null,
         admission_date || new Date().toISOString(),
         admission_type || 'rejali', diagnosis_initial || null,
         attending_doctor_id || null, attending_doctor_name || null,
         payment_type || 'kassa', notes || null, 'active']
      );

      res.json({ success: true, data: { id, patient_id: patientId }, message: 'Bemor yotqizildi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PATCH /api/inpatient/admissions/:id — Ma'lumotni yangilash
  router.patch('/inpatient/admissions/:id', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const admCheck = await qGet('SELECT id FROM admissions WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
      if (!admCheck) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi yoki huquq yo\'q' });

      const { diagnosis_initial, diagnosis_final, attending_doctor_id, attending_doctor_name, notes } = req.body;
      const fields = [];
      const params = [];
      let paramIndex = 1;

      if (diagnosis_initial !== undefined) { fields.push(`diagnosis_initial = $${paramIndex++}`); params.push(diagnosis_initial); }
      if (diagnosis_final !== undefined) { fields.push(`diagnosis_final = $${paramIndex++}`); params.push(diagnosis_final); }
      if (attending_doctor_id !== undefined) { fields.push(`attending_doctor_id = $${paramIndex++}`); params.push(attending_doctor_id); }
      if (attending_doctor_name !== undefined) { fields.push(`attending_doctor_name = $${paramIndex++}`); params.push(attending_doctor_name); }
      if (notes !== undefined) { fields.push(`notes = $${paramIndex++}`); params.push(notes); }

      if (fields.length === 0) return res.status(400).json({ success: false, error: 'O\'zgarish kiritilmadi' });

      params.push(req.params.id);
      await q(`UPDATE admissions SET ${fields.join(', ')} WHERE id = $${paramIndex}`, params);

      res.json({ success: true, message: 'Yangilandi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/inpatient/admissions/:id/transfer — Boshqa palataga ko'chirish
  router.post('/inpatient/admissions/:id/transfer', authMiddleware, checkRole('ceo', 'admin', 'doctor'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const { ward_id, bed_id } = req.body;
      const admission = await qGet('SELECT * FROM admissions WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
      if (!admission) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

      // Eski koykani bo'shatish
      if (admission.bed_id) {
        await q('UPDATE beds SET status = $1 WHERE id = $2', ['free', admission.bed_id]);
      }

      // Yangi koykani band qilish
      if (bed_id) {
        const bedCheck = await qGet('SELECT b.id FROM beds b JOIN wards w ON w.id = b.ward_id WHERE b.id = $1 AND w.tenant_id = $2', [bed_id, tenantId]);
        if (!bedCheck) return res.status(400).json({ success: false, error: 'Yangi koyka topilmadi' });
        await q('UPDATE beds SET status = $1 WHERE id = $2', ['occupied', bed_id]);
      }

      await q('UPDATE admissions SET ward_id = $1, bed_id = $2 WHERE id = $3',
        [ward_id || null, bed_id || null, req.params.id]);

      res.json({ success: true, message: 'Ko\'chirildi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // DAILY NOTES (Kunlik kuzatuv)
  // ============================================================

  // POST /api/inpatient/daily-notes — Kunlik kuzatuv (obhod) qo'shish
  router.post('/inpatient/daily-notes', authMiddleware, checkRole('ceo', 'admin', 'doctor'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const {
        admission_id, date, shift,
        temperature, blood_pressure, pulse, respiration, saturation,
        complaints, objective_status, treatment_plan, notes,
        raw_text, ai_summary, data_json,
      } = req.body;

      if (!admission_id) return res.status(400).json({ success: false, error: 'Admission ID majburiy' });
      const adm = await qGet(
        'SELECT id, patient_id FROM admissions WHERE id = $1 AND tenant_id = $2',
        [admission_id, tenantId]
      );
      if (!adm) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

      const id = uuidv4();
      await q(
        `INSERT INTO daily_notes (id, tenant_id, admission_id, patient_id, doctor_id, doctor_name,
           nurse_id, nurse_name, date, shift,
           temperature, blood_pressure, pulse, respiration, saturation,
           complaints, objective_status, treatment_plan, notes,
           raw_text, ai_summary, data_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [id, tenantId, admission_id, adm.patient_id,
         req.user?.id || null, req.user?.name || null,
         null, null,
         date || new Date().toISOString().split('T')[0],
         shift || 'ertalab',
         temperature || null, blood_pressure || null,
         pulse || null, respiration || null, saturation || null,
         complaints || null, objective_status || null,
         treatment_plan || null, notes || null,
         raw_text || null, ai_summary || null,
         data_json ? JSON.stringify(data_json) : null]
      );

      res.json({ success: true, data: { id }, message: 'Kuzatuv qo\'shildi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // PRESCRIPTIONS (Dori tayinlov)
  // ============================================================

  // POST /api/inpatient/prescriptions — Dori tayinlash
  router.post('/inpatient/prescriptions', authMiddleware, checkRole('ceo', 'admin', 'doctor'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const { admission_id, medicine_name, dosage, route, frequency, start_date, end_date } = req.body;
      if (!admission_id || !medicine_name) {
        return res.status(400).json({ success: false, error: 'Admission ID va dori nomi majburiy' });
      }
      const admCheck = await qGet('SELECT id FROM admissions WHERE id = $1 AND tenant_id = $2', [admission_id, tenantId]);
      if (!admCheck) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

      const id = uuidv4();
      await q(
        `INSERT INTO prescriptions (id, admission_id, doctor_id, doctor_name,
           medicine_name, dosage, route, frequency, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, admission_id, req.user?.id || null, req.user?.name || null,
         medicine_name, dosage || null, route || 'ichish', frequency || null,
         start_date || null, end_date || null]
      );

      res.json({ success: true, data: { id }, message: 'Dori tayinlandi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // PATCH /api/inpatient/prescriptions/:id — Dori statusini o'zgartirish
  router.patch('/inpatient/prescriptions/:id', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const preCheck = await qGet('SELECT p.id FROM prescriptions p JOIN admissions a ON a.id = p.admission_id WHERE p.id = $1 AND a.tenant_id = $2', [req.params.id, tenantId]);
      if (!preCheck) return res.status(404).json({ success: false, error: 'Tayinlov topilmadi' });

      const { status } = req.body;
      if (!status || !['active', 'completed', 'cancelled'].includes(status)) {
        return res.status(400).json({ success: false, error: 'Noto\'g\'ri status' });
      }
      await q('UPDATE prescriptions SET status = $1 WHERE id = $2', [status, req.params.id]);
      res.json({ success: true, message: 'Dori statusi yangilandi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // INPATIENT SERVICES (Statsionar xizmatlar)
  // ============================================================

  // POST /api/inpatient/services — Xizmat qo'shish
  router.post('/inpatient/services', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const { admission_id, service_name, quantity, price, performed_by, performed_by_name, date } = req.body;
      if (!admission_id || !service_name || !price) {
        return res.status(400).json({ success: false, error: 'Admission ID, xizmat nomi va narx majburiy' });
      }
      const admCheck = await qGet('SELECT id FROM admissions WHERE id = $1 AND tenant_id = $2', [admission_id, tenantId]);
      if (!admCheck) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

      const qty = parseFloat(quantity) || 1;
      const total = qty * parseFloat(price);

      const id = uuidv4();
      await q(
        `INSERT INTO inpatient_services (id, admission_id, service_name, quantity, price, total, performed_by, performed_by_name, date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, admission_id, service_name, qty, parseFloat(price), total,
         performed_by || null, performed_by_name || null,
         date || new Date().toISOString().split('T')[0]]
      );

      res.json({ success: true, data: { id, total }, message: 'Xizmat qo\'shildi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // DISCHARGE (Chiqarish)
  // ============================================================

  // POST /api/inpatient/discharge — Bemorni chiqarish
  router.post('/inpatient/discharge', authMiddleware, checkRole('ceo', 'admin', 'doctor'), async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const { admission_id, discharge_date, discharge_type, diagnosis_final, icd10_code, recommendations, follow_up_date, epicrisis_text } = req.body;
      if (!admission_id) return res.status(400).json({ success: false, error: 'Admission ID majburiy' });

      const admission = await qGet('SELECT * FROM admissions WHERE id = $1 AND tenant_id = $2', [admission_id, tenantId]);
      if (!admission) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });
      if (admission.status === 'discharged') return res.status(400).json({ success: false, error: 'Bemor allaqachon chiqarilgan' });

      const id = uuidv4();
      await q(
        `INSERT INTO discharges (id, admission_id, discharge_date, discharge_type,
           diagnosis_final, icd10_code, recommendations, follow_up_date, epicrisis_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, admission_id,
         discharge_date || new Date().toISOString().split('T')[0],
         discharge_type || 'tuzalgan',
         diagnosis_final || admission.diagnosis_initial,
         icd10_code || null, recommendations || null,
         follow_up_date || null, epicrisis_text || null]
      );

      // Admission statusni 'discharged' ga o'zgartirish
      await q('UPDATE admissions SET status = $1, discharge_date = $2, diagnosis_final = $3 WHERE id = $4',
        ['discharged',
         discharge_date || new Date().toISOString().split('T')[0],
         diagnosis_final || null,
         admission_id]);

      // Koykani bo'shatish
      if (admission.bed_id) {
        await q('UPDATE beds SET status = $1 WHERE id = $2', ['free', admission.bed_id]);
      }

      res.json({ success: true, data: { id }, message: 'Bemor chiqarildi' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // DASHBOARD STATS (Statistika)
  // ============================================================

  // GET /api/inpatient/stats — Statsionar statistikasi
  router.get('/inpatient/stats', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const { period } = req.query; // today, week, month

      // Asosiy ko'rsatkichlar
      const totalBedsRow = await qGet(
        'SELECT COUNT(*) as cnt FROM beds b JOIN wards w ON w.id = b.ward_id WHERE w.tenant_id = $1',
        [tenantId]
      );
      const totalBeds = totalBedsRow ? totalBedsRow.cnt : 0;

      const freeBedsRow = await qGet(
        "SELECT COUNT(*) as cnt FROM beds b JOIN wards w ON w.id = b.ward_id WHERE w.tenant_id = $1 AND b.status = 'free'",
        [tenantId]
      );
      const freeBeds = freeBedsRow ? freeBedsRow.cnt : 0;

      const occupiedBedsRow = await qGet(
        "SELECT COUNT(*) as cnt FROM beds b JOIN wards w ON w.id = b.ward_id WHERE w.tenant_id = $1 AND b.status = 'occupied'",
        [tenantId]
      );
      const occupiedBeds = occupiedBedsRow ? occupiedBedsRow.cnt : 0;

      const activeAdmissionsRow = await qGet(
        "SELECT COUNT(*) as cnt FROM admissions WHERE tenant_id = $1 AND status = 'active'",
        [tenantId]
      );
      const activeAdmissions = activeAdmissionsRow ? activeAdmissionsRow.cnt : 0;

      // Bugungi qabul
      const today = new Date().toISOString().split('T')[0];
      const todayAdmissionsRow = await qGet(
        "SELECT COUNT(*) as cnt FROM admissions WHERE tenant_id = $1 AND DATE(admission_date) = $2",
        [tenantId, today]
      );
      const todayAdmissions = todayAdmissionsRow ? todayAdmissionsRow.cnt : 0;

      const todayDischargesRow = await qGet(
        "SELECT COUNT(*) as cnt FROM discharges WHERE DATE(discharge_date) = $1",
        [today]
      );
      const todayDischarges = todayDischargesRow ? todayDischargesRow.cnt : 0;

      // Palatalar bo'ylab bandlik
      const wardsStats = await q(
        `SELECT w.id, w.name, w.floor, w.room_number,
                COUNT(b.id) as total_beds,
                SUM(CASE WHEN b.status = 'free' THEN 1 ELSE 0 END) as free_beds,
                SUM(CASE WHEN b.status = 'occupied' THEN 1 ELSE 0 END) as occupied_beds
         FROM wards w
         LEFT JOIN beds b ON b.ward_id = w.id
         WHERE w.tenant_id = $1
         GROUP BY w.id
         ORDER BY w.name`,
        [tenantId]
      );

      const occupancyRate = totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0;

      res.json({
        success: true,
        data: {
          total_beds: totalBeds,
          free_beds: freeBeds,
          occupied_beds: occupiedBeds,
          occupancy_rate: occupancyRate,
          active_admissions: activeAdmissions,
          today_admissions: todayAdmissions,
          today_discharges: todayDischarges,
          wards: wardsStats
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/inpatient/patients — Barcha bemorlar ro'yxati (search)
  router.get('/inpatient/patients', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const { q: query } = req.query;

      let sql = `SELECT DISTINCT a.patient_id, a.patient_name, a.patient_phone,
                        MAX(a.admission_date) as last_admission,
                        COUNT(*) as total_admissions
                 FROM admissions a
                 WHERE a.tenant_id = $1`;
      const params = [tenantId];

      if (query) {
        sql += ' AND (a.patient_name LIKE $2 OR a.patient_phone LIKE $3)';
        params.push(`%${query}%`, `%${query}%`);
      }

      sql += ' GROUP BY a.patient_name ORDER BY last_admission DESC LIMIT 50';

      res.json({ success: true, data: await q(sql, params) });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // YANGI: PALATA XARITASI (koyka-koyka)
  // ============================================================

  // GET /api/inpatient/wards/board — Barcha palatalar + koykalar + kimda kim yotgan
  // Nima uchun bir endpoint: hamshira/doctor bir qarashda hammasini ko'rsin,
  // N+1 so'rovsiz. Kichik klinikada wards ~20, beds ~200 — bitta so'rov yetadi.
  router.get('/inpatient/wards/board', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const wards = await q(
        `SELECT id, name, floor, room_number, department, status
         FROM wards WHERE tenant_id = $1 ORDER BY floor NULLS LAST, name`,
        [tenantId]
      );
      const beds = await q(
        `SELECT b.id, b.ward_id, b.bed_number, b.bed_type, b.status,
                a.id AS admission_id, a.patient_id, a.patient_name,
                a.admission_date, a.diagnosis_initial, a.attending_doctor_name,
                p.medical_record_number, p.phone
         FROM beds b
         JOIN wards w ON w.id = b.ward_id
         LEFT JOIN admissions a ON a.bed_id = b.id AND a.status = 'active' AND a.tenant_id = w.tenant_id
         LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = w.tenant_id
         WHERE w.tenant_id = $1
         ORDER BY w.name, b.bed_number`,
        [tenantId]
      );
      // Palatalarga koykalarni guruhlash
      const byWard = new Map(wards.map((w) => [w.id, { ...w, beds: [] }]));
      for (const bed of beds) {
        const bucket = byWard.get(bed.ward_id);
        if (bucket) bucket.beds.push(bed);
      }
      res.json({ success: true, wards: [...byWard.values()] });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // BOSQICH C: XARORAT VARAQASI (grafik uchun vaqt qatorlari)
  // ============================================================
  // GET /api/inpatient/admissions/:id/vitals — bir admission bo'yicha
  // barcha daily_notes qiymatlari (t°, A/D, puls, nafas, saturation)
  // — front-end Recharts bilan grafik chizadi.
  router.get('/inpatient/admissions/:id/vitals', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const admissionId = req.params.id;
      const adm = await qGet(
        `SELECT id, admission_date, discharge_date, patient_id, patient_name
         FROM admissions WHERE id = $1 AND tenant_id = $2`,
        [admissionId, tenantId]
      );
      if (!adm) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

      const notes = await q(
        `SELECT id, date, shift, created_at,
                temperature, blood_pressure, pulse, respiration, saturation
         FROM daily_notes
         WHERE tenant_id = $1 AND admission_id = $2
         ORDER BY date ASC, created_at ASC`,
        [tenantId, admissionId]
      );

      // A/D "120/80" formatidan sistolik va diastolik ajratish
      const parseBP = (s) => {
        if (!s) return { sys: null, dia: null };
        const m = String(s).match(/^\s*(\d{2,3})\s*\/\s*(\d{2,3})/);
        return m ? { sys: parseInt(m[1], 10), dia: parseInt(m[2], 10) } : { sys: null, dia: null };
      };

      const points = notes.map((n) => {
        const bp = parseBP(n.blood_pressure);
        return {
          id: n.id,
          date: n.date,
          shift: n.shift,
          at: n.created_at,
          temperature: n.temperature != null ? Number(n.temperature) : null,
          bp_sys: bp.sys, bp_dia: bp.dia, blood_pressure: n.blood_pressure,
          pulse: n.pulse, respiration: n.respiration, saturation: n.saturation,
        };
      });

      res.json({
        success: true,
        admission: {
          id: adm.id, patient_id: adm.patient_id, patient_name: adm.patient_name,
          admission_date: adm.admission_date, discharge_date: adm.discharge_date,
        },
        points,
      });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ============================================================
  // YANGI: OVOZLI OBHOD
  // ============================================================

  // POST /api/inpatient/daily-notes/voice — Ovoz -> STT -> LLM -> daily_notes
  //
  // Shifokor obhod paytida gapiradi: "Bemor holati o'rtacha, temp 37.2,
  // bosim 130/80, shikoyati bosh og'rig'i, davom qilinsin".
  // LLM: temperature, blood_pressure, pulse, complaints, treatment_plan
  // maydonlariga ajratadi + qisqa ai_summary yozadi.
  //
  // Xato bo'lsa saqlanmaydi — shifokor qo'lda kiritish oynasiga tushadi.
  router.post('/inpatient/daily-notes/voice',
    authMiddleware, checkRole('ceo', 'admin', 'doctor'),
    upload ? upload.single('audio') : (req, _res, next) => next(),
    async (req, res) => {
      try {
        const tenantId = getTenantId(req);
        const { admission_id, language } = req.body;
        if (!admission_id) return res.status(400).json({ success: false, error: 'admission_id majburiy' });
        if (!req.file) return res.status(400).json({ success: false, error: 'Audio fayl majburiy' });

        const adm = await qGet(
          'SELECT id, patient_id FROM admissions WHERE id = $1 AND tenant_id = $2',
          [admission_id, tenantId]
        );
        if (!adm) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

        // STT + LLM chaqiruv (scribe bilan bir xil orchestrator)
        const { transcribe, llm } = await import('../../ai/orchestrator.js');
        const stt = await transcribe(req.file.buffer, req.file.originalname || 'audio.webm', { language });
        if (stt.error) {
          return res.status(stt.code === 'UNSUPPORTED_LANGUAGE' ? 400 : 500)
            .json({ success: false, error: stt.error, code: stt.code });
        }
        const text = stt.text || '';

        const prompt =
          "Siz shifokor yordamchisisiz. Statsionar bemorining obhod paytidagi ovozli " +
          "yozuvidan quyidagi JSON kalitlarini ajratib qaytaring (yo'q bo'lsa null yoki bo'sh string): " +
          '{"temperature": null, "blood_pressure": "", "pulse": null, "respiration": null, ' +
          '"saturation": null, "complaints": "", "objective_status": "", "treatment_plan": "", ' +
          '"ai_summary": ""}. ' +
          "temperature — o'ndan bir aniqlikda son (37.5), pulse/respiration — butun son, " +
          "saturation — foizsiz butun (98). blood_pressure — '120/80' formatida. " +
          "ai_summary — 1-2 gap qisqa xulosa (shifokor tez o'qishi uchun). " +
          "Sonlarni RAQAMLARDA yozing, so'z bilan emas. Diktant o'zbek yoki rus tilida bo'lishi mumkin.";

        const parsed = await llm(prompt, text);

        // Bazaga yozamiz
        const id = uuidv4();
        await q(
          `INSERT INTO daily_notes (id, tenant_id, admission_id, patient_id,
             doctor_id, doctor_name, date, shift,
             temperature, blood_pressure, pulse, respiration, saturation,
             complaints, objective_status, treatment_plan,
             raw_text, ai_summary, data_json)
           VALUES ($1,$2,$3,$4,$5,$6,CURRENT_DATE,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [id, tenantId, admission_id, adm.patient_id,
           req.user?.id || null, req.user?.name || req.user?.username || null,
           'ertalab',
           parsed.temperature ?? null, parsed.blood_pressure || null,
           parsed.pulse ?? null, parsed.respiration ?? null, parsed.saturation ?? null,
           parsed.complaints || null, parsed.objective_status || null, parsed.treatment_plan || null,
           text, parsed.ai_summary || null, JSON.stringify(parsed)]
        );

        // Ai_requests hisobiga qo'shamiz
        await q(
          `INSERT INTO usage_metering (tenant_id, metric, count, date)
           VALUES ($1, 'ai_requests', 1, CURRENT_DATE)
           ON CONFLICT (tenant_id, metric, date) DO UPDATE SET count = usage_metering.count + 1`,
          [tenantId]
        ).catch(() => {});

        res.json({
          success: true,
          data: { id, transcription: text, language: stt.language || null, extracted: parsed },
          message: 'Obhod yozib olindi',
        });
      } catch (e) {
        console.error('[INPATIENT voice]', e);
        res.status(500).json({ success: false, error: e.message });
      }
    }
  );

  return router;
}
