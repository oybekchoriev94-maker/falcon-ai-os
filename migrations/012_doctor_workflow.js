/**
 * D1a: Shifokor ish stoli — bog'lanishlar.
 *
 * Muammo:
 *  1) patient_consultations qaysi bronga tegishli ekani bilinmaydi
 *     (shifokor "ko'rikni yakunladim" deganda qaysi appointment yopilishi noaniq).
 *  2) referrals jadvali B2B tashqi klinika uchun mo'ljallangan. Ichki
 *     yo'llanma (ginekolog -> roddom, shifokor -> shifokor) uchun maydonlar
 *     yetishmaydi: from_doctor_id, to_doctor_id, to_department, kind.
 *
 * Yechim:
 *  - patient_consultations.appointment_id — nullable FK (eski yozuvlar buzilmasin)
 *  - referrals.kind — 'b2b' (mavjud xatti-harakat) yoki 'internal' (yangi)
 *  - referrals.from_doctor_id, to_doctor_id, to_department — ichki yo'llanma uchun
 *
 * Backfill YO'Q: eski konsultatsiyalar appointment_id NULL bo'lib qoladi;
 * mavjud referrals hammasi kind='b2b' bilan ishlaydi (default).
 */
export async function up(knex) {
  await knex.schema.alterTable('patient_consultations', (t) => {
    t.bigInteger('appointment_id').references('id').inTable('appointments').onDelete('SET NULL');
    t.index(['tenant_id', 'appointment_id']);
  });

  await knex.schema.alterTable('referrals', (t) => {
    t.string('kind', 20).defaultTo('b2b');           // 'b2b' | 'internal'
    t.uuid('from_doctor_id').references('id').inTable('doctors').onDelete('SET NULL');
    t.uuid('to_doctor_id').references('id').inTable('doctors').onDelete('SET NULL');
    t.string('to_department', 100);                    // "Roddom", "Xirurgiya" — shifokor tanlamagan bo'lsa
    t.index(['tenant_id', 'kind', 'to_doctor_id']);
    t.index(['tenant_id', 'kind', 'to_department', 'status']);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('referrals', (t) => {
    t.dropIndex(['tenant_id', 'kind', 'to_department', 'status']);
    t.dropIndex(['tenant_id', 'kind', 'to_doctor_id']);
    t.dropColumn('to_department');
    t.dropColumn('to_doctor_id');
    t.dropColumn('from_doctor_id');
    t.dropColumn('kind');
  });
  await knex.schema.alterTable('patient_consultations', (t) => {
    t.dropIndex(['tenant_id', 'appointment_id']);
    t.dropColumn('appointment_id');
  });
}
