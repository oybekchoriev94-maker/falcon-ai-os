import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { assertTenantScoped } from './tenant-guard.js';

let pool = null;

export async function connectPg(databaseUrl) {
  pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 25,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  });
  const client = await pool.connect();
  client.release();
  return pool;
}

export function getPool() {
  if (!pool) throw new Error('Database pool not initialized');
  return pool;
}

export function disconnectPg() {
  if (pool) return pool.end();
}

// allowUnscoped: qonuniy cross-tenant so'rovlar uchun (superadmin, login, tariflar)
async function run(sql, params, allowUnscoped) {
  assertTenantScoped(sql, allowUnscoped);
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export async function q(sql, params = [], opts = {}) {
  return (await run(sql, params, opts.allowUnscoped)).rows;
}

export async function qGet(sql, params = [], opts = {}) {
  return (await run(sql, params, opts.allowUnscoped)).rows[0] || null;
}

export async function qExec(sql, params = [], opts = {}) {
  return run(sql, params, opts.allowUnscoped);
}

/**
 * Ataylab tenant chegarasidan tashqari so'rov (superadmin paneli, login,
 * tarif rejalari kabi). Qo'riqchi bularni bloklamaydi.
 */
export const unsafeQuery = {
  q: (sql, params = []) => q(sql, params, { allowUnscoped: true }),
  qGet: (sql, params = []) => qGet(sql, params, { allowUnscoped: true }),
  qExec: (sql, params = []) => qExec(sql, params, { allowUnscoped: true }),
};

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}


