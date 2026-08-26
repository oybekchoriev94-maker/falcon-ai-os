/**
 * Shifokor tasdig'i oqimi (roadmap PR #7 — RubaiSTT klinik qabul).
 *
 * MUAMMO: AI diktantdan ajratgan yozuv darhol YAKUNIY deb saqlanardi.
 * Yo'l xarita talabi: "shifokor tasdig'idan keyingina saqlash" — LLM
 * xato qilishi mumkin (doza, dori nomi, son), tasdiqsiz yozuv bemor
 * kartasiga tushsa javobgarlik noaniq bo'ladi.
 *
 * YECHIM: patient_consultations.status:
 *   - 'draft'     — AI yaratgan, shifokor hali ko'rmagan/tahrirlayapti;
 *   - 'confirmed' — shifokor tasdiqlagan, bemor tarixiga kiradi.
 *
 * MAVJUD yozuvlar 'confirmed' bo'lib qoladi (ular allaqachon kartada,
 * orqaga qaytarish ma'lumotni "yo'qotish" bilan teng edi). Yangi diktantlar
 * kod tomonidan aniq 'draft' bilan kiritiladi.
 */

export async function up(knex) {
  if (!(await knex.schema.hasColumn('patient_consultations', 'status'))) {
    await knex.raw(
      `ALTER TABLE patient_consultations
         ADD COLUMN status varchar(20) NOT NULL DEFAULT 'confirmed'`
    );
    await knex.raw(
      `CREATE INDEX consultations_status_idx
         ON patient_consultations (tenant_id, doctor_id, status)`
    );
  }
  if (!(await knex.schema.hasColumn('patient_consultations', 'confirmed_at'))) {
    await knex.raw('ALTER TABLE patient_consultations ADD COLUMN confirmed_at timestamp');
  }
  if (!(await knex.schema.hasColumn('patient_consultations', 'confirmed_by'))) {
    await knex.raw('ALTER TABLE patient_consultations ADD COLUMN confirmed_by uuid');
  }
  // Eski yozuvlarga tasdiq vaqti sifatida yaratilgan vaqt qo'yiladi —
  // timeline'da "qachon tasdiqlangan" savoli javobsiz qolmasin.
  await knex.raw(
    `UPDATE patient_consultations
        SET confirmed_at = created_at
      WHERE status = 'confirmed' AND confirmed_at IS NULL`
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS consultations_status_idx');
  await knex.raw('ALTER TABLE patient_consultations DROP COLUMN IF EXISTS confirmed_by');
  await knex.raw('ALTER TABLE patient_consultations DROP COLUMN IF EXISTS confirmed_at');
  await knex.raw('ALTER TABLE patient_consultations DROP COLUMN IF EXISTS status');
}
