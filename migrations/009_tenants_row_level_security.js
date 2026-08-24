const POLICY_NAME = 'falcon_tenant_isolation';

export async function up(knex) {
  await knex.raw('ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY');
  await knex.raw(`DROP POLICY IF EXISTS ${POLICY_NAME} ON public.tenants`);
  await knex.raw(`
    CREATE POLICY ${POLICY_NAME} ON public.tenants
    FOR ALL
    USING (
      id = NULLIF(current_setting('app.tenant_id', true), '')
    )
    WITH CHECK (
      id = NULLIF(current_setting('app.tenant_id', true), '')
    )
  `);
}

export async function down(knex) {
  await knex.raw(`DROP POLICY IF EXISTS ${POLICY_NAME} ON public.tenants`);
  await knex.raw('ALTER TABLE public.tenants DISABLE ROW LEVEL SECURITY');
}
