const POLICY_NAME = 'falcon_tenant_isolation';

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function tenantTables(knex) {
  const result = await knex.raw(`
    SELECT DISTINCT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `);

  return result.rows;
}

export async function up(knex) {
  const tables = await tenantTables(knex);

  for (const { table_schema: schema, table_name: table } of tables) {
    const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    const policyName = quoteIdentifier(POLICY_NAME);

    await knex.raw(`ALTER TABLE ${qualifiedTable} ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`DROP POLICY IF EXISTS ${policyName} ON ${qualifiedTable}`);
    await knex.raw(`
      CREATE POLICY ${policyName} ON ${qualifiedTable}
      FOR ALL
      USING (
        tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      )
      WITH CHECK (
        tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
      )
    `);
  }
}

export async function down(knex) {
  const tables = await tenantTables(knex);

  for (const { table_schema: schema, table_name: table } of tables) {
    const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
    const policyName = quoteIdentifier(POLICY_NAME);

    await knex.raw(`DROP POLICY IF EXISTS ${policyName} ON ${qualifiedTable}`);
    await knex.raw(`ALTER TABLE ${qualifiedTable} DISABLE ROW LEVEL SECURITY`);
  }
}
