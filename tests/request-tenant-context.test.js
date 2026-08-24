import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createTenantAwarePool } from '../backend/db.js';
import {
  bindTenantDbContext,
  getTenantDbContext,
  runWithTenantDbContext,
} from '../backend/request-tenant-context.js';

function makeRawPool() {
  const client = {
    query: vi.fn(async (sql) => ({ rows: [{ sql }], rowCount: 1 })),
    release: vi.fn(),
  };
  const rawPool = {
    query: vi.fn(async (sql) => ({ rows: [{ sql }], rowCount: 1 })),
    connect: vi.fn(async () => client),
  };
  return { rawPool, client };
}

describe('request tenant DB context', () => {
  it('keeps concurrent tenant contexts isolated', async () => {
    const seen = await Promise.all([
      runWithTenantDbContext('tenant-a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getTenantDbContext();
      }),
      runWithTenantDbContext('tenant-b', async () => getTenantDbContext()),
    ]);

    expect(seen).toEqual(['tenant-a', 'tenant-b']);
    expect(getTenantDbContext()).toBeNull();
  });

  it('rejects switching tenant inside an active request context', async () => {
    await expect(runWithTenantDbContext('tenant-a', async () => (
      runWithTenantDbContext('tenant-b', async () => 'unexpected')
    ))).rejects.toThrow(/almashtirish taqiqlanadi/i);
  });

  it('passes through queries when no tenant context exists', async () => {
    const { rawPool } = makeRawPool();
    const tenantPool = createTenantAwarePool(rawPool);

    await tenantPool.query('SELECT 1');

    expect(rawPool.query).toHaveBeenCalledWith('SELECT 1');
    expect(rawPool.connect).not.toHaveBeenCalled();
  });

  it('sets transaction-local tenant context for a pooled query', async () => {
    const { rawPool, client } = makeRawPool();
    const tenantPool = createTenantAwarePool(rawPool);

    await runWithTenantDbContext('tenant-a', () => (
      tenantPool.query('SELECT id FROM patients WHERE tenant_id = $1', ['tenant-a'])
    ));

    expect(client.query.mock.calls).toEqual([
      ['BEGIN'],
      ["SELECT set_config('app.tenant_id', $1, true)", ['tenant-a']],
      ['SELECT id FROM patients WHERE tenant_id = $1', ['tenant-a']],
      ['COMMIT'],
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('pins pool.query transaction calls to one client inside a request', async () => {
    const { rawPool, client } = makeRawPool();
    const tenantPool = createTenantAwarePool(rawPool);

    await runWithTenantDbContext('tenant-a', async () => {
      await tenantPool.query('BEGIN');
      await tenantPool.query('UPDATE patients SET first_name = $1', ['Ali']);
      await tenantPool.query('COMMIT');
    });

    expect(rawPool.connect).toHaveBeenCalledOnce();
    expect(client.query.mock.calls).toEqual([
      ['BEGIN'],
      ["SELECT set_config('app.tenant_id', $1, true)", ['tenant-a']],
      ['UPDATE patients SET first_name = $1', ['Ali']],
      ['COMMIT'],
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and releases a leaked request transaction on response finish', async () => {
    const { rawPool, client } = makeRawPool();
    const tenantPool = createTenantAwarePool(rawPool);
    const response = new EventEmitter();

    await bindTenantDbContext('tenant-a', response, async () => {
      await tenantPool.query('BEGIN');
    });
    response.emit('finish');
    await new Promise((resolve) => setImmediate(resolve));

    expect(client.query.mock.calls.at(-1)).toEqual(['ROLLBACK']);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
