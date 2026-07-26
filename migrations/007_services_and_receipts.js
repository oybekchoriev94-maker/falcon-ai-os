/**
 * P1a: Xizmatlar narxi + navbat/hisob bog'lash + chek maydonlari.
 *
 * Nima o'zgaradi:
 *  - services_catalog: price, duration_min, specialty, active
 *  - appointments: service_id, doctor_id, scheduled_at, amount, payment_status
 *  - payment_transactions: appointment_id, receipt_number, cash_received, change_given,
 *    cashier_id, printed_at
 *
 * receipt_number (tenant, receipt_number) unique — har bir tenant o'z ketma-ketligini yuritadi.
 * Ketma-ket raqamlash kod tomonida (max+1 tenant ichida) — bir tenantda parallel yozuv juda kam,
 * to'qnashuv bo'lsa retry qilinadi. Global sequence umumiy raqamlashni afsuslanarli qilar edi.
 */
export async function up(knex) {
  await knex.schema.alterTable('services_catalog', (t) => {
    // O'zbek so'm; float o'rniga numeric — pul uchun aniqroq
    t.decimal('price', 12, 2).notNullable().defaultTo(0);
    t.integer('duration_min').defaultTo(15);
    // Qaysi shifokor mutaxassisligi bajaradi (doctor.specialization bilan mos)
    t.string('specialty', 50);
    t.boolean('active').notNullable().defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('updated_at').defaultTo(knex.fn.now());
    t.index(['tenant_id', 'active']);
    t.index(['tenant_id', 'specialty']);
  });

  await knex.schema.alterTable('appointments', (t) => {
    t.uuid('service_id').references('id').inTable('services_catalog').onDelete('SET NULL');
    // doctors.id — uuid. Eski doctor_name (text) ham qoladi (backfill uchun).
    t.uuid('doctor_id').references('id').inTable('doctors').onDelete('SET NULL');
    t.timestamp('scheduled_at');
    t.decimal('amount', 12, 2).defaultTo(0);
    // pending | paid | refunded | cancelled
    t.string('payment_status', 20).notNullable().defaultTo('pending');
    t.index(['tenant_id', 'scheduled_at']);
    t.index(['tenant_id', 'doctor_id', 'scheduled_at']);
    t.index(['tenant_id', 'payment_status']);
  });

  await knex.schema.alterTable('payment_transactions', (t) => {
    t.bigInteger('appointment_id').references('id').inTable('appointments').onDelete('SET NULL');
    t.integer('receipt_number');
    t.decimal('cash_received', 12, 2);
    t.decimal('change_given', 12, 2);
    t.uuid('cashier_id'); // FK yo'q — kassir doctors yoki users da bo'lishi mumkin
    t.timestamp('printed_at');
    // Bir tenantda chek raqami takrorlanmasin (NULL bir necha bo'lishi mumkin)
    t.unique(['tenant_id', 'receipt_number']);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('payment_transactions', (t) => {
    t.dropUnique(['tenant_id', 'receipt_number']);
    t.dropColumn('printed_at');
    t.dropColumn('cashier_id');
    t.dropColumn('change_given');
    t.dropColumn('cash_received');
    t.dropColumn('receipt_number');
    t.dropColumn('appointment_id');
  });
  await knex.schema.alterTable('appointments', (t) => {
    t.dropIndex(['tenant_id', 'payment_status']);
    t.dropIndex(['tenant_id', 'doctor_id', 'scheduled_at']);
    t.dropIndex(['tenant_id', 'scheduled_at']);
    t.dropColumn('payment_status');
    t.dropColumn('amount');
    t.dropColumn('scheduled_at');
    t.dropColumn('doctor_id');
    t.dropColumn('service_id');
  });
  await knex.schema.alterTable('services_catalog', (t) => {
    t.dropIndex(['tenant_id', 'specialty']);
    t.dropIndex(['tenant_id', 'active']);
    t.dropColumn('updated_at');
    t.dropColumn('created_at');
    t.dropColumn('active');
    t.dropColumn('specialty');
    t.dropColumn('duration_min');
    t.dropColumn('price');
  });
}
