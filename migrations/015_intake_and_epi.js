/**
 * Bosqich B: Birlamchi qabul ko'rigi + Epi-anamnez (SanPIN 03-42-17).
 *
 * Kontekst:
 *  - 003-formaning 3-beti — qabul bo'limi shifokorining birlamchi ko'rigi:
 *    shikoyat (og'riq joylashuvi, xususiyati), anamnez morbi, vitae,
 *    status praesens, status localis, taxminiy tashxis.
 *  - 003-formaning 6-beti — SanPIN infekcion anamnez: kontakt, sayohat,
 *    o'tkirgan kasalliklar, gemotransfuziya, parenteral muolaja, maishiy
 *    xizmat (manikyur/pirsing/tatuaj).
 *
 * Ikkalasi ham yotqizish paytida bir marta to'ldiriladi. patient_id + admission_id
 * bilan bog'lanadi (poliklinikadan kirilsa admission_id NULL).
 */
export async function up(knex) {
  await knex.schema.createTable('patient_intake_examinations', (t) => {
    t.uuid('id').primary();
    t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('admission_id').references('id').inTable('admissions').onDelete('SET NULL');
    t.timestamp('examined_at').defaultTo(knex.fn.now());
    t.uuid('doctor_id');
    t.text('doctor_name');

    // Keltirilish usuli: 'ozi_kelgan' | 'ttyo' | 'boshqa_dpm'
    t.string('brought_by', 30);

    // Shikoyat blogi (matn)
    t.text('complaint_pain');           // og'riq matni
    t.text('complaint_pain_location');  // joylashuvi
    t.text('complaint_pain_character'); // xususiyati (achishuv, sanchuv, buruvchi...)
    t.text('complaint_pain_onset');     // og'riqli xuruj boshlanishi
    t.text('complaint_other');          // boshqa shikoyatlar

    // Anamnez
    t.text('anamnesis_morbi');          // kasallik tarixi
    t.text('anamnesis_vitae');          // hayot anamnezi

    // Ob'ektiv holat
    t.text('status_praesens');          // umumiy patologik o'zgarishlar
    t.text('status_localis');           // mahalliy holat

    // Xulosa
    t.text('preliminary_diagnosis');    // taxminiy tashxis

    // Ovozli yozuvni ham qoldiramiz (agar shifokor gapirib to'ldirgan bo'lsa)
    t.text('raw_text');
    t.jsonb('data_json');

    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['tenant_id', 'patient_id']);
    t.index(['tenant_id', 'admission_id']);
  });

  await knex.schema.createTable('patient_epi_anamnesis', (t) => {
    t.uuid('id').primary();
    t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
    t.uuid('patient_id').references('id').inTable('patients').onDelete('SET NULL');
    t.uuid('admission_id').references('id').inTable('admissions').onDelete('SET NULL');
    t.timestamp('collected_at').defaultTo(knex.fn.now());
    t.uuid('doctor_id');
    t.text('doctor_name');

    // 1) Infekcion kontakt (SanPIN 03-42-17 §1)
    t.boolean('infection_contact').defaultTo(false);
    t.text('infection_contact_details');   // qaysi kasallik, qayerda, qachondan-qachongacha

    // 2) Sayohat (2 hafta / 1 oy ichida)
    t.boolean('travel_last_month').defaultTo(false);
    t.text('travel_details');              // qayerga, qachon qaytgan

    // 3) O'tkirgan infekcion kasalliklar
    t.text('past_infections');             // erkin matn

    // 4) Statsionar/ambulator davolanish + gemotransfuziya + jarrohlik (6 oyda)
    t.boolean('had_hospitalization').defaultTo(false);
    t.boolean('had_transfusion').defaultTo(false);
    t.boolean('had_surgery_6mo').defaultTo(false);
    t.text('hospitalization_details');

    // 5) Parenteral muolaja
    t.boolean('parenteral_procedures').defaultTo(false);
    t.text('parenteral_details');

    // 6) Maishiy xizmat (manikyur/pedikyur/pirsing/tatuaj)
    t.boolean('cosmetic_services').defaultTo(false);
    t.text('cosmetic_details');            // qayerda va qachon

    // Yakuniy
    t.text('epi_diagnosis');               // shu asosdagi taxmin (masalan HBV riski)
    t.text('management_plan');             // olib borish tartibi

    t.text('raw_text');
    t.jsonb('data_json');

    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['tenant_id', 'patient_id']);
    t.index(['tenant_id', 'admission_id']);
  });
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('patient_epi_anamnesis');
  await knex.schema.dropTableIfExists('patient_intake_examinations');
}
