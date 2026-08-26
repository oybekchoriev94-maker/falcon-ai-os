/**
 * Bosqich E: Retsept bajarish jurnali (003-forma 8-bet — dori-vositalari VARAG'I).
 *
 * Hozir prescriptions bor — shifokor buyuradi. Lekin qachon va kim tomonidan
 * bajarilgani (hamshira imzosi) yozilmaydi. 003-formada har dori qarshisida
 * kunlar bo'yicha ustunlarda "shifokor" va "hamshira" imzosi qo'yiladi.
 *
 * prescription_executions — har bajarilishning bir yozuvi.
 */
export async function up(knex) {
  await knex.schema.createTable('prescription_executions', (t) => {
    t.uuid('id').primary();
    t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('prescription_id').notNullable().references('id').inTable('prescriptions').onDelete('CASCADE');
    t.uuid('admission_id');           // qulaylik uchun denormalizatsiya (JOIN'siz)
    t.uuid('patient_id');
    t.timestamp('executed_at').defaultTo(knex.fn.now());
    t.uuid('nurse_id');
    t.text('nurse_name');
    t.string('shift', 20);            // 'ertalab' | 'kunduz' | 'kechqurun' | 'tun'
    t.text('notes');                  // reaksiya bo'lgan yoki tark etilganligi izohi
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['tenant_id', 'prescription_id']);
    t.index(['tenant_id', 'admission_id']);
  });

  // Parhez stoli (Pevzner №) — admissionga
  await knex.schema.alterTable('admissions', (t) => {
    t.integer('diet_number'); // 1..15
  });
}

export async function down(knex) {
  await knex.schema.alterTable('admissions', (t) => {
    t.dropColumn('diet_number');
  });
  await knex.schema.dropTableIfExists('prescription_executions');
}
