// ============================================================
// Bemor "keldi" — UCHALA kanal (kiosk, registratura, Telegram)
// shu BITTA funksiya orqali ishlaydi. Shu tufayli xatti-harakat
// har doim bir xil: bir xil tekshiruvlar, bir xil xato xabarlari,
// bir xil navbat natijasi — qaysi kanaldan kelishidan qat'i nazar.
// ============================================================

const VALID_SOURCES = new Set(['kiosk', 'registratura', 'telegram']);

/**
 * @param {import('pg').Pool} pool
 * @param {{tenantId: string, appointmentId?: number|string, accessCode?: string,
 *          source: 'kiosk'|'registratura'|'telegram', actorUserId?: string|null}} args
 * @returns {Promise<{already: boolean, appointment: object}>}
 */
export async function checkInAppointment(pool, { tenantId, appointmentId, accessCode, source, actorUserId = null }) {
  if (!VALID_SOURCES.has(source)) {
    throw Object.assign(new Error('Noto\'g\'ri manba'), { status: 400 });
  }
  if (!appointmentId && !accessCode) {
    throw Object.assign(new Error('appointment_id yoki access_code kerak'), { status: 400 });
  }

  const whereKey = appointmentId ? 'a.id = $2' : 'a.access_code = $2';
  const keyValue = appointmentId ? appointmentId : String(accessCode).trim().toUpperCase();

  const row = (await pool.query(
    `SELECT id, patient_name, doctor_name, status, arrived_at, scheduled_at
       FROM appointments a
      WHERE a.tenant_id = $1 AND ${whereKey}
        AND a.scheduled_at::date = CURRENT_DATE`,
    [tenantId, keyValue]
  )).rows[0];

  if (!row) {
    throw Object.assign(new Error('Bugungi bron topilmadi. Kod yoki sana tekshiring.'), { status: 404 });
  }
  if (['cancelled', 'no_show', 'completed', 'pending_admission'].includes(row.status)) {
    throw Object.assign(new Error('Bu bron endi faol emas'), { status: 409, code: 'NOT_ACTIVE' });
  }
  if (row.arrived_at) {
    return { already: true, appointment: row };
  }

  const updated = (await pool.query(
    `UPDATE appointments
        SET arrived_at = NOW(), checked_in_source = $3, checked_in_by = $4
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, patient_name, doctor_name, scheduled_at, arrived_at, checked_in_source, phone`,
    [tenantId, row.id, source, actorUserId]
  )).rows[0];

  // Check-in -> navbat: bemor avtomatik jonli navbatga tushadi.
  // Best-effort — navbat xatosi check-in'ni bekor qilmasligi kerak.
  let queuePosition = null;
  try {
    const existing = (await pool.query(
      `SELECT id FROM patient_queue
        WHERE tenant_id = $1 AND LOWER(TRIM(patient_name)) = LOWER(TRIM($2))
          AND status IN ('waiting', 'in_progress')`,
      [tenantId, updated.patient_name]
    )).rows[0];
    if (!existing) {
      const maxQ = (await pool.query(
        `SELECT COALESCE(MAX(queue_number), 0) + 1 AS n
           FROM patient_queue WHERE tenant_id = $1 AND status IN ('waiting', 'in_progress')`,
        [tenantId]
      )).rows[0];
      await pool.query(
        `INSERT INTO patient_queue (queue_number, patient_name, phone, doctor, notes, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [maxQ.n, updated.patient_name, updated.phone || '', updated.doctor_name || '',
          `check-in: ${source}`, tenantId]
      );
      queuePosition = maxQ.n;
    }
  } catch (queueError) {
    console.warn('[CHECKIN] Navbatga qo\'shish xatosi:', queueError.message);
  }

  return { already: false, appointment: updated, queue_position: queuePosition };
}
