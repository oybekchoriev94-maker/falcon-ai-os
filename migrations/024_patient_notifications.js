/**
 * O: Bemor bilan aloqa (Telegram/SMS) — audit va deduplikatsiya.
 *
 * Har yuborilgan xabar shu yerda saqlanadi. Bir xil xabar takror
 * yuborilmasligi uchun (appointment_id + kind) bo'yicha noyob indeks.
 *
 * kind:
 *   'reminder_24h'      — appointment 24 soat oldin
 *   'reminder_2h'       — appointment 2 soat oldin
 *   'lab_ready'         — lab natija tayyor
 *   'follow_up_7d'      — chiqarilgandan 7 kun keyin
 *   'preparation'       — tekshiruv oldi tayyorgarlik ko'rsatmalari
 */
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS patient_notifications (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      kind varchar(30) NOT NULL,
      channel varchar(20) NOT NULL,          -- 'telegram' | 'sms'
      recipient text NOT NULL,               -- telegram_id yoki telefon
      message text NOT NULL,
      appointment_id bigint,
      admission_id uuid,
      lab_order_id uuid,
      status varchar(20) NOT NULL DEFAULT 'pending',   -- pending | sent | failed
      sent_at timestamptz,
      error text,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  // Deduplikatsiya: bir appointment uchun bir kind bir marta yuboriladi
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS patient_notif_appt_kind_uniq
                  ON patient_notifications (appointment_id, kind)
                  WHERE appointment_id IS NOT NULL`);
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS patient_notif_admission_kind_uniq
                  ON patient_notifications (admission_id, kind)
                  WHERE admission_id IS NOT NULL`);
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS patient_notif_lab_kind_uniq
                  ON patient_notifications (lab_order_id, kind)
                  WHERE lab_order_id IS NOT NULL`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS patient_notif_tenant_status_idx
                  ON patient_notifications (tenant_id, status, created_at DESC)`);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS patient_notifications`);
}
