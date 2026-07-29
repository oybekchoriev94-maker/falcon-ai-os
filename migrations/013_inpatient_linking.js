/**
 * R1a: Statsionar↔bemor bog'lash + AI obhod maydonlari.
 *
 * Kontekst:
 *  - admissions.patient_id ustuni bor, lekin FK constraint yo'q — orfan
 *    yozuvlar mumkin va JOIN sekin ishlaydi.
 *  - Yotqizish qaysi qabuldan (bron/tashrif) kelganini kuzatib bo'lmaydi.
 *  - Obhod (daily_notes) — hozircha oddiy raqamli maydonlar. Ovozli
 *    obhod uchun matn (raw_text), AI xulosa (ai_summary), tuzilgan
 *    JSON (data_json) kerak.
 *
 * Yechim:
 *  - admissions.patient_id — FK constraint + index
 *  - admissions.appointment_id — nullable FK (yotqizish qaysi qabuldan)
 *  - daily_notes.patient_id — kartaga to'g'ridan-to'g'ri JOIN uchun
 *  - daily_notes.raw_text, ai_summary, data_json — ovozli obhod uchun
 *
 * Backfill: mavjud admissions'da patient_id NULL qolishi mumkin (eski
 * yozuvlar; nom bo'yicha bog'lash noaniq). FK NULL'ni qabul qiladi.
 */
export async function up(knex) {
  // 1) admissions — patient_id FK va appointment_id
  await knex.schema.alterTable('admissions', (t) => {
    // patient_id ustuni allaqachon bor, lekin references yo'q. Constraint
    // qo'shishdan oldin buzilgan qiymatlarni NULL qilamiz (agar bo'lsa).
  });
  await knex.raw(`
    UPDATE admissions a
       SET patient_id = NULL
     WHERE patient_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM patients p WHERE p.id = a.patient_id)
  `);
  await knex.raw(`
    ALTER TABLE admissions
      ADD CONSTRAINT admissions_patient_id_fkey
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
  `);
  await knex.raw(`CREATE INDEX admissions_tenant_patient_idx ON admissions (tenant_id, patient_id)`);

  await knex.schema.alterTable('admissions', (t) => {
    t.bigInteger('appointment_id').references('id').inTable('appointments').onDelete('SET NULL');
    t.index(['tenant_id', 'appointment_id']);
  });

  // 2) daily_notes — obhod: bemor bog'lanishi va ovoz/AI maydonlari
  await knex.schema.alterTable('daily_notes', (t) => {
    t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    t.text('raw_text');         // whisper transkripti
    t.text('ai_summary');       // LLM qisqa xulosasi (shifokorga)
    t.jsonb('data_json');       // tuzilgan maydonlar (temp, bp, complaint, ...)
    t.index(['tenant_id', 'patient_id']);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('daily_notes', (t) => {
    t.dropIndex(['tenant_id', 'patient_id']);
    t.dropColumn('data_json');
    t.dropColumn('ai_summary');
    t.dropColumn('raw_text');
    t.dropColumn('patient_id');
  });
  await knex.schema.alterTable('admissions', (t) => {
    t.dropIndex(['tenant_id', 'appointment_id']);
    t.dropColumn('appointment_id');
  });
  await knex.raw('DROP INDEX IF EXISTS admissions_tenant_patient_idx');
  await knex.raw('ALTER TABLE admissions DROP CONSTRAINT IF EXISTS admissions_patient_id_fkey');
}
