/**
 * Xodimlar registri — Frappe HRMS uchun maydonlar (roadmap PR #9).
 *
 * staff_members jadvali 001-migration'dan beri BOR (telegram-bot
 * reestri: telegram_id + full_name + role). Yangi jadval yaratish
 * o'rniga HRMS'ga kerakli maydonlarni QO'SHAMIZ:
 *
 *   - position   — lavha (Frappe Employee.designation)
 *   - phone      — telefon (Frappe Employee.cell_number)
 *   - doctor_id  — doctors jadvaliga bog' (shifokor-xodimlar uchun)
 *   - frappe_employee_name — Frappe'dagi Employee doc nomi (ID ko'prigi;
 *     staff_members.id bigint bo'lgani uchun external_ids.uuid'ga
 *     sig'maydi — shu sababli alohida ustun)
 *
 * Eski telegram oqimlari buzilmaydi: yangi maydonlar nullable.
 * UNIQUE(tenant_id, full_name) — smena jadvali (staff_shifts)
 * nom bo'yicha ishlaydi, sinhronizatsiya ham nom orqali topadi.
 *
 * QO'SHIMCHA: telegram_id NOT NULL cheklovi olib tashlanadi —
 * HR xodimi Telegram botga ulanmagan bo'lishi mumkin (001'da
 * bu jadval faqat bot reestri edi).
 */

export async function up(knex) {
  const has = await knex.schema.hasTable('staff_members');
  if (!has) return; // g'alati holat — 001 yaratishi kerak edi

  const addIfMissing = async (col, ddl) => {
    const exists = await knex.raw(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'staff_members' AND column_name = $1`,
      [col]
    );
    if (!exists.rows.length) await knex.raw(ddl);
  };

  await addIfMissing('position', `ALTER TABLE staff_members ADD COLUMN position varchar(80)`);
  await addIfMissing('phone', `ALTER TABLE staff_members ADD COLUMN phone varchar(30)`);
  await addIfMissing('doctor_id', `ALTER TABLE staff_members ADD COLUMN doctor_id uuid`);
  await addIfMissing('frappe_employee_name', `ALTER TABLE staff_members ADD COLUMN frappe_employee_name varchar(140)`);

  // HR xodimi Telegram'siz bo'lishi mumkin (001'da bot reestri edi)
  await knex.raw('ALTER TABLE staff_members ALTER COLUMN telegram_id DROP NOT NULL');

  // Smena/HRMS sinhronizatsiyasi nom bo'yicha izlaydi — unikal indeks.
  // Eski yozuvlarda dublikat nom bo'lishi mumkin: avval tozalaymiz
  // (har dublikatga '-2', '-3' qo'shib), keyin indeksga o'tamiz.
  const dupCheck = await knex.raw(`
    SELECT 1 FROM pg_indexes
     WHERE tablename = 'staff_members' AND indexname = 'staff_members_tenant_name_uniq'
  `);
  if (!dupCheck.rows.length) {
    await knex.raw(`
      WITH ranked AS (
        SELECT id, tenant_id, full_name,
               ROW_NUMBER() OVER (PARTITION BY tenant_id, full_name ORDER BY id) AS rn
          FROM staff_members
      )
      UPDATE staff_members sm
         SET full_name = sm.full_name || '-' || ranked.rn
        FROM ranked
       WHERE sm.id = ranked.id AND ranked.rn > 1
    `);
    await knex.raw(
      `CREATE UNIQUE INDEX staff_members_tenant_name_uniq
         ON staff_members (tenant_id, full_name)`
    );
  }
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS staff_members_tenant_name_uniq');
  await knex.raw('ALTER TABLE staff_members DROP COLUMN IF EXISTS frappe_employee_name');
  await knex.raw('ALTER TABLE staff_members DROP COLUMN IF EXISTS doctor_id');
  await knex.raw('ALTER TABLE staff_members DROP COLUMN IF EXISTS phone');
  await knex.raw('ALTER TABLE staff_members DROP COLUMN IF EXISTS position');
}
