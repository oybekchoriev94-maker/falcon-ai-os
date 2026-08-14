/**
 * Bemor "keldi" (check-in) — navbat endi BRONga emas, HAQIQATDA
 * kelganlarga asoslanadi.
 *
 * Muammo: TV ekran va navbat bugungi barcha bronlarni ko'rsatardi,
 * bemor kelgan-kelmaganidan qat'i nazar. Kioskda, qabulxonada yoki
 * Telegram orqali bron qilib kelmagan odam ham "navbatda" bo'lib
 * ko'rinar, bu bemor ishonchini pasaytiradi.
 *
 * Yechim: uchala kanal (kiosk, registratura, Telegram) BITTA umumiy
 * check-in funksiyasi orqali arrived_at'ni belgilaydi
 * (backend/services/appointment-checkin.js). Navbat shundan keyin
 * faqat arrived_at IS NOT NULL bo'lganlarni ko'rsatadi.
 */
export async function up(knex) {
  const hasArrived = await knex.schema.hasColumn('appointments', 'arrived_at');
  if (!hasArrived) {
    await knex.schema.alterTable('appointments', (t) => {
      t.timestamp('arrived_at');
      // 'kiosk' | 'registratura' | 'telegram'
      t.string('checked_in_source', 20);
      t.uuid('checked_in_by').references('id').inTable('users').onDelete('SET NULL');
    });
  }

  // Avto no-show skaneri shu bo'yicha yuradi (backend/cron/patient-reminders.js).
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS appointments_noshow_scan_idx
    ON appointments (tenant_id, scheduled_at)
    WHERE status IN ('scheduled', 'confirmed') AND arrived_at IS NULL
  `);
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS appointments_noshow_scan_idx');
  const hasArrived = await knex.schema.hasColumn('appointments', 'arrived_at');
  if (hasArrived) {
    await knex.schema.alterTable('appointments', (t) => {
      t.dropColumn('arrived_at');
      t.dropColumn('checked_in_source');
      t.dropColumn('checked_in_by');
    });
  }
}
