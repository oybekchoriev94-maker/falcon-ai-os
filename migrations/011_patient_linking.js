/**
 * B1a: Bemor shaxsini bog'lash.
 *
 * Muammo: appointments.patient_name — oddiy matn, patient_id yo'q.
 * Xuddi shu bemor ikki marta kelsa — tarixi bog'lanmaydi, istoriya ochilmaydi.
 *
 * Yechim:
 *  1) appointments.patient_id — nullable FK (eski yozuvlar buzilmasin)
 *  2) patient_consultations.patient_id — xuddi shunday
 *  3) patients (tenant, mrn) partial unique — MRN har klinikada takrorlanmasin,
 *     lekin NULL MRN'ga cheklov yo'q (eski bemorlar MRN'siz qoladi)
 *  4) patients (tenant, phone) partial unique — bir raqamda ikki karta bo'lmasin
 *
 * Backfill YO'Q: nom bo'yicha bog'lash noaniq (nomlar takrorlanadi). MRN yangi
 * bemorlardan boshlanadi, eski bronlar oddiy matn sifatida qoladi va qidiruvda
 * ko'rinadi — ular haqiqiy karta ochilganda qo'lda biriktiriladi.
 */
export async function up(knex) {
  // DIQQAT: idempotent — 007_tenant_isolation_and_tma_integrity (boshqa
  // branch'dan kelgan dublikat raqamli migratsiya) patient_consultations
  // .patient_id ni OLDINROQ qo'shib qo'yadi. CI'da toza bazada "column
  // already exists" bilan yiqilgan (2026-08-26). Shu sababli ustun va
  // indekslar faqat yo'q bo'lsa qo'shiladi.
  if (!(await knex.schema.hasColumn('appointments', 'patient_id'))) {
    await knex.schema.alterTable('appointments', (t) => {
      t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    });
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS appointments_tenant_id_patient_id_index
    ON appointments (tenant_id, patient_id)`);

  if (!(await knex.schema.hasColumn('patient_consultations', 'patient_id'))) {
    await knex.schema.alterTable('patient_consultations', (t) => {
      t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    });
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS patient_consultations_tenant_id_patient_id_index
    ON patient_consultations (tenant_id, patient_id)`);

  // MRN — klinika ichida noyob. NULL bo'lsa cheklov qo'llanmaydi (eski bemorlar).
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS patients_tenant_mrn_unique
    ON patients (tenant_id, medical_record_number)
    WHERE medical_record_number IS NOT NULL
  `);

  // Telefon — normalizatsiya qilingan (faqat raqamlar) ko'rinishda noyob.
  // Application layer +998XXXXXXXXX saqlaydi; NULL cheklovsiz.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS patients_tenant_phone_unique
    ON patients (tenant_id, phone)
    WHERE phone IS NOT NULL AND phone <> ''
  `);
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS patients_tenant_phone_unique');
  await knex.raw('DROP INDEX IF EXISTS patients_tenant_mrn_unique');
  await knex.schema.alterTable('patient_consultations', (t) => {
    t.dropIndex(['tenant_id', 'patient_id']);
    t.dropColumn('patient_id');
  });
  await knex.schema.alterTable('appointments', (t) => {
    t.dropIndex(['tenant_id', 'patient_id']);
    t.dropColumn('patient_id');
  });
}
