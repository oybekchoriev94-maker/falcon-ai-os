// ============================================================
// FALCON AI OS — Bemorlar CRUD
// (avval face.js ichida edi; Face ID olib tashlangach shu yerga ko'chirildi)
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';
import { normalizePhone, generateMrn } from '../services/patient-store.js';
import { matchReasons } from '../services/queue-service.js';

const PATIENT_COLUMNS =
  'id, first_name, last_name, middle_name, phone, birth_date, region, district, address, ' +
  'passport_number, gender, benefit_category, department, order_number, medical_record_number, notes, created_at, ' +
  'blood_group, rh_factor, allergies, occupation, workplace, disability_group, ' +
  'emergency_contact_name, emergency_contact_phone, emergency_contact_relation';

export default function patientsRoutes(pool, authMiddleware) {
  const router = Router();
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const qGet = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;

  const patientSchema = z.object({
    first_name: z.string().min(2).max(100),
    last_name: z.string().max(100).optional(),
    middle_name: z.string().max(100).optional(),
    phone: z.string().max(20).optional(),
    birth_date: z.string().max(20).optional(),
    region: z.string().max(100).optional(),
    district: z.string().max(100).optional(),
    address: z.string().max(500).optional(),
    passport_number: z.string().max(20).optional(),
    gender: z.string().max(10).optional(),
    benefit_category: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    order_number: z.string().max(50).optional(),
    medical_record_number: z.string().max(50).optional(),
    notes: z.string().max(1000).optional(),
    // Bosqich A — 003-forma qo'shimcha maydonlari
    blood_group: z.string().max(5).optional(),
    rh_factor: z.string().max(5).optional(),
    allergies: z.string().max(1000).optional(),
    occupation: z.string().max(200).optional(),
    workplace: z.string().max(200).optional(),
    disability_group: z.string().max(20).optional(),
    emergency_contact_name: z.string().max(200).optional(),
    emergency_contact_phone: z.string().max(20).optional(),
    emergency_contact_relation: z.string().max(50).optional(),
  });

  const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Validatsiya xatosi', details: result.error.flatten().fieldErrors });
    }
    req.body = result.data;
    next();
  };

  const tenantOf = (req) => req.user.tenant_id;

  // normalizePhone va generateMrn — services/patient-store.js dan (booking bilan bir xil)
  const normPhone = normalizePhone;
  const nextMrn = (tenantId) => generateMrn(pool, tenantId);

  /** Kelgan ma'lumotdan yangi bemor yozuvi (tenant ichida, MRN bilan). */
  async function createPatient(tenantId, b) {
    const id = uuidv4();
    let mrn = null;
    for (let i = 0; i < 3; i++) {
      try {
        mrn = await nextMrn(tenantId);
        await q(
          `INSERT INTO patients (id, tenant_id, first_name, last_name, middle_name, phone, birth_date, region, district,
           address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes,
           blood_group, rh_factor, allergies, occupation, workplace, disability_group,
           emergency_contact_name, emergency_contact_phone, emergency_contact_relation)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
          [id, tenantId, b.first_name, b.last_name || '', b.middle_name || '',
           normPhone(b.phone), b.birth_date || null, b.region || '', b.district || '',
           b.address || '', b.passport_number || '', b.gender || '', b.benefit_category || '',
           b.department || '', b.order_number || '', mrn, b.notes || '',
           b.blood_group || null, b.rh_factor || null, b.allergies || null,
           b.occupation || null, b.workplace || null, b.disability_group || null,
           b.emergency_contact_name || null,
           b.emergency_contact_phone ? normPhone(b.emergency_contact_phone) : null,
           b.emergency_contact_relation || null]
        );
        break;
      } catch (e) {
        // MRN yoki telefon takrorlanishi — qayta urinish yoki mavjud yozuvni qaytarish
        if (e.code === '23505' && String(e.constraint || '').includes('phone')) {
          const dup = await qGet(
            `SELECT ${PATIENT_COLUMNS} FROM patients WHERE tenant_id = $1 AND phone = $2`,
            [tenantId, normPhone(b.phone)]
          );
          if (dup) return { patient: dup, existed: true };
        }
        if (e.code === '23505' && String(e.constraint || '').includes('mrn') && i < 2) continue;
        throw e;
      }
    }
    const patient = await qGet(`SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1`, [id]);
    return { patient, existed: false };
  }

  // Boshqa route'lar (booking, scribe) foydalanadigan ichki yordamchilar
  router.locals = router.locals || {};
  router.locals.createPatient = createPatient;
  router.locals.normPhone = normPhone;

  // GET / — bemorlarni qidirish/ro'yxatlash
  // Qidiruv maydonlari: ism, familiya, telefon (raqamli ham, formatli ham),
  // pasport raqami, MRN. Barchasi tenant ichida.
  router.get('/', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const query = (req.query.q || '').trim();
      const patients = query
        ? await q(
            `SELECT ${PATIENT_COLUMNS} FROM patients
             WHERE tenant_id = $1 AND (
               first_name ILIKE $2 OR last_name ILIKE $2 OR
               phone ILIKE $2 OR
               passport_number ILIKE $2 OR
               medical_record_number ILIKE $2
             ) ORDER BY created_at DESC LIMIT 50`,
            [tenantId, `%${query}%`]
          )
        : await q(
            `SELECT ${PATIENT_COLUMNS} FROM patients WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
            [tenantId]
          );
      res.json({ success: true, total: patients.length, patients });
    } catch (e) { safeError(res, e); }
  });

  // GET /lookup?phone=... — bir bemorni topish (upsert oldidan).
  // Reception "Yangi bron" formasida telefon kiritilganda ishga tushadi.
  router.get('/lookup', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const phone = normPhone(req.query.phone);
      const mrn = String(req.query.mrn || '').trim();
      let patient = null;
      if (phone) {
        patient = await qGet(
          `SELECT ${PATIENT_COLUMNS} FROM patients WHERE tenant_id = $1 AND phone = $2`,
          [tenantId, phone]
        );
      } else if (mrn) {
        patient = await qGet(
          `SELECT ${PATIENT_COLUMNS} FROM patients WHERE tenant_id = $1 AND medical_record_number = $2`,
          [tenantId, mrn]
        );
      } else {
        return res.status(400).json({ success: false, error: 'phone yoki mrn talab qilinadi' });
      }
      res.json({ success: true, patient });
    } catch (e) { safeError(res, e); }
  });

  // GET /duplicate-check?phone=&passport_number=&name= — dublikat tekshiruvi
  // (roadmap modul 2: telefon, pasport/JSHSHIR va ism bo'yicha). Yangi karta
  // ochishdan OLDIN registrator shu endpoint bilan takroriy yozuvlarni ko'radi.
  router.get('/duplicate-check', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const phone = normPhone(req.query.phone);
      const passport = String(req.query.passport_number || '').trim();
      const name = String(req.query.name || '').trim();
      if (!phone && !passport && !name) {
        return res.status(400).json({ success: false, error: 'phone, passport_number yoki name dan kamida bittasi kerak' });
      }

      const conditions = [];
      const params = [tenantId];
      if (phone) { params.push(phone); conditions.push(`phone = $${params.length}`); }
      if (passport) { params.push(passport.toLowerCase()); conditions.push(`LOWER(TRIM(passport_number)) = $${params.length}`); }
      if (name) {
        params.push(`%${name.split(/\s+/)[0]}%`);
        conditions.push(`(first_name ILIKE $${params.length} OR last_name ILIKE $${params.length})`);
      }

      const candidates = await q(
        `SELECT ${PATIENT_COLUMNS} FROM patients
          WHERE tenant_id = $1 AND (${conditions.join(' OR ')})
          ORDER BY created_at DESC LIMIT 20`,
        params
      );
      const matches = candidates
        .map((p) => ({ patient: p, match_reasons: matchReasons(p, { phone, passport_number: passport, name }) }))
        .filter((m) => m.match_reasons.length > 0);
      res.json({ success: true, total: matches.length, matches });
    } catch (e) { safeError(res, e); }
  });

  // POST /upsert — bor bo'lsa qaytaradi, bo'lmasa yangi karta ochadi (avto MRN).
  // Booking, kiosk va boshqa oqimlar shu bilan bemorni bir marta olib, bog'laydi.
  router.post('/upsert', authMiddleware, validate(patientSchema), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const b = req.body;
      const phone = normPhone(b.phone);

      if (phone) {
        const existing = await qGet(
          `SELECT ${PATIENT_COLUMNS} FROM patients WHERE tenant_id = $1 AND phone = $2`,
          [tenantId, phone]
        );
        if (existing) return res.json({ success: true, patient: existing, existed: true });
      }
      if (b.passport_number) {
        const existing = await qGet(
          `SELECT ${PATIENT_COLUMNS} FROM patients WHERE tenant_id = $1 AND passport_number = $2`,
          [tenantId, b.passport_number]
        );
        if (existing) return res.json({ success: true, patient: existing, existed: true });
      }

      const result = await createPatient(tenantId, b);
      res.status(result.existed ? 200 : 201).json({ success: true, ...result });
    } catch (e) { safeError(res, e); }
  });

  // GET /:id/history — bemor kartasi: tashriflar, konsultatsiyalar, hisobotlar, yotqizishlar.
  // Barchasi bitta so'rovda — ochilganda darhol ko'rinsin.
  router.get('/:id/history', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const patientId = req.params.id;
      const patient = await qGet(
        `SELECT ${PATIENT_COLUMNS} FROM patients WHERE tenant_id = $1 AND id = $2`,
        [tenantId, patientId]
      );
      if (!patient) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });

      const [appointments, consultations, reports, admissions, intakes, epis, labs] = await Promise.all([
        q(
          `SELECT a.id, a.appointment_id, a.scheduled_at, a.doctor_name, a.status, a.payment_status,
                  a.amount::float8 AS amount, s.name AS service_name
           FROM appointments a
           LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
           WHERE a.tenant_id = $1 AND a.patient_id = $2
           ORDER BY a.scheduled_at DESC NULLS LAST LIMIT 100`,
          [tenantId, patientId]
        ),
        q(
          `SELECT id, doctor_id, raw_text, data_json, created_at
           FROM patient_consultations
           WHERE tenant_id = $1 AND patient_id = $2
           ORDER BY created_at DESC LIMIT 50`,
          [tenantId, patientId]
        ),
        q(
          `SELECT id, specialization, specialization_label, data_json, pdf_path, created_at
           FROM medical_reports
           WHERE tenant_id = $1 AND patient_name = $2
           ORDER BY created_at DESC LIMIT 50`,
          // medical_reports hozircha ismga bog'lanadi — keyingi migratsiyada patient_id qo'shiladi
          [tenantId, `${patient.first_name} ${patient.last_name || ''}`.trim()]
        ),
        q(
          `SELECT id, admission_date, discharge_date, diagnosis_initial, diagnosis_final,
                  attending_doctor_name, status
           FROM admissions
           WHERE tenant_id = $1 AND patient_id = $2
           ORDER BY admission_date DESC LIMIT 50`,
          [tenantId, patientId]
        ),
        q(
          `SELECT id, admission_id, examined_at, doctor_name, brought_by,
                  complaint_pain, preliminary_diagnosis
           FROM patient_intake_examinations
           WHERE tenant_id = $1 AND patient_id = $2
           ORDER BY examined_at DESC LIMIT 50`,
          [tenantId, patientId]
        ),
        q(
          `SELECT id, admission_id, collected_at, doctor_name,
                  infection_contact, travel_last_month, had_transfusion,
                  had_surgery_6mo, epi_diagnosis
           FROM patient_epi_anamnesis
           WHERE tenant_id = $1 AND patient_id = $2
           ORDER BY collected_at DESC LIMIT 50`,
          [tenantId, patientId]
        ),
        q(
          `SELECT lo.id, lo.test_type, lo.test_name, lo.reason, lo.status,
                  lo.ordered_at, lo.ordered_by_doctor_name,
                  lo.completed_at, lo.performed_by_name,
                  lr.values_json AS result_values, lr.conclusion AS result_conclusion,
                  lr.pdf_path AS result_pdf
           FROM lab_orders lo
           LEFT JOIN lab_results lr ON lr.lab_order_id = lo.id AND lr.tenant_id = lo.tenant_id
           WHERE lo.tenant_id = $1 AND lo.patient_id = $2
           ORDER BY lo.ordered_at DESC LIMIT 100`,
          [tenantId, patientId]
        ),
      ]);

      // Bosqich S: oxirgi obhod ko'rsatkichlari + 7 kunlik trend (UI karta uchun).
      // Xato bo'lsa null qaytadi — asosiy istoriya oqimi buzilmaydi.
      let latestVitals = null;
      let vitalsTrend = { pulse: [], temperature: [], saturation: [] };
      try {
        const vitalRows = await q(
          `SELECT created_at, date, temperature, blood_pressure, pulse, respiration, saturation
             FROM daily_notes
            WHERE tenant_id = $1 AND patient_id = $2
              AND (temperature IS NOT NULL OR pulse IS NOT NULL
                   OR blood_pressure IS NOT NULL OR saturation IS NOT NULL)
            ORDER BY created_at DESC
            LIMIT 14`,
          [tenantId, patientId]
        );
        if (vitalRows.length) {
          const v = vitalRows[0];
          latestVitals = {
            recorded_at: v.created_at,
            temperature: v.temperature,
            blood_pressure: v.blood_pressure,
            pulse: v.pulse,
            respiration: v.respiration,
            saturation: v.saturation,
          };
          // Trend eskidan yangiga (sparkline chapdan o'ngga o'sadi)
          const chrono = [...vitalRows].reverse();
          vitalsTrend = {
            pulse: chrono.map((r) => r.pulse).filter((n) => n != null),
            temperature: chrono.map((r) => r.temperature).filter((n) => n != null),
            saturation: chrono.map((r) => r.saturation).filter((n) => n != null),
          };
        }
      } catch (vErr) {
        console.warn('[PATIENTS latest_vitals]', vErr.message);
      }

      res.json({
        success: true,
        patient,
        summary: {
          visits: appointments.length,
          consultations: consultations.length,
          reports: reports.length,
          admissions: admissions.length,
          last_visit: appointments[0]?.scheduled_at || null,
        },
        appointments, consultations, reports, admissions, intakes, epis, labs,
        latest_vitals: latestVitals,
        vitals_trend: vitalsTrend,
      });
    } catch (e) { safeError(res, e); }
  });

  // POST / — yangi bemor qo'shish (avto MRN, telefon takrorlansa 409)
  router.post('/', authMiddleware, validate(patientSchema), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const result = await createPatient(tenantId, req.body);
      if (result.existed) {
        return res.status(409).json({
          success: false, error: 'Bu telefon raqami bilan bemor allaqachon ro\'yxatda',
          patient: result.patient,
        });
      }
      res.status(201).json({ success: true, patient: result.patient });
    } catch (e) { safeError(res, e); }
  });

  // PUT /:id — bemor ma'lumotini yangilash
  router.put('/:id', authMiddleware, validate(patientSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const b = req.body;
      const tenantId = tenantOf(req);
      const existing = await qGet('SELECT id FROM patients WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      if (!existing) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      await q(
        `UPDATE patients SET first_name=$1, last_name=$2, middle_name=$3, phone=$4, birth_date=$5, region=$6,
         district=$7, address=$8, passport_number=$9, gender=$10, benefit_category=$11, department=$12,
         order_number=$13, medical_record_number=$14, notes=$15,
         blood_group=$16, rh_factor=$17, allergies=$18, occupation=$19, workplace=$20, disability_group=$21,
         emergency_contact_name=$22, emergency_contact_phone=$23, emergency_contact_relation=$24
         WHERE id=$25 AND tenant_id=$26`,
        [b.first_name, b.last_name || '', b.middle_name || '', normPhone(b.phone), b.birth_date || null, b.region || '',
         b.district || '', b.address || '', b.passport_number || '', b.gender || '', b.benefit_category || '',
         b.department || '', b.order_number || '', b.medical_record_number || '', b.notes || '',
         b.blood_group || null, b.rh_factor || null, b.allergies || null,
         b.occupation || null, b.workplace || null, b.disability_group || null,
         b.emergency_contact_name || null, b.emergency_contact_phone ? normPhone(b.emergency_contact_phone) : null,
         b.emergency_contact_relation || null,
         id, tenantId]
      );
      const patient = await qGet(
        `SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId]
      );
      res.json({ success: true, patient });
    } catch (e) { safeError(res, e); }
  });

  // DELETE /:id — bemorni o'chirish (faqat admin/ceo)
  router.delete('/:id', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'ceo', 'superadmin'].includes(req.user?.role)) {
        return res.status(403).json({ success: false, error: 'Bemorni faqat ma\'mur o\'chira oladi' });
      }
      const tenantId = tenantOf(req);
      const existing = await qGet('SELECT id FROM patients WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
      if (!existing) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      await q('DELETE FROM patients WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
      res.json({ success: true, message: 'Bemor o\'chirildi' });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // Bosqich B: Birlamchi qabul ko'rigi
  // ============================================================
  const intakeSchema = z.object({
    admission_id: z.string().uuid().optional(),
    brought_by: z.enum(['ozi_kelgan', 'ttyo', 'boshqa_dpm']).optional(),
    complaint_pain: z.string().max(2000).optional(),
    complaint_pain_location: z.string().max(500).optional(),
    complaint_pain_character: z.string().max(500).optional(),
    complaint_pain_onset: z.string().max(500).optional(),
    complaint_other: z.string().max(2000).optional(),
    anamnesis_morbi: z.string().max(4000).optional(),
    anamnesis_vitae: z.string().max(4000).optional(),
    status_praesens: z.string().max(4000).optional(),
    status_localis: z.string().max(4000).optional(),
    preliminary_diagnosis: z.string().max(2000).optional(),
    raw_text: z.string().max(10000).optional(),
    data_json: z.any().optional(),
  });

  router.post('/:id/intake', authMiddleware, async (req, res) => {
    const parsed = intakeSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
    }
    try {
      const tenantId = tenantOf(req);
      const patient = await qGet('SELECT id FROM patients WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
      if (!patient) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });

      const b = parsed.data;
      const id = uuidv4();
      await q(
        `INSERT INTO patient_intake_examinations
           (id, tenant_id, patient_id, admission_id, doctor_id, doctor_name,
            brought_by, complaint_pain, complaint_pain_location, complaint_pain_character,
            complaint_pain_onset, complaint_other, anamnesis_morbi, anamnesis_vitae,
            status_praesens, status_localis, preliminary_diagnosis, raw_text, data_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [id, tenantId, patient.id, b.admission_id || null,
         req.user?.id || null, req.user?.name || req.user?.username || null,
         b.brought_by || null, b.complaint_pain || null, b.complaint_pain_location || null,
         b.complaint_pain_character || null, b.complaint_pain_onset || null, b.complaint_other || null,
         b.anamnesis_morbi || null, b.anamnesis_vitae || null,
         b.status_praesens || null, b.status_localis || null, b.preliminary_diagnosis || null,
         b.raw_text || null, b.data_json ? JSON.stringify(b.data_json) : null]
      );
      res.status(201).json({ success: true, id });
    } catch (e) { safeError(res, e); }
  });

  router.get('/:id/intakes', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const rows = await q(
        `SELECT * FROM patient_intake_examinations
         WHERE tenant_id = $1 AND patient_id = $2
         ORDER BY examined_at DESC LIMIT 50`,
        [tenantId, req.params.id]
      );
      res.json({ success: true, intakes: rows });
    } catch (e) { safeError(res, e); }
  });

  // ============================================================
  // Bosqich B: SanPIN epi-anamnez
  // ============================================================
  const epiSchema = z.object({
    admission_id: z.string().uuid().optional(),
    infection_contact: z.boolean().optional(),
    infection_contact_details: z.string().max(2000).optional(),
    travel_last_month: z.boolean().optional(),
    travel_details: z.string().max(2000).optional(),
    past_infections: z.string().max(2000).optional(),
    had_hospitalization: z.boolean().optional(),
    had_transfusion: z.boolean().optional(),
    had_surgery_6mo: z.boolean().optional(),
    hospitalization_details: z.string().max(2000).optional(),
    parenteral_procedures: z.boolean().optional(),
    parenteral_details: z.string().max(2000).optional(),
    cosmetic_services: z.boolean().optional(),
    cosmetic_details: z.string().max(2000).optional(),
    epi_diagnosis: z.string().max(2000).optional(),
    management_plan: z.string().max(2000).optional(),
    raw_text: z.string().max(10000).optional(),
    data_json: z.any().optional(),
  });

  router.post('/:id/epi', authMiddleware, async (req, res) => {
    const parsed = epiSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
    }
    try {
      const tenantId = tenantOf(req);
      const patient = await qGet('SELECT id FROM patients WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
      if (!patient) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });

      const b = parsed.data;
      const id = uuidv4();
      await q(
        `INSERT INTO patient_epi_anamnesis
           (id, tenant_id, patient_id, admission_id, doctor_id, doctor_name,
            infection_contact, infection_contact_details, travel_last_month, travel_details,
            past_infections, had_hospitalization, had_transfusion, had_surgery_6mo, hospitalization_details,
            parenteral_procedures, parenteral_details, cosmetic_services, cosmetic_details,
            epi_diagnosis, management_plan, raw_text, data_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [id, tenantId, patient.id, b.admission_id || null,
         req.user?.id || null, req.user?.name || req.user?.username || null,
         !!b.infection_contact, b.infection_contact_details || null,
         !!b.travel_last_month, b.travel_details || null,
         b.past_infections || null,
         !!b.had_hospitalization, !!b.had_transfusion, !!b.had_surgery_6mo, b.hospitalization_details || null,
         !!b.parenteral_procedures, b.parenteral_details || null,
         !!b.cosmetic_services, b.cosmetic_details || null,
         b.epi_diagnosis || null, b.management_plan || null,
         b.raw_text || null, b.data_json ? JSON.stringify(b.data_json) : null]
      );
      res.status(201).json({ success: true, id });
    } catch (e) { safeError(res, e); }
  });

  router.get('/:id/epi', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const rows = await q(
        `SELECT * FROM patient_epi_anamnesis
         WHERE tenant_id = $1 AND patient_id = $2
         ORDER BY collected_at DESC LIMIT 50`,
        [tenantId, req.params.id]
      );
      res.json({ success: true, epi: rows });
    } catch (e) { safeError(res, e); }
  });

  // GET /:id — bitta bemor
  router.get('/:id', authMiddleware, async (req, res) => {
    try {
      const patient = await qGet(
        `SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantOf(req)]
      );
      if (!patient) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      res.json({ success: true, patient });
    } catch (e) { safeError(res, e); }
  });

  // ── AI ADMISSION-SUMMARY (Bosqich N) ──
  // Bemor kartasi ochilganda 2-3 gapli klinik xulosa. 24 soatlik kesh.
  router.get('/:id/ai-summary', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const pid = req.params.id;

      const cached = await qGet(
        `SELECT summary, data_json, based_on_visits, generated_at
         FROM patient_ai_summaries
         WHERE patient_id = $1 AND tenant_id = $2 AND expires_at > NOW()`,
        [pid, tenantId]
      );
      if (cached) {
        return res.json({ success: true, cached: true, ...cached });
      }

      const patient = await qGet(
        `SELECT id, first_name, last_name, birth_date, gender, allergies, blood_group
         FROM patients WHERE tenant_id = $1 AND id = $2`,
        [tenantId, pid]
      );
      if (!patient) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });

      const age = patient.birth_date
        ? Math.floor((Date.now() - new Date(patient.birth_date).getTime()) / (365.25 * 24 * 60 * 60 * 1000))
        : null;

      const visits = await q(
        `SELECT c.created_at::text AS date, d.specialization AS doctor_spec,
                c.data_json
         FROM patient_consultations c
         LEFT JOIN doctors d ON d.id = c.doctor_id AND d.tenant_id = c.tenant_id
         WHERE c.tenant_id = $1 AND c.patient_id = $2
         ORDER BY c.created_at DESC LIMIT 20`,
        [tenantId, pid]
      );
      const admissions = await q(
        `SELECT admission_date::text, diagnosis_initial, diagnosis_final
         FROM admissions
         WHERE tenant_id = $1 AND patient_id = $2
         ORDER BY admission_date DESC LIMIT 10`,
        [tenantId, pid]
      );

      const { admissionSummary } = await import('../../ai/agents/time-savers.js');
      const result = await admissionSummary.handler({
        patient: {
          age,
          gender: patient.gender,
          allergies: patient.allergies,
          blood_group: patient.blood_group,
        },
        recent_visits: visits.map((v) => {
          const dj = typeof v.data_json === 'string'
            ? (() => { try { return JSON.parse(v.data_json); } catch { return {}; } })()
            : (v.data_json || {});
          return {
            date: v.date, doctor_spec: v.doctor_spec,
            diagnosis: dj.diagnosis, procedure: dj.procedure,
          };
        }),
        recent_admissions: admissions.map((a) => ({
          admission_date: a.admission_date,
          diagnosis_initial: a.diagnosis_initial,
          diagnosis_final: a.diagnosis_final,
        })),
      });

      // Keshga yozamiz (24h)
      try {
        await pool.query(
          `INSERT INTO patient_ai_summaries (patient_id, tenant_id, summary, data_json, based_on_visits, expires_at)
           VALUES ($1, $2, $3, $4::jsonb, $5, NOW() + INTERVAL '24 hours')
           ON CONFLICT (patient_id) DO UPDATE SET
             summary = EXCLUDED.summary,
             data_json = EXCLUDED.data_json,
             based_on_visits = EXCLUDED.based_on_visits,
             generated_at = NOW(),
             expires_at = NOW() + INTERVAL '24 hours'`,
          [pid, tenantId, result.summary,
           JSON.stringify({ key_facts: result.key_facts, last_active_diagnoses: result.last_active_diagnoses }),
           visits.length]
        );
      } catch (_) { /* keshga yozib bo'lmasa mayli */ }

      res.json({ success: true, cached: false, ...result });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
