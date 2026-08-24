import { randomUUID } from 'crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../backend/db.js';

const { Pool } = pg;
const RLS_ROLE = 'falcon_rls_test';

let ownerPool;
let tenantA;
let tenantB;
let patientA;
let patientB;

async function asRlsRole(tenantId, callback) {
  const client = await ownerPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${RLS_ROLE}`);
    if (tenantId !== undefined) {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    }
    return await callback(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

beforeAll(async () => {
  ownerPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const suffix = randomUUID().slice(0, 8);
  tenantA = `rls-a-${suffix}`;
  tenantB = `rls-b-${suffix}`;
  patientA = randomUUID();
  patientB = randomUUID();

  await ownerPool.query(`
    DO $$
    BEGIN
      CREATE ROLE ${RLS_ROLE} NOLOGIN;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END
    $$
  `);
  await ownerPool.query(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
  await ownerPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON patients TO ${RLS_ROLE}`);

  await ownerPool.query(
    'INSERT INTO tenants (id, name) VALUES ($1, $2), ($3, $4)',
    [tenantA, 'RLS Clinic A', tenantB, 'RLS Clinic B']
  );
  await ownerPool.query(
    `INSERT INTO patients (id, tenant_id, first_name)
     VALUES ($1, $2, 'Patient A'), ($3, $4, 'Patient B')`,
    [patientA, tenantA, patientB, tenantB]
  );
});

afterAll(async () => {
  if (!ownerPool) return;
  await ownerPool.query('DELETE FROM tenants WHERE id = ANY($1::text[])', [[tenantA, tenantB]]);
  await ownerPool.end();
});

describe('PostgreSQL tenant RLS', () => {
  it('enables the tenant policy on every public tenant_id table', async () => {
    const result = await ownerPool.query(`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             EXISTS (
               SELECT 1
               FROM pg_policy p
               WHERE p.polrelid = c.oid
                 AND p.polname = 'falcon_tenant_isolation'
             ) AS policy_exists
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname = 'tenant_id'
        AND NOT a.attisdropped
    `);

    expect(result.rows.length).toBeGreaterThan(40);
    expect(result.rows.every((row) => row.rls_enabled && row.policy_exists)).toBe(true);
  });

  it('fails closed when no tenant context is set', async () => {
    const rows = await asRlsRole(undefined, async (client) => (
      await client.query('SELECT id FROM patients WHERE id = ANY($1::uuid[])', [[patientA, patientB]])
    ).rows);

    expect(rows).toEqual([]);
  });

  it('only exposes rows belonging to the active tenant', async () => {
    const rows = await withTenantTransaction(tenantA, async (client) => {
      await client.query(`SET LOCAL ROLE ${RLS_ROLE}`);
      return (
        await client.query(
          'SELECT id, tenant_id FROM patients WHERE id = ANY($1::uuid[]) ORDER BY tenant_id',
          [[patientA, patientB]]
        )
      ).rows;
    }, ownerPool);

    expect(rows).toEqual([{ id: patientA, tenant_id: tenantA }]);
  });

  it('hides cross-tenant updates and deletes', async () => {
    const result = await asRlsRole(tenantA, async (client) => {
      const update = await client.query(
        "UPDATE patients SET first_name = 'Compromised' WHERE id = $1",
        [patientB]
      );
      const deletion = await client.query('DELETE FROM patients WHERE id = $1', [patientB]);
      return { updated: update.rowCount, deleted: deletion.rowCount };
    });

    expect(result).toEqual({ updated: 0, deleted: 0 });
  });

  it('rejects inserts that claim another tenant', async () => {
    await expect(asRlsRole(tenantA, (client) => client.query(
      'INSERT INTO patients (id, tenant_id, first_name) VALUES ($1, $2, $3)',
      [randomUUID(), tenantB, 'Cross Tenant']
    ))).rejects.toMatchObject({ code: '42501' });
  });

  it('allows inserts for the active tenant', async () => {
    const insertedId = randomUUID();
    const result = await asRlsRole(tenantA, (client) => client.query(
      'INSERT INTO patients (id, tenant_id, first_name) VALUES ($1, $2, $3) RETURNING id',
      [insertedId, tenantA, 'Same Tenant']
    ));

    expect(result.rows).toEqual([{ id: insertedId }]);
  });
});
