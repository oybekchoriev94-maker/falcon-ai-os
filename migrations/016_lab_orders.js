/**
 * Bosqich D: Laborator tekshiruvlar (003-forma 4-bet — "Tekshiruv rejasi").
 *
 * 10 ta standart tekshiruv (checklist):
 *  1. Umumiy qon
 *  2. Umumiy peshob
 *  3. Bioximik tahlil
 *  4. Koagulogramma
 *  5. EKG
 *  6. Rentgen
 *  7. UTT (UZI)
 *  8. EFGDS
 *  9. MSKT/MRT
 * 10. Mutaxasislar maslahati
 *
 * Va custom tekshiruv (test_name matn).
 */
export async function up(knex) {
  await knex.schema.createTable('lab_orders', (t) => {
    t.uuid('id').primary();
    t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('admission_id').references('id').inTable('admissions').onDelete('SET NULL');
    t.bigInteger('appointment_id').references('id').inTable('appointments').onDelete('SET NULL');

    // Buyuruvchi shifokor
    t.uuid('ordered_by_doctor_id');
    t.text('ordered_by_doctor_name');
    t.timestamp('ordered_at').defaultTo(knex.fn.now());

    // Tekshiruv turi va nomi
    // type: 'blood_general' | 'urine_general' | 'biochem' | 'coagulo' | 'ekg' |
    //       'rentgen' | 'uzi' | 'efgds' | 'msct_mrt' | 'specialist' | 'custom'
    t.string('test_type', 30).notNullable();
    t.text('test_name');            // custom uchun aniq nom
    t.text('reason');               // nima uchun buyurildi

    // Holat: 'ordered' -> 'in_progress' -> 'completed' | 'cancelled'
    t.string('status', 20).defaultTo('ordered');
    t.timestamp('completed_at');
    t.uuid('performed_by');
    t.text('performed_by_name');

    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['tenant_id', 'patient_id']);
    t.index(['tenant_id', 'admission_id']);
    t.index(['tenant_id', 'status']);
  });

  await knex.schema.createTable('lab_results', (t) => {
    t.uuid('id').primary();
    t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('lab_order_id').notNullable().references('id').inTable('lab_orders').onDelete('CASCADE');
    t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');

    // Natija — tuzilgan qiymatlar (Hb, WBC, HCT ... yoki custom key:value)
    t.jsonb('values_json');         // { Hb: 12.5, WBC: 7.2, ... }
    t.text('conclusion');           // xulosaviy matn
    t.text('pdf_path');             // skanned PDF yoki generated report

    t.uuid('entered_by');
    t.text('entered_by_name');
    t.timestamp('entered_at').defaultTo(knex.fn.now());

    t.index(['tenant_id', 'patient_id']);
    t.index(['tenant_id', 'lab_order_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('lab_results');
  await knex.schema.dropTableIfExists('lab_orders');
}
