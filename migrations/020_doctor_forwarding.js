/**
 * I: Doktor→doktor yo'naltirish zanjiri.
 *
 * Muammo: doktor bemorni tekshirgach, boshqa doktorga yuborishi mumkin
 * (masalan terapevt → kardiolog). Hozir "Yo'llanma" bor, lekin u
 * `referrals` jadvaliga yozardi va yangi appointment yaratmasdi. Kassa
 * bu yo'llanmani hisob-kitobga qo'sha olmasdi.
 *
 * Yechim: doktor "Boshqa shifokorga yuborish" bosgach, YANGI appointment
 * yaratiladi (`payment_status='pending'`). Bu bron kassada avtomatik
 * ko'rinadi. Bemor to'lagach, keyingi doktor navbatiga tushadi. Yangi
 * bronda `forwarded_from_appointment_id` — oldingi tashrifga havola —
 * shu tufayli 2-doktor 1-doktorning xulosasini darrov ko'radi.
 *
 * IDEMPOTENT: IF NOT EXISTS ishlatiladi (VPS'da qayta yugurtirishga
 * chidamli).
 */
const COLS = [
  ['forwarded_from_appointment_id', 'bigint REFERENCES appointments(id) ON DELETE SET NULL'],
  ['forwarded_from_doctor_id',      'uuid    REFERENCES doctors(id)     ON DELETE SET NULL'],
  ['forwarded_at',                  'timestamptz'],
];

export async function up(knex) {
  for (const [name, type] of COLS) {
    await knex.raw(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS "${name}" ${type}`);
  }
  // Doktor navbat so'rovi tez ishlashi uchun: shu bemor uchun kelgan yo'naltirishlar
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS appointments_tenant_forwarded_idx
     ON appointments (tenant_id, forwarded_from_appointment_id)
     WHERE forwarded_from_appointment_id IS NOT NULL`
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS appointments_tenant_forwarded_idx');
  for (const [name] of COLS) {
    await knex.raw(`ALTER TABLE appointments DROP COLUMN IF EXISTS "${name}"`);
  }
}
