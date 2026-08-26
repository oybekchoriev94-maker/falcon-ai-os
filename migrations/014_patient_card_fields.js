/**
 * Bosqich A: Bemor kartasi maydonlarini 003-forma bo'yicha kengaytirish.
 *
 * Kontekst: hozirgi patients jadvalida qon guruhi, allergiya, kasb,
 * qarindosh telefoni yo'q — bular 003-formada bemorning muqovasida bor.
 *
 * Yechim: nullable maydonlar (barchasi optional; eski yozuvlar buzilmasin).
 */
export async function up(knex) {
  await knex.schema.alterTable('patients', (t) => {
    // Qon guruhi va Rh — favqulodda tibbiy holatda birinchi bo'lib kerak
    t.string('blood_group', 5);      // 'O', 'A', 'B', 'AB'
    t.string('rh_factor', 5);        // '+', '-'

    // Allergiya va dorilarga nojo'ya ta'sir — buyurishdan oldin ogohlantirish
    t.text('allergies');

    // Ijtimoiy / demografik ma'lumot (003-formada majburiy)
    t.string('occupation', 200);
    t.string('workplace', 200);
    t.string('disability_group', 20);  // 'I', 'II', 'III' yoki bo'sh

    // Yaqin qarindosh — bemor gapirolmaydigan holatda
    t.string('emergency_contact_name', 200);
    t.string('emergency_contact_phone', 20);
    t.string('emergency_contact_relation', 50);  // 'ota', 'ona', 'er', 'xotin', ...
  });
}

export async function down(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('emergency_contact_relation');
    t.dropColumn('emergency_contact_phone');
    t.dropColumn('emergency_contact_name');
    t.dropColumn('disability_group');
    t.dropColumn('workplace');
    t.dropColumn('occupation');
    t.dropColumn('allergies');
    t.dropColumn('rh_factor');
    t.dropColumn('blood_group');
  });
}
