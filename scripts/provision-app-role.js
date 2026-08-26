import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const ROLE_NAME = 'falcon_app';
const adminUrl = process.env.PLATFORM_DATABASE_URL || process.env.MIGRATION_DATABASE_URL;
const appPassword = process.env.APP_DATABASE_PASSWORD;

if (!adminUrl) throw new Error('PLATFORM_DATABASE_URL yoki MIGRATION_DATABASE_URL talab qilinadi');
if (!appPassword || appPassword.length < 16) {
  throw new Error('APP_DATABASE_PASSWORD kamida 16 belgidan iborat bo\'lishi kerak');
}

const pool = new Pool({ connectionString: adminUrl, max: 1 });

try {
  const client = await pool.connect();
  try {
    const roleSql = await client.query(
      `SELECT format(
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)
          THEN 'ALTER ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
          ELSE 'CREATE ROLE %I WITH LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS'
        END,
        $1, $2::text
      ) AS sql`,
      [ROLE_NAME, appPassword]
    );
    await client.query(roleSql.rows[0].sql);

    const database = await client.query('SELECT current_database() AS name');
    await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(database.rows[0].name)} TO ${ROLE_NAME}`);
    await client.query(`GRANT USAGE ON SCHEMA public TO ${ROLE_NAME}`);
    await client.query(`REVOKE CREATE ON SCHEMA public FROM ${ROLE_NAME}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${ROLE_NAME}`);
    await client.query(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE_NAME}`);

    const tenantTables = await client.query(`
      SELECT DISTINCT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id'
      UNION SELECT 'tenants'
      ORDER BY table_name
    `);
    for (const { table_name: table } of tenantTables.rows) {
      await client.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${quoteIdentifier(table)} TO ${ROLE_NAME}`
      );
    }

    await client.query(`GRANT SELECT ON TABLE public.subscription_plans TO ${ROLE_NAME}`);
    await client.query(`GRANT SELECT, INSERT ON TABLE public.token_blacklist TO ${ROLE_NAME}`);
    await client.query(`GRANT SELECT, INSERT, DELETE ON TABLE public.used_nonces TO ${ROLE_NAME}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE_NAME}`);
    console.log(`[DB-ROLE] ${ROLE_NAME} provisioned with RLS-safe runtime grants`);
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
