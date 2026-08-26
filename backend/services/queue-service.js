// ============================================================
// Falcon AI OS — Jonli navbat xizmati (roadmap PR #6)
//
// Ikki manba bor:
//   1) appointments — bugun "keldi" belgilangan bronlar (arrived_at)
//   2) patient_queue — registratura/kiosk orqali navbatga qo'yilganlar
//
// buildLiveQueue() ikkalasini BITTA ro'yxatga birlashtiradi,
// dublikatlarni (telefon+ism) tozalaydi va kutish vaqtini hisoblaydi.
// SOF funksiya — DB'siz unit-test qilinadi.
// ============================================================

function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 9) return '+998' + d;
  if (d.length === 12 && d.startsWith('998')) return '+' + d;
  return '+' + d;
}

function dedupeKey(name, phone) {
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${n}|${normPhone(phone)}`;
}

/**
 * Jonli navbatni quradi.
 *
 * @param {Array} appointmentRows bugungi arrived bronlar:
 *   { id, patient_name, phone, doctor_name, status, arrived_at }
 * @param {Array} queueRows faol navbat yozuvlari:
 *   { id, patient_name, phone, doctor, status, created_at }
 * @param {Date|string|number} now
 * @returns {{ queue: Array, counts: { in_progress:number, waiting:number } }}
 *   Har element: { source, id, patient_name, phone, doctor_name, status,
 *                  arrived_at, wait_minutes, position }
 */
export function buildLiveQueue(appointmentRows = [], queueRows = [], now = new Date()) {
  const nowMs = new Date(now).getTime();
  const seen = new Map();
  const items = [];

  for (const a of appointmentRows) {
    const key = dedupeKey(a.patient_name, a.phone);
    const status = a.status === 'in_progress' ? 'in_progress' : 'waiting';
    const arrivedMs = a.arrived_at ? new Date(a.arrived_at).getTime() : nowMs;
    const item = {
      source: 'appointment',
      id: a.id,
      patient_name: a.patient_name,
      phone: a.phone || '',
      doctor_name: a.doctor_name || '',
      status,
      arrived_at: a.arrived_at || null,
      wait_minutes: Math.max(0, Math.round((nowMs - arrivedMs) / 60000)),
    };
    seen.set(key, item);
    items.push(item);
  }

  for (const qr of queueRows) {
    const key = dedupeKey(qr.patient_name, qr.phone);
    if (seen.has(key)) {
      // Dublikat: appointment allaqachon ro'yxatda — queue yozuvi shu
      // bemorning o'zi. Statusni yangilaymiz (queue'da in_progress bo'lsa).
      const existing = seen.get(key);
      if (qr.status === 'in_progress') existing.status = 'in_progress';
      continue;
    }
    const status = qr.status === 'in_progress' ? 'in_progress' : 'waiting';
    const arrivedMs = qr.created_at ? new Date(qr.created_at).getTime() : nowMs;
    const item = {
      source: 'queue',
      id: qr.id,
      patient_name: qr.patient_name,
      phone: qr.phone || '',
      doctor_name: qr.doctor || '',
      status,
      arrived_at: qr.created_at || null,
      wait_minutes: Math.max(0, Math.round((nowMs - arrivedMs) / 60000)),
    };
    seen.set(key, item);
    items.push(item);
  }

  // Tartib: in_progress birinchi (eng uzoq kutgan), keyin waiting (kelish tartibi)
  items.sort((x, y) => {
    if (x.status !== y.status) return x.status === 'in_progress' ? -1 : 1;
    const tx = x.arrived_at ? new Date(x.arrived_at).getTime() : nowMs;
    const ty = y.arrived_at ? new Date(y.arrived_at).getTime() : nowMs;
    return tx - ty;
  });

  const counts = { in_progress: 0, waiting: 0 };
  const queue = items.map((item, i) => {
    counts[item.status] += 1;
    return { ...item, position: i + 1 };
  });

  return { queue, counts };
}

/**
 * Dublikat tekshiruvi uchun moslik sababini aniqlaydi (SOF).
 * @param {Object} patient { phone, passport_number, first_name, last_name }
 * @param {Object} query   { phone?, passport_number?, name? }
 * @returns {string[]} ['phone', 'passport', 'name'] bo'sh bo'lsa mos emas
 */
export function matchReasons(patient, query) {
  const reasons = [];
  const pPhone = normPhone(patient.phone);
  if (query.phone && pPhone && pPhone === normPhone(query.phone)) reasons.push('phone');
  if (query.passport_number
    && String(patient.passport_number || '').trim().toLowerCase() === String(query.passport_number).trim().toLowerCase()) {
    reasons.push('passport');
  }
  if (query.name) {
    const full = [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim().toLowerCase();
    const want = String(query.name).trim().toLowerCase();
    if (want && full && (full.includes(want) || want.includes(full))) reasons.push('name');
  }
  return reasons;
}
