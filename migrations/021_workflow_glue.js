/**
 * J: Klinika oqimini bir chiziqqa ulash.
 *
 * 5 ta bo'shliq:
 *  1) Doktor ko'rikni yakunlagach "keyingi qadam" (uy/lab/yotqizish) —
 *     `patient_consultations.next_step` + `next_step_data`.
 *  2) Statsionar kutayotgan bemorlar — hozirgi `appointments.status`
 *     yangi qiymat oladi: 'pending_admission'. Yangi jadval kerak emas —
 *     application logikada ishlaydi.
 *  3) Kassa savati (bir marta to'lov bir necha item uchun) —
 *     `payment_carts` yangi jadval.
 *  4) `lab_orders` bemor to'ganini bilishi uchun `paid_at` — kassa savati
 *     to'langanda yoziladi.
 *  5) `admissions` yaratishdan avval rozilik va shartnoma tekshiruvi —
 *     application layerda bo'ladi, bu joyda faqat sig'imi uchun index.
 *
 * IDEMPOTENT: IF NOT EXISTS ishlatiladi (VPS'da xavfsiz qayta yugurtirish).
 */
export async function up(knex) {
  // 1) Doktor qarori
  await knex.raw(`ALTER TABLE patient_consultations ADD COLUMN IF NOT EXISTS next_step varchar(20)`);
  await knex.raw(`ALTER TABLE patient_consultations ADD COLUMN IF NOT EXISTS next_step_data jsonb`);

  // 2) Lab buyurtmalari uchun to'lov vaqti
  await knex.raw(`ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS paid_at timestamptz`);
  await knex.raw(`ALTER TABLE lab_orders ADD COLUMN IF NOT EXISTS price numeric(12,2)`);

  // 3) Kassa savati
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS payment_carts (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      created_by uuid,
      status varchar(20) NOT NULL DEFAULT 'open',
      items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
      total numeric(12,2) NOT NULL DEFAULT 0,
      paid_at timestamptz,
      payment_id uuid,
      cash_received numeric(12,2),
      cash_change numeric(12,2),
      method varchar(20),
      receipt_number bigint,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS payment_carts_tenant_status_idx ON payment_carts (tenant_id, status)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS payment_carts_tenant_patient_idx ON payment_carts (tenant_id, patient_id)`);

  // 4) admissions guard uchun tez izlash
  await knex.raw(`CREATE INDEX IF NOT EXISTS patient_consents_tenant_patient_kind_idx
                  ON patient_consents (tenant_id, patient_id, kind)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS service_contracts_tenant_patient_idx
                  ON service_contracts (tenant_id, patient_id)`);
}

export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS service_contracts_tenant_patient_idx`);
  await knex.raw(`DROP INDEX IF EXISTS patient_consents_tenant_patient_kind_idx`);
  await knex.raw(`DROP INDEX IF EXISTS payment_carts_tenant_patient_idx`);
  await knex.raw(`DROP INDEX IF EXISTS payment_carts_tenant_status_idx`);
  await knex.raw(`DROP TABLE IF EXISTS payment_carts`);
  await knex.raw(`ALTER TABLE lab_orders DROP COLUMN IF EXISTS price`);
  await knex.raw(`ALTER TABLE lab_orders DROP COLUMN IF EXISTS paid_at`);
  await knex.raw(`ALTER TABLE patient_consultations DROP COLUMN IF EXISTS next_step_data`);
  await knex.raw(`ALTER TABLE patient_consultations DROP COLUMN IF EXISTS next_step`);
}
