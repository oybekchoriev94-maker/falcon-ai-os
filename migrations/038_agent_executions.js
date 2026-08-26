/**
 * Agent ijrolarining doimiy auditi (roadmap — "asosiy miya" poydevori).
 *
 * MUAMMO: agent ijrolari faqat xotiradagi EXECUTION_LOG'da saqlanardi —
 * server qayta ishga tushsa tarix yo'qoladi, klinikalar bo'yicha tahlil
 * qilib bo'lmaydi. Yo'l xarita talabi: har agentda "audit va aniqlik
 * ko'rsatkichi".
 *
 * YECHIM: agent_executions jadvali — har bir executeAgent() chaqiruvi
 * shu yerga yoziladi (muvaffaqiyatli yoki xato). Jadval tenant-scoped,
 * RLS siyosati o'rnatiladi, tenant-guard ro'yxatiga kiritiladi.
 */

export async function up(knex) {
  const has = await knex.schema.hasTable('agent_executions');
  if (!has) {
    await knex.raw(`
      CREATE TABLE agent_executions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        agent varchar(80) NOT NULL,
        canonical_id varchar(40),
        status varchar(20) NOT NULL,
        code varchar(40),
        duration_ms integer,
        user_id uuid,
        request_id varchar(80),
        error_summary varchar(500),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await knex.raw(
      `CREATE INDEX agent_executions_tenant_time_idx
         ON agent_executions (tenant_id, created_at DESC)`
    );
    await knex.raw(
      `CREATE INDEX agent_executions_agent_idx
         ON agent_executions (tenant_id, agent)`
    );
    // Tenant izolyatsiyasi — 036'dagi qayta qo'llash allaqachon o'tgan,
    // shu sababli yangi jadval uchun siyosatni o'zimiz o'rnatamiz.
    await knex.raw('ALTER TABLE agent_executions ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE agent_executions FORCE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY falcon_tenant_isolation ON agent_executions
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    `);
  }
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS agent_executions');
}
