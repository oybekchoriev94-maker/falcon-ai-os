/**
 * M: AI xavfsizlik ogohlantirishlari.
 *
 * Xavfsizlik agentlari (vital-anomaly, drug-interaction, lab-critical)
 * chiqargan ogohlantirishlar shu jadvalda saqlanadi. Har agent chaqirilganda
 * — deterministik yoki LLM tahlildan keyin — kritik natijalar bo'lsa
 * ai_alerts qatoriga yoziladi.
 *
 * Shifokor/hamshira "Yechildi" bosgach resolved_at yoziladi. Yechilmagan
 * alertlar UI'da qizil belgi bilan chiqadi.
 */
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS ai_alerts (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      admission_id uuid REFERENCES admissions(id) ON DELETE SET NULL,
      source_kind varchar(30) NOT NULL,     -- 'daily_note' | 'lab_result' | 'prescription'
      source_id text,                       -- havola (daily_note.id, lab_result.id, prescription.id)
      agent_name varchar(50) NOT NULL,      -- 'vital-anomaly' | 'drug-interaction' | 'lab-critical'
      severity varchar(10) NOT NULL,        -- 'critical' | 'warning' | 'info'
      title text NOT NULL,
      details text,
      data_json jsonb,
      created_at timestamptz NOT NULL DEFAULT NOW(),
      resolved_at timestamptz,
      resolved_by uuid,
      resolution_note text
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS ai_alerts_tenant_unresolved_idx
                  ON ai_alerts (tenant_id, created_at DESC)
                  WHERE resolved_at IS NULL`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS ai_alerts_tenant_patient_idx
                  ON ai_alerts (tenant_id, patient_id)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS ai_alerts_tenant_severity_idx
                  ON ai_alerts (tenant_id, severity)
                  WHERE resolved_at IS NULL`);
}

export async function down(knex) {
  await knex.raw(`DROP INDEX IF EXISTS ai_alerts_tenant_severity_idx`);
  await knex.raw(`DROP INDEX IF EXISTS ai_alerts_tenant_patient_idx`);
  await knex.raw(`DROP INDEX IF EXISTS ai_alerts_tenant_unresolved_idx`);
  await knex.raw(`DROP TABLE IF EXISTS ai_alerts`);
}
