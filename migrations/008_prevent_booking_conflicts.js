/**
 * P2a: Bir vaqtda bir shifokorga faqat bitta bemor yozila oladi.
 *
 * Muammo: reception ham, Telegram Mini App ham parallel booking qilishi mumkin.
 * Ilova qatlamida check-then-insert to'qnashuvni to'liq oldini olmaydi (race).
 * Yechim: PostgreSQL partial unique index — DB darajasida atomik kafolat.
 *
 * Boshqa maydonlar:
 *  - payment_method: online (Payme/Click link) yoki cashier (klinikada naqd/karta)
 *  - access_code: kassir shu kod bo'yicha bemorni topsin (Telegramdan kelgani uchun)
 */
export async function up(knex) {
  await knex.schema.alterTable('appointments', (t) => {
    t.string('payment_method', 20).notNullable().defaultTo('cashier'); // online | cashier
    t.string('access_code', 12); // 6-8 belgi, Telegram->kassir aloqasi uchun
  });

  // Yagona index — cancelled/no-show bandlar to'qnashuvni ta'sir qilmaydi.
  // scheduled_at NULL bo'lsa (masalan navbat, kelgan tartibda) — cheklov qo'llanmaydi.
  await knex.raw(`
    CREATE UNIQUE INDEX appointments_doctor_slot_unique
    ON appointments (tenant_id, doctor_id, scheduled_at)
    WHERE scheduled_at IS NOT NULL
      AND doctor_id IS NOT NULL
      AND status NOT IN ('cancelled', 'no_show')
  `);

  // Access code — tenant ichida takrorlanmasin (Telegram bemori kassaga kod bilan keladi)
  await knex.raw(`
    CREATE UNIQUE INDEX appointments_access_code_unique
    ON appointments (tenant_id, access_code)
    WHERE access_code IS NOT NULL
  `);
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS appointments_access_code_unique');
  await knex.raw('DROP INDEX IF EXISTS appointments_doctor_slot_unique');
  await knex.schema.alterTable('appointments', (t) => {
    t.dropColumn('access_code');
    t.dropColumn('payment_method');
  });
}
