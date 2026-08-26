/**
 * N: Vaqt tejash AI agentlari uchun kesh va tafsir maydonlari.
 *
 *  patient_ai_summaries — admission-summary kartasi ochilganda LLM'ga
 *    murojaat qilmasdan darrov ko'rsatiladi (24 soatlik kesh).
 *
 *  lab_results.ai_interpretation — laborant natija kiritgach LLM avto
 *    tushunarli tafsir qo'shadi (masalan "Gemoglobin norma pastida,
 *    yumshoq anemiya belgilari"). Shifokor kartada darrov ko'radi.
 *
 *  appointments.triage_json — reception ovozli qabulida triage-agent
 *    xulosasi: {severity:'green|yellow|red', suggested_department, reason}.
 */
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS patient_ai_summaries (
      patient_id uuid PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      summary text NOT NULL,
      data_json jsonb,
      based_on_visits int DEFAULT 0,
      generated_at timestamptz NOT NULL DEFAULT NOW(),
      expires_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS patient_ai_summaries_tenant_idx
                  ON patient_ai_summaries (tenant_id, expires_at)`);

  await knex.raw(`ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS ai_interpretation text`);
  await knex.raw(`ALTER TABLE lab_results ADD COLUMN IF NOT EXISTS ai_data_json jsonb`);

  await knex.raw(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS triage_severity varchar(10)`);  // green|yellow|red
  await knex.raw(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS triage_json jsonb`);
}

export async function down(knex) {
  await knex.raw(`ALTER TABLE appointments DROP COLUMN IF EXISTS triage_json`);
  await knex.raw(`ALTER TABLE appointments DROP COLUMN IF EXISTS triage_severity`);
  await knex.raw(`ALTER TABLE lab_results DROP COLUMN IF EXISTS ai_data_json`);
  await knex.raw(`ALTER TABLE lab_results DROP COLUMN IF EXISTS ai_interpretation`);
  await knex.raw(`DROP INDEX IF EXISTS patient_ai_summaries_tenant_idx`);
  await knex.raw(`DROP TABLE IF EXISTS patient_ai_summaries`);
}
