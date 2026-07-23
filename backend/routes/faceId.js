import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { safeError } from '../services/safe-error.js';
import { findBestMatch, prepareForDb } from '../services/face-engine.js';

export default function faceIdRoutes(db, authMiddleware, checkRole) {
  const router = Router();
  const q = (sql, params = []) => /^SELECT/i.test(sql.trim()) ? db.prepare(sql).all(...params) : db.prepare(sql).run(...params);
  const qGet = (sql, params = []) => db.prepare(sql).get(...params);

  const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      return res.status(400).json({ error: 'Validatsiya xatosi', details: errors });
    }
    req.body = result.data;
    next();
  };

  function validateNonce(req, res, next) {
    const { nonce, timestamp } = req.body;
    if (!nonce || typeof nonce !== 'string') return res.status(400).json({ error: 'nonce (yagona identifikator) talab qilinadi' });
    if (!timestamp || typeof timestamp !== 'number') return res.status(400).json({ error: 'timestamp (vaqt) talab qilinadi' });
    const now = Date.now();
    if (Math.abs(now - timestamp) > 30000) return res.status(400).json({ error: 'So\'rov vaqti tugagan, qayta urinib ko\'ring' });
    const existing = qGet("SELECT nonce FROM used_nonces WHERE nonce = ?", [nonce]);
    if (existing) return res.status(409).json({ error: 'Bu so\'rov allaqachon bajarilgan' });
    q("INSERT INTO used_nonces (nonce, expires_at) VALUES (?, datetime('now', '+1 hour'))", [nonce]);
    q("DELETE FROM used_nonces WHERE expires_at < datetime('now')");
    next();
  }

  const faceRouteLimiter = rateLimit({
    windowMs: 60000, max: 10,
    message: { error: 'Juda ko\'p so\'rov, 1 daqiqa kuting' },
    standardHeaders: true, legacyHeaders: false,
    validate: { trustProxy: false },
  });

  const registerPatientSchema = z.object({
    first_name: z.string().min(2).max(100),
    last_name: z.string().max(100).optional(),
    phone: z.string().max(20).optional(),
    birth_date: z.string().max(20).optional(),
    face_descriptor: z.array(z.number()).min(128).max(512),
    liveness_score: z.number().min(0).max(1).optional(),
    nonce: z.string().min(8).max(64),
    timestamp: z.number(),
    device_id: z.string().max(128).optional()
  });

  const verifySchema = z.object({
    face_descriptor: z.array(z.number()).min(128).max(512),
    liveness_score: z.number().min(0).max(1).optional(),
    nonce: z.string().min(8).max(64),
    timestamp: z.number(),
    device_id: z.string().max(128).optional()
  });

  const THRESHOLD = 0.45;
  const LIVENESS_MIN = 0.5;

  router.post('/register-patient', authMiddleware, faceRouteLimiter, validateNonce, validate(registerPatientSchema), (req, res) => {
    try {
      const { first_name, last_name, phone, birth_date, face_descriptor, liveness_score, device_id } = req.body;
      const livenessValue = liveness_score !== undefined ? parseFloat(liveness_score) : 0;

      if (livenessValue < LIVENESS_MIN) {
        q(
          'INSERT INTO face_logs (doctor_id, doctor_name, action, matched, liveness_score, liveness_passed, spoof_warning, device_id) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)',
          ['Spoof-Register', 'patient_register', 'no', livenessValue, 0, 1, device_id || null]
        );
        return res.status(403).json({
          success: false, error: 'Liveness tekshiruvi o\'tmadi. Jonli yuz talab qilinadi.',
          liveness_score: livenessValue, spoof_warning: true
        });
      }

      const existingPatients = q("SELECT id, first_name, last_name, face_descriptor FROM patients WHERE face_descriptor IS NOT NULL");
      const dupCheck = findBestMatch(face_descriptor, existingPatients, 0.35);
      if (dupCheck.match) {
        return res.status(409).json({
          success: false, error: 'Bu yuz oldin ro\'yxatdan o\'tgan',
          existing_patient: { id: dupCheck.match.id, name: `${dupCheck.match.first_name} ${dupCheck.match.last_name}` }
        });
      }

      const id = uuidv4();
      const stored = prepareForDb(face_descriptor);
      q(
        'INSERT INTO patients (id, first_name, last_name, phone, birth_date, face_descriptor) VALUES (?, ?, ?, ?, ?, ?)',
        [id, first_name, last_name || '', phone || '', birth_date || '', stored]
      );
      q(
        'INSERT INTO face_logs (doctor_id, doctor_name, action, confidence, matched, patient_id, liveness_score, liveness_passed, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [null, `${first_name} ${last_name || ''}`, 'patient_register', 1.0, 'yes', id, livenessValue, 1, device_id || null]
      );
      const patient = qGet('SELECT id, first_name, last_name, phone, birth_date, created_at FROM patients WHERE id = ?', [id]);
      res.json({ success: true, patient, liveness_passed: true });
    } catch (e) { safeError(res, e); }
  });

  router.post('/verify', authMiddleware, faceRouteLimiter, validateNonce, validate(verifySchema), (req, res) => {
    try {
      const { face_descriptor, liveness_score, device_id } = req.body;
      const livenessValue = liveness_score !== undefined ? parseFloat(liveness_score) : 0;

      if (livenessValue < LIVENESS_MIN) {
        q(
          'INSERT INTO face_logs (doctor_id, doctor_name, action, matched, liveness_score, liveness_passed, spoof_warning, device_id) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?)',
          ['Spoof', 'entry', 'no', livenessValue, 0, 1, device_id || null]
        );
        return res.status(403).json({
          success: false, error: 'Liveness tekshiruvi o\'tmadi',
          liveness_score: livenessValue, spoof_warning: true,
          message: 'Yuzni jonli tekshirish o\'tmadi. Iltimos, to\'g\'ridan-to\'g\'ri kameraga qarang.'
        });
      }

      const doctors = q("SELECT id, first_name, last_name, specialty, face_descriptor FROM doctors WHERE face_descriptor IS NOT NULL AND status = 'Faol'");
      const patients = q("SELECT id, first_name, last_name, phone, face_descriptor FROM patients WHERE face_descriptor IS NOT NULL");

      const bestDoctor = findBestMatch(face_descriptor, doctors, THRESHOLD);
      const bestPatient = findBestMatch(face_descriptor, patients, THRESHOLD);

      if (bestDoctor.match) {
        const name = `${bestDoctor.match.first_name} ${bestDoctor.match.last_name}`;
        q(
          'INSERT INTO face_logs (doctor_id, doctor_name, action, confidence, matched, patient_id, liveness_score, liveness_passed, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [bestDoctor.match.id, name, 'attended', bestDoctor.confidence, 'yes', null, livenessValue, 1, device_id || null]
        );
        return res.json({
          success: true, matched: true, type: 'staff', confidence: bestDoctor.confidence, liveness_passed: true,
          identity: { id: bestDoctor.match.id, name, specialty: bestDoctor.match.specialty }
        });
      }

      if (bestPatient.match) {
        const name = `${bestPatient.match.first_name} ${bestPatient.match.last_name}`;
        q(
          'INSERT INTO face_logs (doctor_id, doctor_name, action, confidence, matched, patient_id, liveness_score, liveness_passed, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [null, name, 'checked_in', bestPatient.confidence, 'yes', bestPatient.match.id, livenessValue, 1, device_id || null]
        );
        return res.json({
          success: true, matched: true, type: 'patient', confidence: bestPatient.confidence, liveness_passed: true,
          identity: { id: bestPatient.match.id, name, phone: bestPatient.match.phone }
        });
      }

      q(
        'INSERT INTO face_logs (doctor_id, doctor_name, action, matched, liveness_score, liveness_passed, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [null, 'Noma\'lum', 'entry', 'no', livenessValue, 1, device_id || null]
      );
      res.json({
        success: true, matched: false, liveness_passed: true,
        distance: Math.min(bestDoctor.distance, bestPatient.distance)
      });
    } catch (e) { safeError(res, e); }
  });

  router.get('/attendance', authMiddleware, (req, res) => {
    try {
      const logs = q(
        "SELECT * FROM face_logs WHERE date(created_at) = date('now') AND action IN ('attended','entry') ORDER BY created_at DESC"
      );
      res.json({ success: true, total: logs.length, logs });
    } catch (e) { safeError(res, e); }
  });

  router.get('/patient-checkins', authMiddleware, (req, res) => {
    try {
      const logs = q(
        "SELECT * FROM face_logs WHERE date(created_at) = date('now') AND action IN ('checked_in','patient_register') ORDER BY created_at DESC"
      );
      res.json({ success: true, total: logs.length, logs });
    } catch (e) { safeError(res, e); }
  });

  router.get('/patients', authMiddleware, (req, res) => {
    try {
      const query = req.query.q || '';
      const patients = query
        ? q("SELECT id, first_name, last_name, phone, birth_date, created_at FROM patients WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? ORDER BY created_at DESC LIMIT 50",
            [`%${query}%`, `%${query}%`, `%${query}%`])
        : q("SELECT id, first_name, last_name, phone, birth_date, created_at FROM patients ORDER BY created_at DESC LIMIT 50");
      res.json({ success: true, total: patients.length, patients });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
