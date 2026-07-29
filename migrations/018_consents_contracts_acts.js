/**
 * Bosqich F: Rozilik, shartnoma, akt (003-forma 13-16 bo'limlari).
 *
 *  - consent_templates: umumiy operatsiya, ginekologiya operatsiya,
 *    anesteziya, qon quyish uchun standart matn shabloni (klinika tomonidan
 *    yoziladi).
 *  - patient_consents: bemorning ma'lum bir shablonga imzosi (options
 *    tanlangan bo'lsa, JSON'da).
 *  - service_contracts: pullik xizmat shartnomasi (bir bemor uchun).
 *  - service_acts: bajarilgan xizmatlar dalolatnomasi (chiqarish paytida).
 *  - tenants ga rekvizit maydonlari (INN, MFO, hisob raqami, direktor).
 */
export async function up(knex) {
  // Tenant rekvizitlari — shartnoma/akt PDF'ida ishlatiladi
  await knex.schema.alterTable('tenants', (t) => {
    t.string('legal_name', 300);         // "Gulnigor Shifomed" xususiy korxonasi
    t.string('inn', 20);
    t.string('mfo', 20);
    t.string('bank_account', 30);
    t.string('bank_name', 200);
    t.string('legal_address', 500);
    t.string('director_name', 200);
    t.string('director_position', 100);
  });

  await knex.schema.createTable('consent_templates', (t) => {
    t.uuid('id').primary();
    t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('kind', 50).notNullable();   // 'surgery_general' | 'surgery_gyn' | 'anesthesia' | 'blood_transfusion' | 'custom'
    t.string('title', 300).notNullable();
    t.text('body_md');                    // matn (markdown)
    t.jsonb('checkboxes_json');           // [{id, label, required}]
    t.boolean('active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['tenant_id', 'kind', 'active']);
  });

  await knex.schema.createTable('patient_consents', (t) => {
    t.uuid('id').primary();
    t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('admission_id').references('id').inTable('admissions').onDelete('SET NULL');
    t.uuid('template_id').references('id').inTable('consent_templates').onDelete('SET NULL');
    t.string('kind', 50).notNullable();
    t.string('title', 300);
    t.jsonb('selected_options');          // checkboxes tanlanganlari
    t.text('notes');
    t.text('signature_image');            // base64 yoki uploaded path (ixtiyoriy)
    t.timestamp('signed_at').defaultTo(knex.fn.now());
    t.uuid('collected_by');
    t.text('collected_by_name');
    t.text('pdf_path');
    t.index(['tenant_id', 'patient_id']);
    t.index(['tenant_id', 'admission_id']);
  });

  await knex.schema.createTable('service_contracts', (t) => {
    t.uuid('id').primary();
    t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('contract_number', 50).notNullable();
    t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('admission_id').references('id').inTable('admissions').onDelete('SET NULL');
    t.text('patient_name');
    t.text('patient_passport');
    t.text('patient_address');
    t.text('sponsor_name');               // Homiy (uchinchi shaxs)
    t.text('sponsor_passport');
    t.timestamp('contract_date').defaultTo(knex.fn.now());
    t.jsonb('items_json');                // [{name, unit, qty, price, sum}]
    t.decimal('total_amount', 14, 2).defaultTo(0);
    t.text('pdf_path');
    t.timestamp('signed_at');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'contract_number']);
    t.index(['tenant_id', 'patient_id']);
    t.index(['tenant_id', 'admission_id']);
  });

  await knex.schema.createTable('service_acts', (t) => {
    t.uuid('id').primary();
    t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.string('act_number', 50).notNullable();
    t.uuid('contract_id').references('id').inTable('service_contracts').onDelete('SET NULL');
    t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('admission_id').references('id').inTable('admissions').onDelete('SET NULL');
    t.timestamp('act_date').defaultTo(knex.fn.now());
    t.jsonb('items_json');                // [{name, unit, qty, price, sum}]
    t.decimal('total_amount', 14, 2).defaultTo(0);
    t.decimal('paid_amount', 14, 2).defaultTo(0);
    t.decimal('balance', 14, 2).defaultTo(0);
    t.text('pdf_path');
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.unique(['tenant_id', 'act_number']);
    t.index(['tenant_id', 'patient_id']);
    t.index(['tenant_id', 'admission_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('service_acts');
  await knex.schema.dropTableIfExists('service_contracts');
  await knex.schema.dropTableIfExists('patient_consents');
  await knex.schema.dropTableIfExists('consent_templates');
  await knex.schema.alterTable('tenants', (t) => {
    t.dropColumn('director_position');
    t.dropColumn('director_name');
    t.dropColumn('legal_address');
    t.dropColumn('bank_name');
    t.dropColumn('bank_account');
    t.dropColumn('mfo');
    t.dropColumn('inn');
    t.dropColumn('legal_name');
  });
}
