import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { safeError } from '../services/safe-error.js';
import { findBestMatch, prepareForDb } from '../services/face-engine.js';
import { schemas } from '../shared.js';

export default function faceRoutes(pool, authMiddleware, checkRole) {
  const router = Router();
  const q = async (sql, params = []) => { const r = await pool.query(sql, params); return r.rows; };
  const qGet = async (sql, params = []) => { const r = await pool.query(sql, params); return r.rows[0] || null; };

  const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      return res.status(400).json({ error: 'Validatsiya xatosi', details: errors });
    }
    req.body = result.data;
    next();
  };

  async function validateNonce(req, res, next) {
    const { nonce, timestamp } = req.body;
    if (!nonce || typeof nonce !== 'string')
      return res.status(400).json({ error: 'nonce (yagona identifikator) talab qilinadi' });
    if (!timestamp || typeof timestamp !== 'number')
      return res.status(400).json({ error: 'timestamp (vaqt) talab qilinadi' });
    const now = Date.now();
    if (Math.abs(now - timestamp) > 30000)
      return res.status(400).json({ error: "So'rov vaqti tugagan, qayta urinib ko'ring" });
    try {
      const existing = await qGet('SELECT nonce FROM used_nonces WHERE nonce = $1', [nonce]);
      if (existing)
        return res.status(409).json({ error: 'Bu so\'rov allaqachon bajarilgan' });
      await q("INSERT INTO used_nonces (nonce, expires_at) VALUES ($1, NOW() + INTERVAL '1 hour')", [nonce]);
      await q("DELETE FROM used_nonces WHERE expires_at < NOW()");
      next();
    } catch (e) {
      safeError(res, e);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Rate Limiters
  // ────────────────────────────────────────────────────────────

  const faceRouteLimiter = rateLimit({
    windowMs: 60000,
    max: 10,
    message: { error: "Juda ko'p so'rov, 1 daqiqa kuting" },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const faceVerifyLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: "Juda ko'p yuz tekshirish urinishi, 1 daqiqa kuting" },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const faceRegisterLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { error: "Juda ko'p yuz ro'yxatdan o'tkazish urinishi, 1 daqiqa kuting" },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // ────────────────────────────────────────────────────────────
  // Constants & Local Schemas
  // ────────────────────────────────────────────────────────────

  const FACE_THRESHOLD = 0.45;
  const LIVENESS_THRESHOLD = 0.85;

  const registerPatientSchema = z.object({
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
    face_descriptor: z.array(z.number()).min(128).max(512),
    liveness_score: z.number().min(0).max(1).optional(),
    nonce: z.string().min(8).max(64),
    timestamp: z.number(),
    device_id: z.string().max(128).optional(),
  });

  const patientUpdateSchema = z.object({
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
  });

  const verifySchema = z.object({
    face_descriptor: z.array(z.number()).min(128).max(512),
    liveness_score: z.number().min(0).max(1).optional(),
    nonce: z.string().min(8).max(64),
    timestamp: z.number(),
    device_id: z.string().max(128).optional(),
  });

  // ====================================================================
  // PATIENT ROUTES  (from faceId.js)
  // ====================================================================

  // POST /register-patient — register a patient via face
  router.post(
    '/register-patient',
    authMiddleware,
    faceRouteLimiter,
    validateNonce,
    validate(registerPatientSchema),
    async (req, res) => {
      try {
        const { first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes, face_descriptor, liveness_score, device_id } = req.body;
        const livenessValue = liveness_score !== undefined ? parseFloat(liveness_score) : 0;

        if (livenessValue < LIVENESS_THRESHOLD) {
          await q(
            'INSERT INTO face_logs (doctor_id, doctor_name, action, matched, liveness_score, liveness_passed, spoof_warning, device_id) VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)',
            ['Spoof-Register', 'patient_register', 'no', livenessValue, 0, 1, device_id || null]
          );
          return res.status(403).json({
            success: false,
            error: "Liveness tekshiruvi o'tmadi. Jonli yuz talab qilinadi.",
            liveness_score: livenessValue,
            spoof_warning: true,
          });
        }

        const existingPatients = await q(
          'SELECT id, first_name, last_name, face_descriptor FROM patients WHERE face_descriptor IS NOT NULL'
        );
        const dupCheck = findBestMatch(face_descriptor, existingPatients, 0.35);
        if (dupCheck.match) {
          return res.status(409).json({
            success: false,
            error: "Bu yuz oldin ro'yxatdan o'tgan",
            existing_patient: {
              id: dupCheck.match.id,
              name: `${dupCheck.match.first_name} ${dupCheck.match.last_name}`,
            },
          });
        }

        const id = uuidv4();
        const tenantId = req.tenant_id;
        const stored = prepareForDb(face_descriptor);
        await q(
          'INSERT INTO patients (id, tenant_id, first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes, face_descriptor) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)',
          [id, tenantId, first_name, last_name || '', middle_name || '', phone || '', birth_date || '', region || '', district || '', address || '', passport_number || '', gender || '', benefit_category || '', department || '', order_number || '', medical_record_number || '', notes || '', stored]
        );
        await q(
          'INSERT INTO face_logs (doctor_id, doctor_name, action, confidence, matched, patient_id, liveness_score, liveness_passed, device_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
          [id, `${first_name} ${last_name || ''}`, 'patient_register', 1.0, 'yes', id, livenessValue, 1, device_id || null]
        );
        const patient = await qGet(
          'SELECT id, first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes, created_at FROM patients WHERE id = $1',
          [id]
        );
        res.json({ success: true, patient, liveness_passed: true });
      } catch (e) {
        safeError(res, e);
      }
    }
  );

  // POST /register-simple — simplified face registration (no nonce, no descriptor)
  const registerSimpleSchema = z.object({
    first_name: z.string().min(1).max(100),
    last_name: z.string().max(100).optional(),
    phone: z.string().max(20).optional(),
    photo_base64: z.string().min(50).optional(),
  });
  router.post(
    '/register-simple',
    authMiddleware,
    faceRouteLimiter,
    validate(registerSimpleSchema),
    async (req, res) => {
      try {
        const { first_name, last_name, phone, photo_base64 } = req.body;
        const tenantId = req.tenant_id;
        const id = uuidv4();
        await q(
          `INSERT INTO patients (id, tenant_id, first_name, last_name, phone, face_descriptor, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, tenantId, first_name, last_name || '', phone || '',
           photo_base64 ? JSON.stringify({ photo: true, captured: new Date().toISOString() }) : null,
           photo_base64 ? `photo:${photo_base64.substring(0, 100)}...` : '']
        );
        await q(
          'INSERT INTO face_logs (tenant_id, doctor_id, doctor_name, action, confidence, matched, patient_id, device_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
          [tenantId, null, `${first_name} ${last_name || ''}`, 'patient_register_simple', 1.0, 'yes', id, null]
        );
        const patient = await qGet(
          'SELECT id, first_name, last_name, phone, created_at FROM patients WHERE id = $1', [id]
        );
        res.json({ success: true, patient, message: 'Bemor muvaffaqiyatli ro\'yxatdan o\'tkazildi' });
      } catch (e) { safeError(res, e); }
    }
  );

  // POST /verify — verify face against both doctors and patients
  router.post(
    '/verify',
    authMiddleware,
    faceRouteLimiter,
    validateNonce,
    validate(verifySchema),
    async (req, res) => {
      try {
        const { face_descriptor, liveness_score, device_id } = req.body;
        const livenessValue = liveness_score !== undefined ? parseFloat(liveness_score) : 0;

        if (livenessValue < LIVENESS_THRESHOLD) {
          await q(
            'INSERT INTO face_logs (doctor_id, doctor_name, action, matched, liveness_score, liveness_passed, spoof_warning, device_id) VALUES (NULL, $1, $2, $3, $4, $5, $6, $7)',
            ['Spoof', 'entry', 'no', livenessValue, 0, 1, device_id || null]
          );
          return res.status(403).json({
            success: false,
            error: "Liveness tekshiruvi o'tmadi",
            liveness_score: livenessValue,
            spoof_warning: true,
            message: "Yuzni jonli tekshirish o'tmadi. Iltimos, to'g'ridan-to'g'ri kameraga qarang.",
          });
        }

        const doctors = await q(
          "SELECT id, first_name, last_name, specialty, face_descriptor FROM doctors WHERE face_descriptor IS NOT NULL AND status = 'Faol'"
        );
        const patients = await q(
          'SELECT id, first_name, last_name, phone, face_descriptor FROM patients WHERE face_descriptor IS NOT NULL'
        );

        const bestDoctor = findBestMatch(face_descriptor, doctors, FACE_THRESHOLD);
        const bestPatient = findBestMatch(face_descriptor, patients, FACE_THRESHOLD);

        if (bestDoctor.match) {
          const name = `${bestDoctor.match.first_name} ${bestDoctor.match.last_name}`;
          await q(
            'INSERT INTO face_logs (doctor_id, doctor_name, action, confidence, matched, patient_id, liveness_score, liveness_passed, device_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [bestDoctor.match.id, name, 'attended', bestDoctor.confidence, 'yes', null, livenessValue, 1, device_id || null]
          );
          return res.json({
            success: true,
            matched: true,
            type: 'staff',
            confidence: bestDoctor.confidence,
            liveness_passed: true,
            identity: {
              id: bestDoctor.match.id,
              name,
              specialty: bestDoctor.match.specialty,
            },
          });
        }

        if (bestPatient.match) {
          const name = `${bestPatient.match.first_name} ${bestPatient.match.last_name}`;
          await q(
            'INSERT INTO face_logs (doctor_id, doctor_name, action, confidence, matched, patient_id, liveness_score, liveness_passed, device_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [null, name, 'checked_in', bestPatient.confidence, 'yes', bestPatient.match.id, livenessValue, 1, device_id || null]
          );
          return res.json({
            success: true,
            matched: true,
            type: 'patient',
            confidence: bestPatient.confidence,
            liveness_passed: true,
            identity: {
              id: bestPatient.match.id,
              name,
              phone: bestPatient.match.phone,
            },
          });
        }

        await q(
          'INSERT INTO face_logs (doctor_id, doctor_name, action, matched, liveness_score, liveness_passed, device_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [null, "Noma'lum", 'entry', 'no', livenessValue, 1, device_id || null]
        );
        res.json({
          success: true,
          matched: false,
          liveness_passed: true,
          distance: Math.min(bestDoctor.distance, bestPatient.distance),
        });
      } catch (e) {
        safeError(res, e);
      }
    }
  );

  // GET /attendance — today's staff attendance logs
  router.get('/attendance', authMiddleware, async (req, res) => {
    try {
      const logs = await q(
        "SELECT * FROM face_logs WHERE created_at::date = CURRENT_DATE AND action IN ('attended','entry') ORDER BY created_at DESC"
      );
      res.json({ success: true, total: logs.length, logs });
    } catch (e) {
      safeError(res, e);
    }
  });

  // GET /patient-checkins — today's patient check-in logs
  router.get('/patient-checkins', authMiddleware, async (req, res) => {
    try {
      const logs = await q(
        "SELECT * FROM face_logs WHERE created_at::date = CURRENT_DATE AND action IN ('checked_in','patient_register') ORDER BY created_at DESC"
      );
      res.json({ success: true, total: logs.length, logs });
    } catch (e) {
      safeError(res, e);
    }
  });

  // GET /registrations — face ro'yxatdan o'tganlar (doctor + patient)
  router.get('/registrations', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.tenant_id;
      const doctors = await q(
        "SELECT id, first_name, last_name, 'doctor' as role, created_at FROM doctors WHERE tenant_id = $1 AND face_descriptor IS NOT NULL ORDER BY created_at DESC",
        [tenantId]
      );
      const patients = await q(
        "SELECT id, first_name, last_name, 'patient' as role, created_at FROM patients WHERE tenant_id = $1 AND face_descriptor IS NOT NULL ORDER BY created_at DESC",
        [tenantId]
      );
      const registrations = [
        ...doctors.map(d => ({ id: d.id, person_name: `${d.first_name} ${d.last_name || ''}`.trim(), role: d.role, created_at: d.created_at })),
        ...patients.map(p => ({ id: p.id, person_name: `${p.first_name} ${p.last_name || ''}`.trim(), role: p.role, created_at: p.created_at })),
      ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      res.json({ success: true, total: registrations.length, registrations });
    } catch (e) {
      safeError(res, e);
    }
  });

  // GET /patients — search/list patients
  router.get('/patients', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.tenant_id;
      const query = req.query.q || '';
      const patients = query
        ? await q(
            'SELECT id, first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes, created_at FROM patients WHERE tenant_id = $1 AND (first_name ILIKE $2 OR last_name ILIKE $3 OR phone ILIKE $4) ORDER BY created_at DESC LIMIT 50',
            [tenantId, `%${query}%`, `%${query}%`, `%${query}%`]
          )
        : await q(
            'SELECT id, first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes, created_at FROM patients WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50',
            [tenantId]
          );
      res.json({ success: true, total: patients.length, patients });
    } catch (e) {
      safeError(res, e);
    }
  });

  // POST /patients — create patient manually (without face)
  router.post('/patients', authMiddleware, validate(patientUpdateSchema), async (req, res) => {
    try {
      const { first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes } = req.body;
      const tenantId = req.tenant_id;
      const id = uuidv4();
      await q(
        'INSERT INTO patients (id, tenant_id, first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)',
        [id, tenantId, first_name, last_name || '', middle_name || '', phone || '', birth_date || '', region || '', district || '', address || '', passport_number || '', gender || '', benefit_category || '', department || '', order_number || '', medical_record_number || '', notes || '']
      );
      const patient = await qGet(
        'SELECT id, first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes, created_at FROM patients WHERE id = $1',
        [id]
      );
      res.status(201).json({ success: true, patient });
    } catch (e) {
      safeError(res, e);
    }
  });

  // PUT /patients/:id — update patient details
  router.put('/patients/:id', authMiddleware, validate(patientUpdateSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const { first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes } = req.body;
      const tenantId = req.tenant_id;
      const existing = await qGet('SELECT id FROM patients WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      if (!existing) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      await q(
        `UPDATE patients SET first_name = $1, last_name = $2, middle_name = $3, phone = $4, birth_date = $5, region = $6, district = $7, address = $8, passport_number = $9, gender = $10, benefit_category = $11, department = $12, order_number = $13, medical_record_number = $14, notes = $15 WHERE id = $16`,
        [first_name, last_name || '', middle_name || '', phone || '', birth_date || '', region || '', district || '', address || '', passport_number || '', gender || '', benefit_category || '', department || '', order_number || '', medical_record_number || '', notes || '', id]
      );
      const patient = await qGet(
        'SELECT id, first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes, created_at FROM patients WHERE id = $1',
        [id]
      );
      res.json({ success: true, patient });
    } catch (e) {
      safeError(res, e);
    }
  });

  // GET /patients/:id — single patient detail
  router.get('/patients/:id', authMiddleware, async (req, res) => {
    try {
      const { id } = req.params;
      const tenantId = req.tenant_id;
      const patient = await qGet(
        'SELECT id, first_name, last_name, middle_name, phone, birth_date, region, district, address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes, created_at FROM patients WHERE id = $1 AND tenant_id = $2',
        [id, tenantId]
      );
      if (!patient) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      res.json({ success: true, patient });
    } catch (e) {
      safeError(res, e);
    }
  });

  // ====================================================================
  // DOCTOR ROUTES  (from server.js inline)
  // ====================================================================

  // GET /doctors — list doctors with face enrolled
  router.get('/doctors', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const docs = await q(
        'SELECT id, first_name, last_name, specialty FROM doctors WHERE face_descriptor IS NOT NULL'
      );
      res.json({ success: true, doctors: docs });
    } catch (e) {
      safeError(res, e);
    }
  });

  // POST /register — register/update a doctor's face model
  router.post(
    '/register',
    authMiddleware,
    checkRole('admin'),
    faceRegisterLimiter,
    validateNonce,
    validate(schemas.faceRegister),
    async (req, res) => {
      try {
        const { doctor_id, face_descriptor, device_id } = req.body;
        const stored = prepareForDb(face_descriptor);
        await q('UPDATE doctors SET face_descriptor = $1 WHERE id = $2', [stored, doctor_id]);
        const doc = await qGet('SELECT first_name, last_name FROM doctors WHERE id = $1', [doctor_id]);
        const name = doc ? `${doc.first_name} ${doc.last_name}` : 'Unknown';
        await q(
          "INSERT INTO face_logs (doctor_id, doctor_name, action, matched, device_id) VALUES ($1, $2, 'face_register', 'yes', $3)",
          [doctor_id, name, device_id || null]
        );
        res.json({ success: true, message: 'Yuz modeli saqlandi' });
      } catch (e) {
        safeError(res, e);
      }
    }
  );

  // GET /logs — today's face logs (admin/ceo)
  router.get('/logs', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const logs = await q(
        "SELECT * FROM face_logs WHERE created_at::date = CURRENT_DATE ORDER BY created_at DESC LIMIT 20"
      );
      res.json({ success: true, total: logs.length, logs });
    } catch (e) {
      safeError(res, e);
    }
  });

  // GET /doctors/status — biometric status of all doctors
  router.get('/doctors/status', authMiddleware, checkRole('admin', 'ceo'), async (req, res) => {
    try {
      const doctors = await q(
        `SELECT id, first_name, last_name, specialty, username,
         CASE WHEN face_descriptor IS NOT NULL THEN 'active' ELSE 'no_face' END as biometric_status,
         status as account_status
         FROM doctors ORDER BY first_name`
      );
      res.json({ success: true, doctors });
    } catch (e) {
      safeError(res, e);
    }
  });

  // POST /doctors/:id/block — block a doctor's biometric access
  router.post('/doctors/:id/block', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await qGet('SELECT id FROM doctors WHERE id = $1', [id]);
      if (!existing) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      await q("UPDATE doctors SET status = 'Bloklangan' WHERE id = $1", [id]);
      res.json({ success: true, message: 'Biometrik status bloklandi' });
    } catch (e) {
      safeError(res, e);
    }
  });

  // POST /doctors/:id/unblock — unblock a doctor's biometric access
  router.post('/doctors/:id/unblock', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await qGet('SELECT id FROM doctors WHERE id = $1', [id]);
      if (!existing) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      await q("UPDATE doctors SET status = 'Faol' WHERE id = $1", [id]);
      res.json({ success: true, message: 'Biometrik status faollashtirildi' });
    } catch (e) {
      safeError(res, e);
    }
  });

  // DELETE /doctors/:id/face — delete a doctor's face descriptor
  router.delete('/doctors/:id/face', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await qGet('SELECT id FROM doctors WHERE id = $1', [id]);
      if (!existing) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      await q("UPDATE doctors SET face_descriptor = NULL, status = 'Faol' WHERE id = $1", [id]);
      res.json({ success: true, message: "Yuz modeli o'chirildi" });
    } catch (e) {
      safeError(res, e);
    }
  });

  // ====================================================================
  // CONSENT ROUTES  (GDPR / O'zbekiston Compliance)
  // ====================================================================

  // POST /consent — record digital consent
  router.post(
    '/consent',
    authMiddleware,
    validate(schemas.faceConsent),
    async (req, res) => {
      try {
        const { user_type, user_id, consent_text } = req.body;
        const existing = await qGet('SELECT id FROM consent_logs WHERE user_type = $1 AND user_id = $2', [
          user_type,
          user_id,
        ]);
        if (existing)
          return res.json({ success: true, message: 'Rozilik avval berilgan', consent_id: existing.id });
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
        const ua = req.headers['user-agent'] || '';
        const result = await q(
          'INSERT INTO consent_logs (user_type, user_id, consent_version, consent_text, ip_address, user_agent) VALUES ($1, $2, \'v1\', $3, $4, $5) RETURNING id',
          [user_type, user_id, consent_text || '', ip, ua]
        );
        await q(
          'INSERT INTO face_logs (doctor_id, doctor_name, action, matched, anonymized) VALUES (NULL, $1, \'consent_given\', \'yes\', 0)',
          [user_type === 'doctor' ? `Doctor:${user_id}` : `Patient:${user_id}`]
        );
        res.status(201).json({ success: true, message: 'Rozilik berildi', consent_id: result[0]?.id });
      } catch (e) {
        safeError(res, e);
      }
    }
  );

  // GET /consent/:userType/:userId — check consent status
  router.get('/consent/:userType/:userId', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const { userType, userId } = req.params;
      const row = await qGet(
        'SELECT id, consent_version, created_at FROM consent_logs WHERE user_type = $1 AND user_id = $2',
        [userType, userId]
      );
      res.json({ success: true, consent: !!row, data: row || null });
    } catch (e) {
      safeError(res, e);
    }
  });

  // ====================================================================
  // RIGHT TO BE FORGOTTEN
  // ====================================================================

  // DELETE /forget/doctor/:id — erase all biometric data for a doctor
  router.delete('/forget/doctor/:id', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const doc = await qGet('SELECT id, first_name, last_name FROM doctors WHERE id = $1', [id]);
      if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      await q('UPDATE doctors SET face_descriptor = NULL WHERE id = $1', [id]);
      await q("DELETE FROM consent_logs WHERE user_type = 'doctor' AND user_id = $1", [id]);
      await q(
        'UPDATE face_logs SET doctor_name = \'Forgotten\', doctor_id = NULL, matched = \'forgotten\', anonymized = 1 WHERE doctor_id = $1',
        [id]
      );
      res.json({
        success: true,
        message: `${doc.first_name} ${doc.last_name} shifokorining barcha biometric ma'lumotlari qayta tiklanmasdan o'chirildi`,
      });
    } catch (e) {
      safeError(res, e);
    }
  });

  // DELETE /forget/patient/:id — erase all biometric data for a patient
  router.delete('/forget/patient/:id', authMiddleware, checkRole('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      const pat = await qGet('SELECT id, first_name, last_name FROM patients WHERE id = $1', [id]);
      if (!pat) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      await q('UPDATE patients SET face_descriptor = NULL WHERE id = $1', [id]);
      await q("DELETE FROM consent_logs WHERE user_type = 'patient' AND user_id = $1", [id]);
      await q(
        'UPDATE face_logs SET doctor_name = \'Forgotten\', doctor_id = NULL, patient_id = NULL, matched = \'forgotten\', anonymized = 1 WHERE patient_id = $1',
        [id]
      );
      res.json({
        success: true,
        message: `${pat.first_name} ${pat.last_name} bemorining barcha biometric ma'lumotlari qayta tiklanmasdan o'chirildi`,
      });
    } catch (e) {
      safeError(res, e);
    }
  });

  return router;
}
