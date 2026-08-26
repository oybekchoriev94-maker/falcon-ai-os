// ============================================================
// FALCON AI OS — Bemor xabarnomalari cron loop (Bosqich O)
//
// setInterval bilan har 15 daqiqada:
//   1) 24 soat ichida bo'ladigan appointmentlarga reminder yuboradi
//      (agar hali yuborilmagan bo'lsa — unique index dedupe qiladi)
//   2) 7 kun oldin chiqarilgan admissionlarga follow-up
//
// Xatolar loop'ni to'xtatmaydi (klinika ish jarayoni buzilmasin).
// ============================================================

import { getPool } from '../db.js';
import { sendPatientNotification, fetchClinicInfo } from '../services/notifications.js';
import { appointmentReminder, followUpScheduler } from '../../ai/agents/patient-notify.js';

const TICK_MS = 15 * 60 * 1000;  // 15 daqiqa
let started = false;

async function tickAppointmentReminders() {
  const pool = getPool();
  // Ertangi appointmentlar (18-28 soat oralig'i — soat 6-16 vaqt ushlab)
  const { rows } = await pool.query(`
    SELECT a.id, a.tenant_id, a.patient_id, a.scheduled_at,
           a.doctor_name, a.appointment_id AS code,
           s.name AS service_name,
           d.specialization AS doctor_spec,
           p.telegram_id, p.first_name || ' ' || COALESCE(p.last_name, '') AS patient_name
    FROM appointments a
    LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    WHERE a.status = 'scheduled'
      AND a.patient_id IS NOT NULL
      AND p.telegram_id IS NOT NULL
      AND a.scheduled_at BETWEEN NOW() + INTERVAL '18 hours' AND NOW() + INTERVAL '28 hours'
      AND NOT EXISTS (
        SELECT 1 FROM patient_notifications n
        WHERE n.appointment_id = a.id AND n.kind = 'reminder_24h'
      )
    LIMIT 100
  `);

  for (const r of rows) {
    try {
      const clinic = await fetchClinicInfo(pool, r.tenant_id);
      const msg = appointmentReminder.handler({
        clinic_name: clinic.name,
        clinic_address: clinic.address,
        doctor_name: r.doctor_name || 'shifokor',
        doctor_spec: r.doctor_spec,
        service_name: r.service_name,
        scheduled_at: new Date(r.scheduled_at).toISOString(),
        hours_before: 24,
      });
      await sendPatientNotification(pool, {
        tenantId: r.tenant_id, patientId: r.patient_id,
        kind: 'reminder_24h', message: msg.message,
        telegramId: r.telegram_id, appointmentId: r.id,
      });
    } catch (e) {
      console.warn('[CRON reminder_24h]', r.id, e.message);
    }
  }
  if (rows.length) console.log(`[CRON reminder_24h] ${rows.length} ta ko'rildi`);
}

async function tickFollowUps() {
  const pool = getPool();
  // 6-8 kun oldin chiqarilgan bemorlar
  const { rows } = await pool.query(`
    SELECT adm.id AS admission_id, adm.tenant_id, adm.patient_id,
           adm.attending_doctor_name AS doctor_name,
           adm.diagnosis_final,
           p.telegram_id,
           p.first_name || ' ' || COALESCE(p.last_name, '') AS patient_name
    FROM admissions adm
    JOIN patients p ON p.id = adm.patient_id AND p.tenant_id = adm.tenant_id
    WHERE adm.status = 'discharged'
      AND p.telegram_id IS NOT NULL
      AND adm.discharge_date BETWEEN NOW() - INTERVAL '8 days' AND NOW() - INTERVAL '6 days'
      AND NOT EXISTS (
        SELECT 1 FROM patient_notifications n
        WHERE n.admission_id = adm.id AND n.kind = 'follow_up_7d'
      )
    LIMIT 100
  `);

  for (const r of rows) {
    try {
      const clinic = await fetchClinicInfo(pool, r.tenant_id);
      const msg = followUpScheduler.handler({
        clinic_name: clinic.name,
        patient_name: r.patient_name?.trim() || 'bemor',
        doctor_name: r.doctor_name || undefined,
        diagnosis_final: r.diagnosis_final || undefined,
      });
      await sendPatientNotification(pool, {
        tenantId: r.tenant_id, patientId: r.patient_id,
        kind: 'follow_up_7d', message: msg.message,
        telegramId: r.telegram_id, admissionId: r.admission_id,
      });
    } catch (e) {
      console.warn('[CRON follow_up_7d]', r.admission_id, e.message);
    }
  }
  if (rows.length) console.log(`[CRON follow_up_7d] ${rows.length} ta ko'rildi`);
}

// Bemor kelmagan bronni "no_show"ga o'tkazadi — check-in tizimi (kiosk/
// registratura/telegram) qo'shilgandan keyin navbat ro'yxati "kelmaydigan"
// bronlar bilan tiqilib qolmasligi uchun. 20 daqiqa kechikish — bemorga
// yo'lda tanaffus berish uchun yetarli, lekin navbatni cho'zib yubormaydi.
// 2 kundan eski bronlarga tegilmaydi (birinchi joriy etishda eski
// ma'lumotni ommaviy o'zgartirib yubormaslik uchun ehtiyot chegarasi).
const NO_SHOW_AFTER_MIN = 20;

async function tickNoShow() {
  const pool = getPool();
  const { rows } = await pool.query(`
    UPDATE appointments
       SET status = 'no_show'
     WHERE status IN ('scheduled', 'confirmed')
       AND arrived_at IS NULL
       AND scheduled_at < NOW() - INTERVAL '${NO_SHOW_AFTER_MIN} minutes'
       AND scheduled_at > NOW() - INTERVAL '2 days'
     RETURNING id, tenant_id, doctor_name, scheduled_at
  `);
  if (rows.length) console.log(`[CRON no_show] ${rows.length} ta bron belgilandi`);
}

async function tick() {
  try { await tickAppointmentReminders(); } catch (e) { console.warn('[CRON tick reminders]', e.message); }
  try { await tickFollowUps(); }             catch (e) { console.warn('[CRON tick followups]', e.message); }
  try { await tickNoShow(); }                catch (e) { console.warn('[CRON tick no_show]', e.message); }
}

export function startPatientReminderCron() {
  if (started) return;
  started = true;
  // Boshlanish paytida 30s kutamiz (server tayyor bo'lsin)
  setTimeout(() => {
    tick();
    setInterval(tick, TICK_MS);
    console.log(`[CRON] Bemor xabarnomalari — har ${TICK_MS / 60000} daqiqada`);
  }, 30_000);
}
