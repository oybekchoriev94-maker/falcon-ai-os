// ============================================================
// Navbat yaqinlashganda Telegram orqali xabar — bemor TV ekraniga
// tikilib o'tirmasin, kafega chiqib, xabar kelganda qaytsin.
//
// Faqat: check-in qilgan (arrived_at bor), Telegram orqali bog'langan
// (patients.telegram_id bor) bemorlarga, va faqat BIR MARTA (dedupe —
// patient_notifications unique(appointment_id, kind)).
//
// Navbat tez o'zgarishi mumkin bo'lgani uchun bu alohida, TEZROQ tsiklda
// yuradi (patient-reminders.js'dagi 15 daqiqalik tsikldan farqli).
// ============================================================

import { getPool } from '../db.js';
import { sendPatientNotification } from '../services/notifications.js';

const TICK_MS = 60 * 1000; // 1 daqiqa
// Shuncha kishi qolganda ogohlantiramiz (0 = navbatdagi keyingi, 1 = undan keyingi)
const NOTIFY_AT_POSITION = 1;
let started = false;

async function tick() {
  const pool = getPool();
  try {
    const { rows } = await pool.query(`
      SELECT a.id AS appointment_id, a.tenant_id, a.patient_id, a.doctor_id, a.doctor_name,
             a.scheduled_at, a.status, p.telegram_id
        FROM appointments a
        JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
       WHERE a.arrived_at IS NOT NULL
         AND a.status IN ('scheduled', 'confirmed', 'in_progress')
         AND date(a.scheduled_at) = CURRENT_DATE
         AND p.telegram_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM patient_notifications n
           WHERE n.appointment_id = a.id AND n.kind = 'queue_approaching'
         )
       ORDER BY a.tenant_id, COALESCE(a.doctor_id::text, a.doctor_name), a.arrived_at ASC
    `);
    if (!rows.length) return;

    // Har (tenant, shifokor) guruhi ichida pozitsiyani hisoblaymiz —
    // in_progress'dagi bemor "0-pozitsiya" (allaqachon qabulda).
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.tenant_id}|${r.doctor_id || r.doctor_name}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }

    for (const list of groups.values()) {
      let waitingIdx = -1;
      for (const r of list) {
        if (r.status === 'in_progress') continue;
        waitingIdx += 1;
        if (waitingIdx !== NOTIFY_AT_POSITION) continue;
        const msg = `⏳ Navbatingiz yaqinlashmoqda!\n\n👨‍⚕️ ${r.doctor_name}\nSizdan oldin ${NOTIFY_AT_POSITION} kishi qoldi. Kutish zaliga o'ting.`;
        try {
          await sendPatientNotification(pool, {
            tenantId: r.tenant_id, patientId: r.patient_id,
            kind: 'queue_approaching', message: msg,
            telegramId: r.telegram_id, appointmentId: r.appointment_id,
          });
        } catch (e) {
          console.warn('[CRON queue_approaching]', r.appointment_id, e.message);
        }
      }
    }
  } catch (e) {
    console.warn('[CRON queue-notify tick]', e.message);
  }
}

export function startQueueNotifyCron() {
  if (started) return;
  started = true;
  setTimeout(() => {
    tick();
    setInterval(tick, TICK_MS);
    console.log(`[CRON] Navbat ogohlantirishi — har ${TICK_MS / 1000}s`);
  }, 30_000);
}
