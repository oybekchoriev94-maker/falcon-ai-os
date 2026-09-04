// ============================================================
// FALCON AI OS — Lavozim bo'yicha kunlik vazifalarni avtomatik yaratish
//
// Har lavozimga (masalan "hamshira") biriktirilgan doimiy vazifa
// shablonlari bor (duty_templates). Har 30 daqiqada FAOL xodimlarga,
// o'z lavozimidagi FAOL shablonlar asosida staff_tasks yaratiladi.
//
// Idempotent: (tenant, xodim, shablon, sana) unique index orqali —
// qayta ishga tushirilsa ham takror yaratilmaydi (ON CONFLICT DO
// NOTHING). Xatolar loop'ni to'xtatmaydi.
// ============================================================
import { getPool } from '../db.js';

const TICK_MS = 30 * 60 * 1000; // 30 daqiqa
const DUE_TIME = '20:00:00'; // kun oxiri — DALIL sifatida, jazo emas
let started = false;

async function tick() {
  const pool = getPool();
  try {
    const { rows } = await pool.query(`
      INSERT INTO staff_tasks
        (tenant_id, staff_member_id, staff_name, title, description, due_at, duty_template_id, generated_for_date)
      SELECT s.tenant_id, s.id, s.full_name, dt.title, dt.description,
             (CURRENT_DATE::text || ' ${DUE_TIME}')::timestamptz,
             dt.id, CURRENT_DATE
        FROM staff_members s
        JOIN duty_templates dt
          ON dt.tenant_id = s.tenant_id AND dt.position = s.position AND dt.is_active
       WHERE s.is_active
      ON CONFLICT (tenant_id, staff_member_id, duty_template_id, generated_for_date) DO NOTHING
      RETURNING id
    `);
    if (rows.length) console.log(`[CRON duty_tasks] ${rows.length} ta kunlik vazifa yaratildi`);
  } catch (e) {
    console.warn('[CRON duty_tasks]', e.message);
  }
}

export function startDutyTaskCron() {
  if (started) return;
  started = true;
  setTimeout(() => {
    tick();
    setInterval(tick, TICK_MS);
    console.log(`[CRON] Lavozim vazifalari — har ${TICK_MS / 60000} daqiqada`);
  }, 20_000);
}
