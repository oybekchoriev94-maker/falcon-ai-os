// ============================================================
// Face ID tizimini olib tashlash — biometrik ma'lumotlarni to'liq o'chirish
// (O'zbekiston "Shaxsga doir ma'lumotlar to'g'risida"gi qonuni + GDPR:
//  kerak bo'lmagan biometrik ma'lumot saqlanmasligi kerak)
// ============================================================

export async function up(knex) {
  // 1. Biometrik deskriptorlar
  if (await knex.schema.hasColumn('patients', 'face_descriptor')) {
    await knex.schema.alterTable('patients', (t) => t.dropColumn('face_descriptor'));
  }
  if (await knex.schema.hasColumn('doctors', 'face_descriptor')) {
    await knex.schema.alterTable('doctors', (t) => t.dropColumn('face_descriptor'));
  }

  // 2. Face ID jurnallari va rozilik yozuvlari
  await knex.schema.dropTableIfExists('face_logs');
  await knex.schema.dropTableIfExists('consent_logs');

  // 3. Tarif rejalaridagi face_id bayrog'i endi ma'nosiz
  if (await knex.schema.hasColumn('subscription_plans', 'face_id_enabled')) {
    await knex.schema.alterTable('subscription_plans', (t) => t.dropColumn('face_id_enabled'));
  }
}

export async function down(knex) {
  // Biometrik ma'lumot qaytarilmaydi (qasddan) — faqat struktura tiklanadi
  if (!(await knex.schema.hasColumn('patients', 'face_descriptor'))) {
    await knex.schema.alterTable('patients', (t) => t.text('face_descriptor'));
  }
  if (!(await knex.schema.hasColumn('doctors', 'face_descriptor'))) {
    await knex.schema.alterTable('doctors', (t) => t.text('face_descriptor'));
  }
  if (!(await knex.schema.hasColumn('subscription_plans', 'face_id_enabled'))) {
    await knex.schema.alterTable('subscription_plans', (t) => t.boolean('face_id_enabled').defaultTo(false));
  }
}
