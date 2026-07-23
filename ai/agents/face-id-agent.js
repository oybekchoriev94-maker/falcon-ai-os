import { randomUUID } from 'crypto';
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

  // register_patient/verify bu yerda amalga oshirilmaydi: haqiqiy yozib-o'qish yo'li
  // /api/face/register-patient va /api/face/verify (backend/routes/face.js) orqali,
  // chunki faqat o'sha yerda tenant izolyatsiyasi, nonce-replay himoyasi va majburiy
  // liveness tekshiruvi to'g'ri amalga oshirilgan. Bu yerda takrorlash xavfsizlik
  // teshigi (tenant chegarasi yo'q, eski SQLite sintaksisi) ochib qo'yardi.
  if (action === 'register_patient' || action === 'verify') {
    return { error: `"${action}" amali bu agent orqali o'chirilgan — /api/face endpointidan foydalaning (tenant xavfsizligi va liveness tekshiruvi uchun)` };
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
