/**
 * H: 003-forma to'liqligini yakunlash.
 *
 * Rasmlardagi qog'oz 003-formada bor bo'lgan barcha maydonlarni tizimga
 * kiritamiz. Endi ekranda qog'ozdagi hech bir chiziqni "bo'sh" tark
 * etmasdan yozib chiqarish mumkin.
 *
 * IDEMPOTENT: har bir ustun uchun IF NOT EXISTS ishlatiladi, chunki VPS
 * bazasida oldindan qo'shilgan ustunlar (masalan `diet_number`) bo'lishi
 * mumkin — bu migratsiyaning har muhitda muvaffaqiyatli ishlashini kafolatlaydi.
 */

const ADMISSIONS_COLS = [
  ['height_cm', 'real'],
  ['weight_kg', 'real'],
  ['temperature_on_admission', 'real'],
  ['transport_type', 'varchar(20)'],
  ['transport_details', 'text'],
  ['referring_clinic', 'text'],
  ['urgent_admission', 'boolean DEFAULT false'],
  ['time_since_onset', 'text'],
  ['referral_diagnosis', 'text'],
  ['diet_number', 'varchar(10)'],
  ['treatment_plan', 'text'],
  ['head_reviewed_by', 'uuid REFERENCES doctors(id) ON DELETE SET NULL'],
  ['head_reviewed_at', 'timestamptz'],
];

const DISCHARGES_COLS = [
  ['death_summary', 'text'],
  ['sent_to_polyclinic_at', 'timestamptz'],
  ['polyclinic_ref', 'varchar(100)'],
  ['auto_generated', 'boolean DEFAULT false'],
];

const SERVICES_COLS = [
  ['patient_signed_at', 'timestamptz'],
];

async function addColumns(knex, table, cols) {
  for (const [name, type] of cols) {
    await knex.raw(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${name}" ${type}`);
  }
}

async function dropColumns(knex, table, cols) {
  for (const [name] of cols) {
    await knex.raw(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${name}"`);
  }
}

export async function up(knex) {
  await addColumns(knex, 'admissions', ADMISSIONS_COLS);
  await addColumns(knex, 'discharges', DISCHARGES_COLS);
  await addColumns(knex, 'inpatient_services', SERVICES_COLS);
}

export async function down(knex) {
  await dropColumns(knex, 'inpatient_services', SERVICES_COLS);
  await dropColumns(knex, 'discharges', DISCHARGES_COLS);
  await dropColumns(knex, 'admissions', ADMISSIONS_COLS);
}
