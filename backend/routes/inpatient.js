// ============================================================
// FALCON AI OS — Statsionar (Inpatient) Routes
// Palatalar, koykalar, yotqizish, chiqarish, kunlik kuzatuv
// Multi-tenant: tenant_id JWT token dan olinadi
// ============================================================

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { upsertPatientByPhone } from '../services/patient-store.js';
import { generateForm003Pdf } from '../services/form003Generator.js';
import { saveAlerts, fetchActiveMeds, fetchAllergies } from '../services/alerts.js';
import { vitalAnomaly, drugInteraction } from '../../ai/agents/safety-agents.js';

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
        payment_type, notes,
        // Yangi 003-forma muqova maydonlari (H bosqichi)
        height_cm, weight_kg, temperature_on_admission,
        transport_type, transport_details,
        referring_clinic, urgent_admission,
        time_since_onset, referral_diagnosis,
        diet_number, treatment_plan
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

      // GUARD: yotqizishdan avval umumiy rozilik + shartnoma majburiy.
      // Bu klinika xavfsizligi (huquqiy nazorat) uchun. `skip_legal_check=true`
      // bilan chetlab o'tish mumkin — favqulodda holatlar uchun.
      if (patientId && !req.body?.skip_legal_check) {
        const hasConsent = await qGet(
          `SELECT 1 FROM patient_consents
             WHERE tenant_id = $1 AND patient_id = $2
               AND kind IN ('general_care', 'surgery_general', 'anesthesia')
             LIMIT 1`,
          [tenantId, patientId]
        );
        const hasContract = await qGet(
          `SELECT 1 FROM service_contracts
             WHERE tenant_id = $1 AND patient_id = $2
             LIMIT 1`,
          [tenantId, patientId]
        );
        if (!hasConsent || !hasContract) {
          return res.status(400).json({
            success: false,
            error: 'Yotqizish uchun avval rozilik va shartnoma imzolangan bo\'lishi kerak',
            code: 'LEGAL_DOCS_MISSING',
            details: {
              consent_signed: !!hasConsent,
              contract_signed: !!hasContract,
              patient_id: patientId,
            },
          });
        }
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
           attending_doctor_id, attending_doctor_name, payment_type, notes, status,
           height_cm, weight_kg, temperature_on_admission,
           transport_type, transport_details,
           referring_clinic, urgent_admission,
           time_since_onset, referral_diagnosis,
           diet_number, treatment_plan)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [id, tenantId, patientId, appointment_id || null, patient_name, patient_phone || null,
         ward_id || null, bed_id || null,
         admission_date || new Date().toISOString(),
         admission_type || 'rejali', diagnosis_initial || null,
         attending_doctor_id || null, attending_doctor_name || null,
         payment_type || 'kassa', notes || null, 'active',
         height_cm ?? null, weight_kg ?? null, temperature_on_admission ?? null,
         transport_type || null, transport_details || null,
         referring_clinic || null, urgent_admission ? true : false,
         time_since_onset || null, referral_diagnosis || null,
         diet_number || null, treatment_plan || null]
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

      const {
        diagnosis_initial, diagnosis_final, attending_doctor_id, attending_doctor_name, notes,
        height_cm, weight_kg, temperature_on_admission,
        transport_type, transport_details,
        referring_clinic, urgent_admission,
        time_since_onset, referral_diagnosis,
        diet_number, treatment_plan,
      } = req.body;
      const fields = [];
      const params = [];
      let paramIndex = 1;

      if (diagnosis_initial !== undefined) { fields.push(`diagnosis_initial = $${paramIndex++}`); params.push(diagnosis_initial); }
      if (diagnosis_final !== undefined) { fields.push(`diagnosis_final = $${paramIndex++}`); params.push(diagnosis_final); }
      if (attending_doctor_id !== undefined) { fields.push(`attending_doctor_id = $${paramIndex++}`); params.push(attending_doctor_id); }
      if (attending_doctor_name !== undefined) { fields.push(`attending_doctor_name = $${paramIndex++}`); params.push(attending_doctor_name); }
      if (notes !== undefined) { fields.push(`notes = $${paramIndex++}`); params.push(notes); }
      if (height_cm !== undefined) { fields.push(`height_cm = $${paramIndex++}`); params.push(height_cm); }
      if (weight_kg !== undefined) { fields.push(`weight_kg = $${paramIndex++}`); params.push(weight_kg); }
      if (temperature_on_admission !== undefined) { fields.push(`temperature_on_admission = $${paramIndex++}`); params.push(temperature_on_admission); }
      if (transport_type !== undefined) { fields.push(`transport_type = $${paramIndex++}`); params.push(transport_type); }
      if (transport_details !== undefined) { fields.push(`transport_details = $${paramIndex++}`); params.push(transport_details); }
      if (referring_clinic !== undefined) { fields.push(`referring_clinic = $${paramIndex++}`); params.push(referring_clinic); }
      if (urgent_admission !== undefined) { fields.push(`urgent_admission = $${paramIndex++}`); params.push(!!urgent_admission); }
      if (time_since_onset !== undefined) { fields.push(`time_since_onset = $${paramIndex++}`); params.push(time_since_onset); }
      if (referral_diagnosis !== undefined) { fields.push(`referral_diagnosis = $${paramIndex++}`); params.push(referral_diagnosis); }
      if (diet_number !== undefined) { fields.push(`diet_number = $${paramIndex++}`); params.push(diet_number); }
      if (treatment_plan !== undefined) { fields.push(`treatment_plan = $${paramIndex++}`); params.push(treatment_plan); }

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

      // AUTO-AGENT: vital-anomaly — kritik chegaralarni tekshirib alertga yozadi.
      // Fire-and-forget: response'ni ushlab turmaymiz.
      try {
        const va = vitalAnomaly.handler({
          temperature: temperature != null ? Number(temperature) : null,
          blood_pressure: blood_pressure || null,
          pulse: pulse != null ? Number(pulse) : null,
          respiration: respiration != null ? Number(respiration) : null,
          saturation: saturation != null ? Number(saturation) : null,
        });
        if (va?.alerts?.length) {
          saveAlerts(pool, {
            tenantId, patientId: adm.patient_id, admissionId: admission_id,
            sourceKind: 'daily_note', sourceId: id, agentName: 'vital-anomaly',
          }, va.alerts).catch(() => {});
        }
      } catch (aiErr) {
        console.warn('[SAFETY vital-anomaly]', aiErr.message);
      }

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
      const admFull = await qGet('SELECT id, patient_id FROM admissions WHERE id = $1 AND tenant_id = $2', [admission_id, tenantId]);
      if (!admFull) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

      const id = uuidv4();
      await q(
        `INSERT INTO prescriptions (id, admission_id, doctor_id, doctor_name,
           medicine_name, dosage, route, frequency, start_date, end_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, admission_id, req.user?.id || null, req.user?.name || null,
         medicine_name, dosage || null, route || 'ichish', frequency || null,
         start_date || null, end_date || null]
      );

      // AUTO-AGENT: drug-interaction — allergiya + faol dorilar bilan tekshiruv
      try {
        const [allergies, activeMeds] = await Promise.all([
          fetchAllergies(pool, tenantId, admFull.patient_id),
          fetchActiveMeds(pool, tenantId, admFull.patient_id),
        ]);
        const di = await drugInteraction.handler({
          new_drug: `${medicine_name}${dosage ? ' ' + dosage : ''}`,
          allergies,
          active_meds: activeMeds.filter((m) => !m.toLowerCase().includes(String(medicine_name).toLowerCase())),
        });
        if (di?.alerts?.length) {
          saveAlerts(pool, {
            tenantId, patientId: admFull.patient_id, admissionId: admission_id,
            sourceKind: 'prescription', sourceId: id, agentName: 'drug-interaction',
          }, di.alerts).catch(() => {});
        }
      } catch (aiErr) {
        console.warn('[SAFETY drug-interaction]', aiErr.message);
      }

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
  // BOSQICH G: 003-FORMA A4 CHOP ETISH
  // ============================================================
  // GET /inpatient/admissions/:id/print/003 — barcha bo'limlar birlashtirilgan PDF
  router.get('/inpatient/admissions/:id/print/003', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const admId = req.params.id;

      const admission = await qGet(
        `SELECT a.*, w.name AS ward_name, b.bed_number
         FROM admissions a
         LEFT JOIN wards w ON w.id = a.ward_id AND w.tenant_id = a.tenant_id
         LEFT JOIN beds b ON b.id = a.bed_id
         WHERE a.id = $1 AND a.tenant_id = $2`,
        [admId, tenantId]
      );
      if (!admission) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

      const tenant = await qGet(
        `SELECT id, name, legal_name, inn, mfo, bank_account, bank_name,
                legal_address, director_name, director_position
         FROM tenants WHERE id = $1`,
        [tenantId]
      );
      const patient = admission.patient_id ? await qGet(
        `SELECT * FROM patients WHERE id = $1 AND tenant_id = $2`,
        [admission.patient_id, tenantId]
      ) : { first_name: admission.patient_name || 'Noma\'lum', phone: admission.patient_phone };

      // Barcha bog'liq ma'lumotlarni parallel yig'amiz
      const [intakes, epis, dailyNotes, prescriptions, executions, labs, services, consents, contracts, acts, dischargeArr] =
        await Promise.all([
          q(`SELECT * FROM patient_intake_examinations WHERE tenant_id = $1 AND admission_id = $2 ORDER BY examined_at`, [tenantId, admId]),
          q(`SELECT * FROM patient_epi_anamnesis WHERE tenant_id = $1 AND admission_id = $2 ORDER BY collected_at`, [tenantId, admId]),
          q(`SELECT * FROM daily_notes WHERE tenant_id = $1 AND admission_id = $2 ORDER BY date, created_at`, [tenantId, admId]),
          q(`SELECT * FROM prescriptions WHERE tenant_id = $1 AND admission_id = $2 ORDER BY created_at`, [tenantId, admId]),
          q(`SELECT * FROM prescription_executions WHERE tenant_id = $1 AND admission_id = $2 ORDER BY executed_at`, [tenantId, admId]),
          q(`SELECT lo.*, lr.conclusion AS result_conclusion, lr.values_json AS result_values
             FROM lab_orders lo LEFT JOIN lab_results lr ON lr.lab_order_id = lo.id AND lr.tenant_id = lo.tenant_id
             WHERE lo.tenant_id = $1 AND lo.admission_id = $2 ORDER BY lo.ordered_at`, [tenantId, admId]),
          q(`SELECT * FROM inpatient_services WHERE tenant_id = $1 AND admission_id = $2 ORDER BY date`, [tenantId, admId]),
          q(`SELECT * FROM patient_consents WHERE tenant_id = $1 AND admission_id = $2 ORDER BY signed_at`, [tenantId, admId]),
          q(`SELECT * FROM service_contracts WHERE tenant_id = $1 AND admission_id = $2 ORDER BY contract_date`, [tenantId, admId]),
          q(`SELECT * FROM service_acts WHERE tenant_id = $1 AND admission_id = $2 ORDER BY act_date`, [tenantId, admId]),
          q(`SELECT * FROM discharges WHERE tenant_id = $1 AND admission_id = $2 LIMIT 1`, [tenantId, admId]),
        ]);

      const pdf = await generateForm003Pdf({
        tenant, patient, admission,
        intakes, epis, daily_notes: dailyNotes,
        prescriptions, executions, labs, services,
        consents, contracts, acts,
        discharge: dischargeArr[0] || null,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition',
        `inline; filename="003-forma-${patient.medical_record_number || admId}.pdf"`);
      res.send(pdf);
    } catch (e) {
      console.error('[FORM003]', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // BOSQICH E: RETSEPT BAJARISH JURNALI
  // ============================================================
  // POST /prescriptions/:id/execute — hamshira dorini bajarganini yozib qo'yadi.
  router.post('/inpatient/prescriptions/:id/execute',
    authMiddleware, checkRole('ceo', 'admin', 'doctor', 'receptionist'),
    async (req, res) => {
      try {
        const tenantId = getTenantId(req);
        const pres = await qGet(
          `SELECT p.id, p.admission_id, a.patient_id FROM prescriptions p
           JOIN admissions a ON a.id = p.admission_id
           WHERE p.id = $1 AND p.tenant_id = $2`,
          [req.params.id, tenantId]
        );
        if (!pres) return res.status(404).json({ success: false, error: 'Retsept topilmadi' });
        const { shift, notes } = req.body || {};
        const id = uuidv4();
        await q(
          `INSERT INTO prescription_executions
             (id, tenant_id, prescription_id, admission_id, patient_id,
              nurse_id, nurse_name, shift, notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [id, tenantId, pres.id, pres.admission_id, pres.patient_id,
           req.user?.id || null, req.user?.name || req.user?.username || null,
           shift || null, notes || null]
        );
        res.json({ success: true, id });
      } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    }
  );

  // GET /admissions/:id/med-schedule — bugungi dorilar va bajarilishlar
  router.get('/inpatient/admissions/:id/med-schedule', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const admId = req.params.id;
      const adm = await qGet(
        'SELECT id, diet_number FROM admissions WHERE id = $1 AND tenant_id = $2',
        [admId, tenantId]
      );
      if (!adm) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

      const meds = await q(
        `SELECT p.id, p.medicine_name, p.dosage, p.route, p.frequency,
                p.start_date, p.end_date, p.status, p.doctor_name,
                COALESCE(json_agg(
                  json_build_object(
                    'id', pe.id, 'at', pe.executed_at,
                    'nurse', pe.nurse_name, 'shift', pe.shift, 'notes', pe.notes
                  ) ORDER BY pe.executed_at
                ) FILTER (WHERE pe.id IS NOT NULL), '[]') AS executions
         FROM prescriptions p
         LEFT JOIN prescription_executions pe
           ON pe.prescription_id = p.id AND pe.tenant_id = p.tenant_id
           AND DATE(pe.executed_at) = CURRENT_DATE
         WHERE p.admission_id = $1 AND p.tenant_id = $2 AND p.status = 'active'
         GROUP BY p.id
         ORDER BY p.created_at`,
        [admId, tenantId]
      );

      res.json({ success: true, admission_id: admId, diet_number: adm.diet_number, medicines: meds });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // PATCH /admissions/:id/diet — parhez stoli raqami
  router.patch('/inpatient/admissions/:id/diet',
    authMiddleware, checkRole('ceo', 'admin', 'doctor'),
    async (req, res) => {
      try {
        const tenantId = getTenantId(req);
        const n = parseInt(req.body?.diet_number, 10);
        if (!Number.isFinite(n) || n < 0 || n > 20) {
          return res.status(400).json({ success: false, error: 'diet_number 0-20' });
        }
        const r = await pool.query(
          'UPDATE admissions SET diet_number = $1 WHERE id = $2 AND tenant_id = $3',
          [n, req.params.id, tenantId]
        );
        if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Topilmadi' });
        res.json({ success: true });
      } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    }
  );

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

        // AUTO-AGENT: vital-anomaly ovozli obhod maydonlaridan
        let triggeredAlerts = [];
        try {
          const va = vitalAnomaly.handler({
            temperature: parsed.temperature ?? null,
            blood_pressure: parsed.blood_pressure || null,
            pulse: parsed.pulse ?? null,
            respiration: parsed.respiration ?? null,
            saturation: parsed.saturation ?? null,
          });
          triggeredAlerts = va?.alerts || [];
          if (triggeredAlerts.length) {
            saveAlerts(pool, {
              tenantId, patientId: adm.patient_id, admissionId: admission_id,
              sourceKind: 'daily_note', sourceId: id, agentName: 'vital-anomaly',
            }, triggeredAlerts).catch(() => {});
          }
        } catch (aiErr) {
          console.warn('[SAFETY vital-anomaly voice]', aiErr.message);
        }

        res.json({
          success: true,
          data: { id, transcription: text, language: stt.language || null, extracted: parsed, alerts: triggeredAlerts },
          message: 'Obhod yozib olindi',
        });
      } catch (e) {
        console.error('[INPATIENT voice]', e);
        res.status(500).json({ success: false, error: e.message });
      }
    }
  );

  // ============================================================
  // BOSQICH H: BO'LIM MUDIRI TASDIQLASH + EPIKRIZ AI + POLIKLINIKAGA YUBORISH
  // ============================================================

  // POST /admissions/:id/head-review — Bo'lim mudiri davolash rejasini tasdiqlaydi
  router.post('/inpatient/admissions/:id/head-review',
    authMiddleware, checkRole('ceo', 'admin', 'doctor'),
    async (req, res) => {
      try {
        const tenantId = getTenantId(req);
        const { treatment_plan } = req.body;
        const adm = await qGet(
          'SELECT id FROM admissions WHERE id = $1 AND tenant_id = $2',
          [req.params.id, tenantId]
        );
        if (!adm) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

        await q(
          `UPDATE admissions
             SET treatment_plan = COALESCE($1, treatment_plan),
                 head_reviewed_by = $2,
                 head_reviewed_at = CURRENT_TIMESTAMP
           WHERE id = $3 AND tenant_id = $4`,
          [treatment_plan || null, req.user?.id || null, req.params.id, tenantId]
        );
        res.json({ success: true, message: 'Bo\'lim mudiri tasdiqladi' });
      } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    }
  );

  // POST /admissions/:id/generate-epicrisis — LLM avto-epikriz tuzadi
  // Manba: bemor kartasi + obhodlar + tekshiruvlar + dorilar + xizmatlar.
  // Shifokor darrov tahrirlay oladi va imzo bilan yakunlaydi.
  router.post('/inpatient/admissions/:id/generate-epicrisis',
    authMiddleware, checkRole('ceo', 'admin', 'doctor'),
    async (req, res) => {
      try {
        const tenantId = getTenantId(req);
        const admId = req.params.id;
        const [adm] = await q(
          `SELECT a.*, p.first_name, p.last_name, p.middle_name, p.birth_date, p.gender,
                  p.blood_group, p.allergies_text
             FROM admissions a
             LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
            WHERE a.id = $1 AND a.tenant_id = $2`,
          [admId, tenantId]
        );
        if (!adm) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

        const [notes, prescriptions, labs, services] = await Promise.all([
          q('SELECT date, temperature, blood_pressure, pulse, complaints, treatment_plan, ai_summary FROM daily_notes WHERE tenant_id = $1 AND admission_id = $2 ORDER BY date, created_at', [tenantId, admId]),
          q('SELECT medicine_name, dosage, route, frequency, start_date, end_date FROM prescriptions WHERE tenant_id = $1 AND admission_id = $2', [tenantId, admId]),
          q('SELECT lo.test_type, lo.status, lr.values_text, lr.conclusion FROM lab_orders lo LEFT JOIN lab_results lr ON lr.order_id = lo.id WHERE lo.admission_id = $1', [admId]),
          q('SELECT service_name, quantity, total FROM inpatient_services WHERE tenant_id = $1 AND admission_id = $2', [tenantId, admId]),
        ]);

        const context = {
          patient: `${adm.last_name || ''} ${adm.first_name || ''} ${adm.middle_name || ''}`.trim(),
          birth_date: adm.birth_date,
          gender: adm.gender,
          blood_group: adm.blood_group,
          allergies: adm.allergies_text,
          admission_date: adm.admission_date,
          discharge_date: adm.discharge_date,
          initial_diagnosis: adm.diagnosis_initial,
          final_diagnosis: adm.diagnosis_final,
          treatment_plan: adm.treatment_plan,
          height_cm: adm.height_cm,
          weight_kg: adm.weight_kg,
          daily_notes: notes,
          prescriptions,
          labs,
          services,
        };

        const { llm } = await import('../../ai/orchestrator.js');
        const prompt =
          "Siz tibbiy hujjatchi. Bemor statsionar kartasi va davolash bo'yicha " +
          "ma'lumotlar berilgan. Ushbu ma'lumotlar asosida qisqa (~150-250 so'z), " +
          "tibbiy terminlarda YAKUNIY EPIKRIZ (chiqarish xulosasi) yozing. " +
          "Tuzilma: [Bemor haqida qisqa] [Yotqizish sababi] [Davolash jarayoni va dinamika] " +
          "[Tekshiruv natijalari] [Yakuniy tashxis] [Chiqarishdagi holati va tavsiyalar]. " +
          "Sonlar raqamda. Faqat matn qaytaring, JSON emas.";

        const result = await llm(prompt, JSON.stringify(context, null, 2), { forceJson: false });
        const epicrisis = typeof result === 'string'
          ? result
          : (result?.epicrisis || result?.text || JSON.stringify(result));

        res.json({ success: true, epicrisis });
      } catch (e) {
        console.error('[EPIKRIZ]', e);
        res.status(500).json({ success: false, error: e.message });
      }
    }
  );

  // POST /discharges/:id/mark-sent — Poliklinikaga elektron yuborilganini belgilash
  router.post('/inpatient/discharges/:id/mark-sent',
    authMiddleware, checkRole('ceo', 'admin', 'doctor'),
    async (req, res) => {
      try {
        const tenantId = getTenantId(req);
        const { polyclinic_ref } = req.body;
        const disch = await qGet(
          `SELECT d.id FROM discharges d
             JOIN admissions a ON a.id = d.admission_id
            WHERE d.id = $1 AND a.tenant_id = $2`,
          [req.params.id, tenantId]
        );
        if (!disch) return res.status(404).json({ success: false, error: 'Chiqarish topilmadi' });

        await q(
          `UPDATE discharges
             SET sent_to_polyclinic_at = CURRENT_TIMESTAMP,
                 polyclinic_ref = $1
           WHERE id = $2`,
          [polyclinic_ref || null, req.params.id]
        );
        res.json({ success: true, message: 'Poliklinikaga yuborildi deb belgilandi' });
      } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    }
  );

  // PATCH /discharges/:id — chiqarish yozuvini tahrirlash (epikriz/o'lim xulosasi)
  router.patch('/inpatient/discharges/:id',
    authMiddleware, checkRole('ceo', 'admin', 'doctor'),
    async (req, res) => {
      try {
        const tenantId = getTenantId(req);
        const disch = await qGet(
          `SELECT d.id FROM discharges d
             JOIN admissions a ON a.id = d.admission_id
            WHERE d.id = $1 AND a.tenant_id = $2`,
          [req.params.id, tenantId]
        );
        if (!disch) return res.status(404).json({ success: false, error: 'Chiqarish topilmadi' });

        const { epicrisis_text, death_summary, diagnosis_final, icd10_code,
                recommendations, follow_up_date, auto_generated } = req.body;
        const fields = [];
        const params = [];
        let i = 1;
        if (epicrisis_text !== undefined) { fields.push(`epicrisis_text = $${i++}`); params.push(epicrisis_text); }
        if (death_summary !== undefined) { fields.push(`death_summary = $${i++}`); params.push(death_summary); }
        if (diagnosis_final !== undefined) { fields.push(`diagnosis_final = $${i++}`); params.push(diagnosis_final); }
        if (icd10_code !== undefined) { fields.push(`icd10_code = $${i++}`); params.push(icd10_code); }
        if (recommendations !== undefined) { fields.push(`recommendations = $${i++}`); params.push(recommendations); }
        if (follow_up_date !== undefined) { fields.push(`follow_up_date = $${i++}`); params.push(follow_up_date); }
        if (auto_generated !== undefined) { fields.push(`auto_generated = $${i++}`); params.push(!!auto_generated); }

        if (fields.length === 0) return res.status(400).json({ success: false, error: 'O\'zgarish yo\'q' });
        params.push(req.params.id);
        await q(`UPDATE discharges SET ${fields.join(', ')} WHERE id = $${i}`, params);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    }
  );

  // ============================================================
  // YANGI: EPIKRIZ AVTO-GENERATSIYA (Bosqich L — AI orkestrator)
  // ============================================================
  // Chiqarish paytida barcha ma'lumotlarni (obhod, dori, lab) yig'ib,
  // AI epicrisis-writer agentiga uzatamiz. Agent 200-350 so'zli epikriz
  // loyihasini yozadi. Shifokor ko'rib chiqib tuzatadi va discharges
  // jadvaliga saqlaydi (bu endpoint faqat matn qaytaradi, saqlamaydi).
  router.post('/inpatient/admissions/:id/generate-epicrisis',
    authMiddleware, checkRole('ceo', 'admin', 'doctor'),
    async (req, res) => {
      try {
        const tenantId = getTenantId(req);
        const admId = req.params.id;

        const adm = await qGet(
          `SELECT a.id, a.patient_id, a.patient_name, a.admission_date, a.discharge_date,
                  a.diagnosis_initial, a.diagnosis_final, a.attending_doctor_name,
                  w.name AS ward_name, w.department,
                  p.first_name || ' ' || COALESCE(p.last_name, '') AS full_name,
                  p.birth_date, p.gender, p.medical_record_number
           FROM admissions a
           LEFT JOIN wards w    ON w.id = a.ward_id AND w.tenant_id = a.tenant_id
           LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
           WHERE a.id = $1 AND a.tenant_id = $2`,
          [admId, tenantId]
        );
        if (!adm) return res.status(404).json({ success: false, error: 'Yotqizish topilmadi' });

        const days = await q(
          `SELECT date, temperature, blood_pressure, pulse, complaints, treatment_plan
           FROM daily_notes
           WHERE tenant_id = $1 AND admission_id = $2
           ORDER BY date ASC, created_at ASC`,
          [tenantId, admId]
        );
        const meds = await q(
          `SELECT medicine_name, dosage, route, frequency
           FROM prescriptions
           WHERE tenant_id = $1 AND admission_id = $2
           ORDER BY created_at ASC`,
          [tenantId, admId]
        );
        // Labs — statsionar davri ichida buyurilganlar
        const labs = await q(
          `SELECT lo.test_type, lr.conclusion
           FROM lab_orders lo
           LEFT JOIN lab_results lr ON lr.lab_order_id = lo.id AND lr.tenant_id = lo.tenant_id
           WHERE lo.tenant_id = $1 AND lo.patient_id = $2
             AND lo.ordered_at BETWEEN $3 AND COALESCE($4, NOW())
           ORDER BY lo.ordered_at ASC`,
          [tenantId, adm.patient_id, adm.admission_date, adm.discharge_date]
        );

        const orchestrator = await import('../../ai/orchestrator.js');
        const result = await orchestrator.executeAgent(
          'epicrisis-writer',
          {
            patient: {
              full_name: adm.full_name || adm.patient_name,
              birth_date: adm.birth_date,
              gender: adm.gender,
              mrn: adm.medical_record_number,
            },
            admission: {
              admission_date: adm.admission_date,
              discharge_date: adm.discharge_date,
              diagnosis_initial: adm.diagnosis_initial,
              diagnosis_final: adm.diagnosis_final,
              department: adm.department || adm.ward_name,
              attending_doctor: adm.attending_doctor_name,
            },
            daily_notes: days,
            prescriptions: meds,
            labs: labs,
          },
          { tenantId, user: req.user, requestId: req.correlationId || null }
        );

        if (!result.success) {
          return res.status(500).json({ success: false, error: result.error || 'AI xatosi', code: result.code });
        }
        res.json({
          success: true,
          epicrisis_text: result.data.epicrisis_text,
          source_stats: result.data.source_stats,
          note: 'Bu — AI loyihasi. Shifokor ko\'rib tuzatib imzolashi kerak.',
        });
      } catch (e) {
        console.error('[EPIKRIZ]', e);
        res.status(500).json({ success: false, error: e.message });
      }
    }
  );

  // ============================================================
  // YANGI: STATSIONAR TAYYORLASH NAVBATI (Bosqich J)
  // ============================================================
  // Doktor yotqizishga tavsiya bergan bemorlar — kutayotganlar ro'yxati.
  // /wards/board yotqizish dialogida shu ro'yxatdan bemor tanlanadi.
  router.get('/inpatient/pending-admissions', authMiddleware, async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const rows = await q(
        `SELECT a.id, a.appointment_id, a.patient_id, a.patient_name, a.phone,
                a.scheduled_at, a.doctor_name, a.notes,
                a.payment_status, a.amount::float8 AS amount,
                p.medical_record_number, p.district, p.address,
                p.allergies, p.blood_group,
                c.next_step_data,
                c.data_json AS consultation_data,
                (SELECT 1 FROM patient_consents pc
                   WHERE pc.tenant_id = a.tenant_id AND pc.patient_id = a.patient_id
                   LIMIT 1) IS NOT NULL AS consent_signed,
                (SELECT 1 FROM service_contracts sc
                   WHERE sc.tenant_id = a.tenant_id AND sc.patient_id = a.patient_id
                   LIMIT 1) IS NOT NULL AS contract_signed
         FROM appointments a
         LEFT JOIN patients p              ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
         LEFT JOIN patient_consultations c ON c.appointment_id = a.id AND c.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND a.status = 'pending_admission'
         ORDER BY a.scheduled_at ASC LIMIT 100`,
        [tenantId]
      );
      res.json({ success: true, patients: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
