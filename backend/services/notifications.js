// ============================================================
// FALCON AI OS — Bemor xabarnomalari (Bosqich O)
//
// Agent yaratgan matnni Telegram bot orqali yuboradi va patient_notifications
// jadvaliga audit qiladi. Unique (source_id + kind) — bir xil xabar takror
// yuborilmaydi.
// ============================================================
import { v4 as uuidv4 } from 'uuid';

const TG_API = 'https://api.telegram.org';

async function tgSend(token, chatId, text) {
  const res = await fetch(`${TG_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `HTTP ${res.status}`);
  return data.result;
}

/**
 * Bir bemorga xabar yuboradi va audit qiladi.
 * @returns {Promise<{sent: boolean, reason?: string, id?: string}>}
 */
export async function sendPatientNotification(pool, {
  tenantId, patientId, kind, message,
  telegramId,           // agar bemorda telegram_id bo'lsa
  phone,                // SMS uchun kelajakda
  appointmentId = null,
  admissionId = null,
  labOrderId = null,
}) {
  if (!message) return { sent: false, reason: 'empty message' };
  const token = process.env.TELEGRAM_TOKEN_PATIENT || '';
  if (!telegramId) return { sent: false, reason: 'no telegram_id' };
  if (!token) return { sent: false, reason: 'no bot token' };

  const id = uuidv4();
  const recipient = String(telegramId);

  // Deduplikatsiya: (appointment_id + kind) unique index — INSERT xatosi
  // bo'lsa allaqachon yuborilgan degani.
  try {
    await pool.query(
      `INSERT INTO patient_notifications
         (id, tenant_id, patient_id, kind, channel, recipient, message,
          appointment_id, admission_id, lab_order_id, status)
       VALUES ($1, $2, $3, $4, 'telegram', $5, $6, $7, $8, $9, 'pending')`,
      [id, tenantId, patientId, kind, recipient, message,
       appointmentId, admissionId, labOrderId]
    );
  } catch (e) {
    if (e.code === '23505') return { sent: false, reason: 'duplicate' };
    throw e;
  }

  try {
    await tgSend(token, recipient, message);
    await pool.query(
      `UPDATE patient_notifications SET status = 'sent', sent_at = NOW() WHERE id = $1`,
      [id]
    );
    return { sent: true, id };
  } catch (e) {
    await pool.query(
      `UPDATE patient_notifications SET status = 'failed', error = $1 WHERE id = $2`,
      [String(e.message || e).slice(0, 500), id]
    ).catch(() => {});
    return { sent: false, reason: e.message, id };
  }
}

/**
 * Bemor kartasidan telegram_id yoki telefon olish (kelajakda SMS uchun).
 */
export async function fetchPatientContact(pool, tenantId, patientId) {
  if (!patientId) return null;
  const { rows } = await pool.query(
    `SELECT telegram_id, phone, first_name, last_name FROM patients
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, patientId]
  );
  return rows[0] || null;
}

/**
 * Klinika ma'lumoti (nom, manzil) xabar shabloni uchun.
 */
export async function fetchClinicInfo(pool, tenantId) {
  const { rows } = await pool.query(
    `SELECT name, address FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return rows[0] || { name: 'Klinika', address: null };
}
