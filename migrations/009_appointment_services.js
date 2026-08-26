/**
 * M1: Bitta tashrifda bir nechta xizmat.
 *
 * Klinikada bemor ko'pincha bir kelishida bir nechta xizmat oladi
 * (masalan UZI + qon tahlili + ginekolog qabuli). Avval appointments'da
 * faqat bitta service_id bor edi.
 *
 * Orqaga moslik saqlanadi:
 *  - appointments.service_id — BIRINCHI (asosiy) xizmat, eski kod ishlayveradi
 *  - appointments.amount     — endi JAMI summa
 *  - appointment_services    — to'liq ro'yxat, chek shu yerdan chiqadi
 *
 * name/price snapshot sifatida saqlanadi: narx keyin o'zgarsa ham eski chek
 * o'zgarmasligi kerak (buxgalteriya talabi).
 */
export async function up(knex) {
  await knex.schema.createTable('appointment_services', (t) => {
    t.bigIncrements('id');
    t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.bigInteger('appointment_id').notNullable().references('id').inTable('appointments').onDelete('CASCADE');
    // Xizmat o'chirilsa ham chek buzilmasin — shuning uchun SET NULL + snapshot
    t.uuid('service_id').references('id').inTable('services_catalog').onDelete('SET NULL');
    t.text('name').notNullable();
    t.decimal('price', 12, 2).notNullable().defaultTo(0);
    t.integer('duration_min');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['tenant_id', 'appointment_id']);
  });

  // Mavjud bronlarni ko'chiramiz — chek/ro'yxat bir xil ishlashi uchun
  await knex.raw(`
    INSERT INTO appointment_services (tenant_id, appointment_id, service_id, name, price, duration_min)
    SELECT a.tenant_id, a.id, a.service_id,
           COALESCE(s.name, 'Xizmat'),
           COALESCE(a.amount, s.price, 0),
           s.duration_min
    FROM appointments a
    LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
    WHERE a.service_id IS NOT NULL
  `);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('appointment_services');
}
