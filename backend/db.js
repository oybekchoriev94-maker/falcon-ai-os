import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';

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

export async function q(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

export async function qGet(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

export async function qExec(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

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


