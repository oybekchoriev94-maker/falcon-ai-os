import pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { assertTenantScoped } from './tenant-guard.js';
import { getTenantDbContext, getTenantDbStore } from './request-tenant-context.js';

let pool = null;
let tenantAwarePool = null;
let platformPool = null;

function poolConfig(connectionString, max) {
  return {
    connectionString,
    max,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    statement_timeout: 10000,
  };
}

function queryText(query) {
  return typeof query === 'string' ? query : query?.text || '';
}

async function setTenantConfig(client, tenantId) {
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
}

async function queryInTenantTransaction(rawPool, tenantId, args) {
  const client = await rawPool.connect();
  try {
    await client.query('BEGIN');
    await setTenantConfig(client, tenantId);
    const result = await client.query(...args);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function tenantAwareClient(rawClient, tenantId) {
  let inTransaction = false;

  return new Proxy(rawClient, {
    get(target, property, receiver) {
      if (property === 'query') {
        return async (...args) => {
          const command = queryText(args[0]);
          if (/^\s*(BEGIN|START\s+TRANSACTION)\b/i.test(command)) {
            const result = await target.query(...args);
            try {
              await setTenantConfig(target, tenantId);
              inTransaction = true;
              return result;
            } catch (error) {
              await target.query('ROLLBACK');
              throw error;
            }
          }
          if (/^\s*(COMMIT|ROLLBACK)\b/i.test(command)) {
            try {
              return await target.query(...args);
            } finally {
              inTransaction = false;
            }
          }
          if (inTransaction) return target.query(...args);

          try {
            await target.query('BEGIN');
            await setTenantConfig(target, tenantId);
            const result = await target.query(...args);
            await target.query('COMMIT');
            return result;
          } catch (error) {
            await target.query('ROLLBACK');
            throw error;
          }
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function createTenantAwarePool(rawPool) {
  if (!rawPool) throw new Error('Tenant-aware pool uchun raw pool talab qilinadi');

  return new Proxy(rawPool, {
    get(target, property, receiver) {
      if (property === 'query') {
        return async (...args) => {
          const store = getTenantDbStore();
          if (!store) return target.query(...args);

          const command = queryText(args[0]);
          if (/^\s*(BEGIN|START\s+TRANSACTION)\b/i.test(command)) {
            if (store.transactionClient) {
              throw new Error('Tenant request ichida nested transaction qo\'llab-quvvatlanmaydi');
            }
            const client = await target.connect();
            try {
              const result = await client.query(...args);
              await setTenantConfig(client, store.tenantId);
              store.transactionClient = client;
              return result;
            } catch (error) {
              await client.query('ROLLBACK');
              client.release();
              throw error;
            }
          }

          if (/^\s*(COMMIT|ROLLBACK)\b/i.test(command)) {
            if (!store.transactionClient) {
              throw new Error('Tenant request uchun aktiv transaction topilmadi');
            }
            const client = store.transactionClient;
            store.transactionClient = null;
            try {
              return await client.query(...args);
            } finally {
              client.release();
            }
          }

          if (store.transactionClient) return store.transactionClient.query(...args);
          return queryInTenantTransaction(target, store.tenantId, args);
        };
      }

      if (property === 'connect') {
        return async () => {
          const client = await target.connect();
          const tenantId = getTenantDbContext();
          return tenantId ? tenantAwareClient(client, tenantId) : client;
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function inspectDatabaseRole(databasePool) {
  if (!databasePool) throw new Error('Database pool not initialized');
  const result = await databasePool.query(`
    SELECT current_user AS role_name,
           r.rolsuper AS is_superuser,
           r.rolbypassrls AS bypasses_rls,
           EXISTS (
             SELECT 1
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relkind = 'r'
               AND c.relrowsecurity
           ) AS has_rls_tables,
           EXISTS (
             SELECT 1
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relkind = 'r'
               AND c.relrowsecurity
               AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
           ) AS owns_rls_tables,
           NOT EXISTS (
             SELECT 1
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public'
               AND c.relkind = 'r'
               AND c.relrowsecurity
               AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = current_user)
           ) AS owns_all_rls_tables
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  return result.rows[0] || null;
}

export async function assertApplicationRoleIsRlsSafe(databasePool = pool) {
  const role = await inspectDatabaseRole(databasePool);
  if (!role || !role.has_rls_tables || role.is_superuser || role.bypasses_rls || role.owns_rls_tables) {
    throw new Error(
      `RLS application role xavfsiz emas: ${role?.role_name || 'unknown'} ` +
      '(superuser, BYPASSRLS yoki RLS jadval egasi bo\'lishi mumkin emas)'
    );
  }
  return role;
}

export async function assertPlatformRoleCanBypassRls(databasePool = platformPool) {
  const role = await inspectDatabaseRole(databasePool);
  if (!role || !role.has_rls_tables || !(role.is_superuser || role.bypasses_rls || role.owns_all_rls_tables)) {
    throw new Error(
      `Platform DB roli cross-tenant operatsiyalar uchun yetarli emas: ${role?.role_name || 'unknown'} ` +
      '(superuser, BYPASSRLS yoki barcha RLS jadvallarining egasi bo\'lishi kerak)'
    );
  }
  return role;
}

export async function connectPg(databaseUrl, platformDatabaseUrl = process.env.PLATFORM_DATABASE_URL) {
  if (pool || platformPool) throw new Error('Database pool already initialized');
  const applicationPool = new pg.Pool(poolConfig(databaseUrl, 25));
  const privilegedPool = platformDatabaseUrl && platformDatabaseUrl !== databaseUrl
    ? new pg.Pool(poolConfig(platformDatabaseUrl, 5))
    : applicationPool;

  try {
    const client = await applicationPool.connect();
    client.release();

    if (privilegedPool !== applicationPool) {
      const platformClient = await privilegedPool.connect();
      platformClient.release();
    }

    if (process.env.RLS_ENFORCE_APP_ROLE === 'true') {
      if (!platformDatabaseUrl || privilegedPool === applicationPool) {
        throw new Error('RLS_ENFORCE_APP_ROLE=true uchun alohida PLATFORM_DATABASE_URL talab qilinadi');
      }
      await assertApplicationRoleIsRlsSafe(applicationPool);
      await assertPlatformRoleCanBypassRls(privilegedPool);
    }

    pool = applicationPool;
    tenantAwarePool = createTenantAwarePool(applicationPool);
    platformPool = privilegedPool;
    return tenantAwarePool;
  } catch (error) {
    const closings = [applicationPool.end()];
    if (privilegedPool !== applicationPool) closings.push(privilegedPool.end());
    await Promise.allSettled(closings);
    throw error;
  }
}

export function getPool() {
  if (!tenantAwarePool) throw new Error('Database pool not initialized');
  return tenantAwarePool;
}

export function getPlatformPool() {
  if (!platformPool) throw new Error('Platform database pool not initialized');
  return platformPool;
}

export async function disconnectPg() {
  const applicationPool = pool;
  const privilegedPool = platformPool;
  pool = null;
  tenantAwarePool = null;
  platformPool = null;

  const closings = [];
  if (applicationPool) closings.push(applicationPool.end());
  if (privilegedPool && privilegedPool !== applicationPool) closings.push(privilegedPool.end());
  await Promise.all(closings);
}

// allowUnscoped: qonuniy cross-tenant so'rovlar uchun (superadmin, login, tariflar)
async function run(sql, params, allowUnscoped) {
  assertTenantScoped(sql, allowUnscoped);
  if (allowUnscoped) return getPlatformPool().query(sql, params);
  return tenantAwarePool.query(sql, params);
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
  const tenantId = getTenantDbContext();
  if (tenantId) return withTenantTransaction(tenantId, callback);

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

export async function withPlatformTransaction(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('Platform tranzaksiyasi uchun callback funksiya talab qilinadi');
  }
  const client = await getPlatformPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Tenantga tegishli ishlarni bitta PostgreSQL tranzaksiyasida bajaradi va
 * RLS uchun tenant kontekstini faqat shu tranzaksiya muddatiga o'rnatadi.
 * `set_config(..., true)` pooled connection qayta ishlatilganda tenant
 * kontekstining boshqa so'rovga sizib o'tishiga yo'l qo'ymaydi.
 */
export async function withTenantTransaction(tenantId, callback, databasePool = pool) {
  const normalizedTenantId = String(tenantId || '').trim();
  if (!normalizedTenantId) {
    throw new Error('Tenant tranzaksiyasi uchun tenant_id talab qilinadi');
  }
  if (typeof callback !== 'function') {
    throw new TypeError('Tenant tranzaksiyasi uchun callback funksiya talab qilinadi');
  }
  if (!databasePool) {
    throw new Error('Database pool not initialized');
  }

  const client = await databasePool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true)",
      [normalizedTenantId]
    );
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
