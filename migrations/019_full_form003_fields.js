/**
 * H: 003-forma to'liqligini yakunlash.
 *
 * Rasmlardagi qog'oz 003-formada bor bo'lgan barcha maydonlarni tizimga
 * kiritamiz. Endi ekranda qog'ozdagi hech bir chiziqni "bo'sh" tark
 * etmasdan yozib chiqarish mumkin.
 *
 * admissions — muqova va yotqizish paytida yig'iladigan:
 *   - height_cm, weight_kg — antropometriya (kirish paytida)
 *   - temperature_on_admission — birinchi t°
 *   - transport_type — 'own' (o'zi), 'wheelchair' (aravacha), 'stretcher' (zambil)
 *   - referring_clinic — yo'llovchi klinika nomi
 *   - urgent_admission — shoshilinch keltirilgan (Ha/Yo'q)
 *   - transport_details — qanday transportda
 *   - time_since_onset — kasallik boshlangandan o'tgan vaqt (matn)
 *   - referral_diagnosis — yo'llanmadagi tashxis
 *   - diet_number — Pevzner parhez stoli №
 *   - treatment_plan — bo'lim mudiri tasdiqlagan davolash rejasi
 *   - head_reviewed_by / head_reviewed_at — bo'lim mudiri kim va qachon tasdiqlagan
 *
 * inpatient_services — bemor imzosi (ishlatilgan materiallarga rozilik):
 *   - patient_signed_at
 *
 * discharges — chiqarish oxirida qo'shilishi kerak bo'lganlar:
 *   - death_summary — o'limdan keyingi yakuniy xulosa (JSHSHIR bo'yicha jo'natiladi)
 *   - sent_to_polyclinic_at — elektron yuborish sanasi
 *   - polyclinic_ref — yuborilgan poliklinika identifikatori
 *   - auto_generated — LLM avto-tuzganmi (shifokor faqat tahrirlagan)
 */
export async function up(knex) {
  await knex.schema.alterTable('admissions', (t) => {
    t.float('height_cm');
    t.float('weight_kg');
    t.float('temperature_on_admission');
    t.string('transport_type', 20);           // 'own' | 'wheelchair' | 'stretcher'
    t.text('transport_details');
    t.text('referring_clinic');
    t.boolean('urgent_admission').defaultTo(false);
    t.text('time_since_onset');
    t.text('referral_diagnosis');
    t.string('diet_number', 10);              // Pevzner: '1', '5', '9', '15', ...
    t.text('treatment_plan');
    t.uuid('head_reviewed_by').references('id').inTable('doctors').onDelete('SET NULL');
    t.timestamp('head_reviewed_at');
  });

  await knex.schema.alterTable('inpatient_services', (t) => {
    t.timestamp('patient_signed_at');
  });

  await knex.schema.alterTable('discharges', (t) => {
    t.text('death_summary');
    t.timestamp('sent_to_polyclinic_at');
    t.string('polyclinic_ref', 100);
    t.boolean('auto_generated').defaultTo(false);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('discharges', (t) => {
    t.dropColumn('auto_generated');
    t.dropColumn('polyclinic_ref');
    t.dropColumn('sent_to_polyclinic_at');
    t.dropColumn('death_summary');
  });
  await knex.schema.alterTable('inpatient_services', (t) => {
    t.dropColumn('patient_signed_at');
  });
  await knex.schema.alterTable('admissions', (t) => {
    t.dropColumn('head_reviewed_at');
    t.dropColumn('head_reviewed_by');
    t.dropColumn('treatment_plan');
    t.dropColumn('diet_number');
    t.dropColumn('referral_diagnosis');
    t.dropColumn('time_since_onset');
    t.dropColumn('urgent_admission');
    t.dropColumn('referring_clinic');
    t.dropColumn('transport_details');
    t.dropColumn('transport_type');
    t.dropColumn('temperature_on_admission');
    t.dropColumn('weight_kg');
    t.dropColumn('height_cm');
  });
}
