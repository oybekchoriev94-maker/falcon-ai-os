// ============================================================
// FALCON AI OS — Bemorlar CRUD
// (avval face.js ichida edi; Face ID olib tashlangach shu yerga ko'chirildi)
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';
import { normalizePhone, generateMrn } from '../services/patient-store.js';

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

  const tenantOf = (req) => req.user?.tenant_id || req.tenant_id || 'default';

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

      const [appointments, consultations, reports, admissions] = await Promise.all([
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
      ]);

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
        appointments, consultations, reports, admissions,
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
      const patient = await qGet(`SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1`, [id]);
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

  return router;
}
