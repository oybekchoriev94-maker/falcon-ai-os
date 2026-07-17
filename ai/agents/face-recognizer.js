import { findBestMatch, l2Norm } from '../../backend/services/face-engine.js';

export const name = 'face-recognizer';
export const description = 'Yuzni tanish va autentifikatsiya agenti — Face ID orqali shifokorlarni taniydi';
export const version = '2.2.0';

export const inputSchema = {
  face_descriptor: { type: 'array', required: true, description: 'Yuz deskriptori (Float32Array dan olingan array)' },
  doctors: { type: 'array', required: false, description: 'Ro\'yxatdagi doktorlar (agar DB dan olinsa null qoldiring)' },
  threshold: { type: 'number', required: false, description: 'Moslik chegarasi (default: 0.45)' },
  log_event: { type: 'boolean', required: false, description: 'Face logga yozish (DB talab qilinadi)' }
};

export async function handler(input, context = {}) {
  const db = context.db;
  const { face_descriptor, threshold = 0.45 } = input;

  if (!face_descriptor) return { error: 'face_descriptor talab qilinadi' };

  let doctors = input.doctors;

  if (!doctors && db?.isReady()) {
    try {
      doctors = db.q("SELECT id, first_name, last_name, specialty, face_descriptor FROM doctors WHERE face_descriptor IS NOT NULL AND status = 'Faol'");
    } catch (e) {
      return { error: `DB dan doktorlarni olishda xatolik: ${e.message}` };
    }
  }

  if (!doctors?.length) return { error: 'face_descriptor va doctors talab qilinadi yoki DB da doktorlar yo\'q' };

  const result = findBestMatch(face_descriptor, doctors, threshold);
  const matched = !!result.match;

  if (db?.isReady() && input.log_event) {
    try {
      const doctorName = matched ? `${result.match.first_name} ${result.match.last_name}` : 'Noma\'lum';
      db.qExec('INSERT INTO face_logs (doctor_id, doctor_name, action, confidence, matched) VALUES (?, ?, ?, ?, ?)',
        [result.match?.id || null, doctorName, 'entry', result.confidence, matched ? 'yes' : 'no']);
    } catch (e) { /* log failure is non-critical */ }
  }

  return {
    matched,
    confidence: matched ? result.confidence : 0,
    distance: result.distance,
    doctor: matched ? {
      id: result.match.id,
      name: `${result.match.first_name} ${result.match.last_name}`,
      specialty: result.match.specialty
    } : null,
    threshold_used: threshold,
    source: input.doctors ? 'input' : 'database',
    total_doctors_checked: doctors.length
  };
}

export function cosineSimilarity(a, b) {
  return l2Norm(new Float32Array(a)).reduce((dot, _, i) => dot + l2Norm(new Float32Array(a))[i] * l2Norm(new Float32Array(b))[i], 0);
}
