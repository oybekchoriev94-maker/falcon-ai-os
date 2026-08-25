import { randomUUID } from 'crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertApplicationRoleIsRlsSafe,
  assertPlatformRoleCanBypassRls,
  createTenantAwarePool,
  withTenantTransaction,
} from '../backend/db.js';
import { runWithTenantDbContext } from '../backend/request-tenant-context.js';

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
  ownerPool = new Pool({
    connectionString: process.env.PLATFORM_DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL,
  });
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
  await ownerPool.query(`GRANT SELECT ON tenants TO ${RLS_ROLE}`);

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

  it('enables tenant-id RLS on the tenants table itself', async () => {
    const result = await ownerPool.query(`
      SELECT c.relrowsecurity AS rls_enabled,
             EXISTS (
               SELECT 1 FROM pg_policy p
               WHERE p.polrelid = c.oid AND p.polname = 'falcon_tenant_isolation'
             ) AS policy_exists
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'tenants'
    `);

    expect(result.rows[0]).toEqual({ rls_enabled: true, policy_exists: true });
  });

  it('enables tenant RLS on every Edge control-plane table', async () => {
    const result = await ownerPool.query(`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             EXISTS (
               SELECT 1 FROM pg_policy p
               WHERE p.polrelid = c.oid AND p.polname = 'falcon_tenant_isolation'
             ) AS policy_exists
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname
    `, [['edge_nodes', 'edge_nonces', 'vision_events']]);

    expect(result.rows).toEqual([
      { table_name: 'edge_nodes', rls_enabled: true, policy_exists: true },
      { table_name: 'edge_nonces', rls_enabled: true, policy_exists: true },
      { table_name: 'vision_events', rls_enabled: true, policy_exists: true },
    ]);
  });

  it('uses a non-owner application role when configured', async () => {
    if (!process.env.RLS_ENFORCE_APP_ROLE) return;
    const applicationPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      const role = await assertApplicationRoleIsRlsSafe(applicationPool);
      expect(role.role_name).toBe('falcon_app');
      expect(role.is_superuser).toBe(false);
      expect(role.bypasses_rls).toBe(false);
      expect(role.owns_rls_tables).toBe(false);
    } finally {
      await applicationPool.end();
    }
  });

  it('uses an explicitly privileged platform role when enforcement is enabled', async () => {
    if (!process.env.RLS_ENFORCE_APP_ROLE) return;
    const role = await assertPlatformRoleCanBypassRls(ownerPool);
    expect(role.role_name).not.toBe('falcon_app');
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

  it('only exposes the active tenant row from the tenants table', async () => {
    const rows = await asRlsRole(tenantA, async (client) => (
      await client.query(
        'SELECT id FROM tenants WHERE id = ANY($1::text[]) ORDER BY id',
        [[tenantA, tenantB]]
      )
    ).rows);

    expect(rows).toEqual([{ id: tenantA }]);
  });

  it('applies request context automatically through the tenant-aware pool', async () => {
    const rolePool = {
      async connect() {
        const client = await ownerPool.connect();
        return {
          async query(...args) {
            const result = await client.query(...args);
            const sql = typeof args[0] === 'string' ? args[0] : args[0]?.text;
            if (/^\s*BEGIN\b/i.test(sql || '')) {
              await client.query(`SET LOCAL ROLE ${RLS_ROLE}`);
            }
            return result;
          },
          release: () => client.release(),
        };
      },
    };
    const tenantPool = createTenantAwarePool(rolePool);

    const result = await runWithTenantDbContext(tenantA, () => tenantPool.query(
      'SELECT id, tenant_id FROM patients WHERE id = ANY($1::uuid[]) ORDER BY tenant_id',
      [[patientA, patientB]]
    ));

    expect(result.rows).toEqual([{ id: patientA, tenant_id: tenantA }]);
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
