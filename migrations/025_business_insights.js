/**
 * P: Biznes tahlili — kesh va audit.
 *
 *  business_insights_cache — hisobot 1 soatlik keshda saqlanadi
 *    (revenue-forecaster og'ir LLM chaqirig'ini har safar takrorlamaslik).
 *
 *  business_report_audit — CEO/admin kim, qachon, qaysi hisobot ochgan.
 *    Bu maxfiy ma'lumot (daromad, xodim yuki) — kim ko'rganini bilib
 *    turish shart.
 */
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS business_insights_cache (
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      insight_kind varchar(40) NOT NULL,     -- 'revenue' | 'staff' | 'services' | 'churn'
      period varchar(20) NOT NULL,           -- '30d' | '90d' | 'ytd' | ...
      data_json jsonb NOT NULL,
      generated_at timestamptz NOT NULL DEFAULT NOW(),
      expires_at timestamptz NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
      PRIMARY KEY (tenant_id, insight_kind, period)
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS business_insights_expires_idx
                  ON business_insights_cache (expires_at)`);

  await knex.raw(`
    CREATE TABLE IF NOT EXISTS business_report_audit (
      id bigserial PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id uuid,
      user_role varchar(30),
      insight_kind varchar(40) NOT NULL,
      period varchar(20),
      params_json jsonb,
      ip_address inet,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS business_report_audit_tenant_idx
                  ON business_report_audit (tenant_id, created_at DESC)`);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS business_report_audit`);
  await knex.raw(`DROP INDEX IF EXISTS business_insights_expires_idx`);
  await knex.raw(`DROP TABLE IF EXISTS business_insights_cache`);
}
