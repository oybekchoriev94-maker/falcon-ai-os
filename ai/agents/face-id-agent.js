import { findBestMatch, prepareForDb, prepareFromDb } from '../../backend/services/face-engine.js';

export const name = 'face-id-agent';
export const description = 'Face ID agenti — yuz orqali xodim va bemorlarni taniydi, davomatni loglaydi, yangi bemorlarni registratsiya qiladi';
export const version = '2.0.0';

export const inputSchema = {
  action: { type: 'string', required: true, description: 'Amal turi: verify, register_patient, attendance_log, search_patient' },
  face_descriptor: { type: 'array', required: true, description: 'Yuz deskriptori massivi' },
  patient_info: { type: 'object', required: false, description: 'register_patient uchun: {first_name, last_name, phone, birth_date}' },
  type_filter: { type: 'string', required: false, description: 'Qidiruv filtri: staff, patient, all' },
  threshold: { type: 'number', required: false, description: 'Moslik chegarasi (default: 0.45)' },
  liveness_score: { type: 'number', required: false, description: 'Liveness ball (0-1)' }
};

export async function handler(input, context = {}) {
  const db = context.db;
  const { action, face_descriptor, threshold = 0.45, liveness_score } = input;
  const livenessPassed = !liveness_score || liveness_score >= 0.5;

  if (!face_descriptor) return { error: 'face_descriptor talab qilinadi' };

  if (action === 'register_patient') {
    if (!db?.isReady()) return { error: 'Database mavjud emas' };
    const { first_name, last_name, phone, birth_date } = input.patient_info || {};
    if (!first_name) return { error: 'patient_info.first_name talab qilinadi' };

    // Deduplication
    const existingPatients = db.q("SELECT id, first_name, last_name, face_descriptor FROM patients WHERE face_descriptor IS NOT NULL");
    const dupCheck = findBestMatch(face_descriptor, existingPatients, 0.35);
    if (dupCheck.match) {
      return { error: 'Bu yuz oldin ro\'yxatdan o\'tgan', existing_patient: { id: dupCheck.match.id, name: `${dupCheck.match.first_name} ${dupCheck.match.last_name}` } };
    }

    const id = require('uuid').v4();
    const stored = prepareForDb(face_descriptor);
    db.qExec(
      'INSERT INTO patients (id, first_name, last_name, phone, birth_date, face_descriptor) VALUES (?, ?, ?, ?, ?, ?)',
      [id, first_name, last_name || '', phone || '', birth_date || '', stored]
    );

    db.qExec(
      'INSERT INTO face_logs (doctor_id, doctor_name, action, confidence, matched, patient_id, liveness_score, liveness_passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, `${first_name} ${last_name || ''}`, 'patient_register', 1.0, 'yes', id, liveness_score || null, livenessPassed ? 1 : 0]
    );

    return { success: true, patient: { id, first_name, last_name: last_name || '', phone: phone || '' } };
  }

  if (action === 'verify') {
    if (!db?.isReady()) return { error: 'Database mavjud emas' };

    const doctors = db.q("SELECT id, first_name, last_name, specialty, face_descriptor FROM doctors WHERE face_descriptor IS NOT NULL AND status = 'Faol'");
    const patients = db.q("SELECT id, first_name, last_name, phone, face_descriptor FROM patients WHERE face_descriptor IS NOT NULL");

    const bestDoctor = findBestMatch(face_descriptor, doctors, threshold);
    const bestPatient = findBestMatch(face_descriptor, patients, threshold);

    if (bestDoctor.match) {
      const name = `${bestDoctor.match.first_name} ${bestDoctor.match.last_name}`;
      db.qExec(
        'INSERT INTO face_logs (doctor_id, doctor_name, action, confidence, matched, patient_id, liveness_score, liveness_passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [bestDoctor.match.id, name, 'attended', bestDoctor.confidence, 'yes', null, liveness_score || null, livenessPassed ? 1 : 0]
      );
      return {
        matched: true, type: 'staff', confidence: bestDoctor.confidence,
        identity: { id: bestDoctor.match.id, name, specialty: bestDoctor.match.specialty }
      };
    }

    if (bestPatient.match) {
      const name = `${bestPatient.match.first_name} ${bestPatient.match.last_name}`;
      db.qExec(
        'INSERT INTO face_logs (doctor_id, doctor_name, action, confidence, matched, patient_id, liveness_score, liveness_passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [null, name, 'checked_in', bestPatient.confidence, 'yes', bestPatient.match.id, liveness_score || null, livenessPassed ? 1 : 0]
      );
      return {
        matched: true, type: 'patient', confidence: bestPatient.confidence,
        identity: { id: bestPatient.match.id, name, phone: bestPatient.match.phone }
      };
    }

    db.qExec(
      'INSERT INTO face_logs (doctor_id, doctor_name, action, matched, liveness_score, liveness_passed) VALUES (?, ?, ?, ?, ?, ?)',
      [null, 'Noma\'lum', 'entry', 'no', liveness_score || null, livenessPassed ? 1 : 0]
    );
    return { matched: false, distance: Math.min(bestDoctor.distance, bestPatient.distance) };
  }

  if (action === 'attendance_log') {
    if (!db?.isReady()) return { error: 'Database mavjud emas' };
    const limit = parseInt(input.limit) || 20;
    const typeFilter = input.type_filter || 'all';
    let sql = 'SELECT * FROM face_logs WHERE date(created_at) = date(\'now\')';
    if (typeFilter === 'staff') sql += ' AND action IN (\'attended\',\'entry\')';
    else if (typeFilter === 'patient') sql += ' AND action IN (\'checked_in\',\'patient_register\')';
    sql += ' ORDER BY created_at DESC LIMIT ?';
    const logs = db.q(sql, [limit]);
    return { logs, total: logs.length };
  }

  if (action === 'search_patient') {
    if (!db?.isReady()) return { error: 'Database mavjud emas' };
    const query = input.query || '';
    const patients = query
      ? db.q("SELECT id, first_name, last_name, phone, birth_date FROM patients WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? LIMIT 20",
          [`%${query}%`, `%${query}%`, `%${query}%`])
      : db.q("SELECT id, first_name, last_name, phone, birth_date FROM patients ORDER BY created_at DESC LIMIT 20");
    return { patients, total: patients.length };
  }

  return { error: `Noma'lum action: ${action}. support: verify, register_patient, attendance_log, search_patient` };
}
