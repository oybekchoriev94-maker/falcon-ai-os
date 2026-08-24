import { AsyncLocalStorage } from 'node:async_hooks';

const tenantStorage = new AsyncLocalStorage();

function normalizeTenantId(tenantId) {
  const normalized = String(tenantId || '').trim();
  if (!normalized) throw new Error('DB tenant konteksti uchun tenant_id talab qilinadi');
  return normalized;
}

export function getTenantDbStore() {
  return tenantStorage.getStore() || null;
}

export function getTenantDbContext() {
  return getTenantDbStore()?.tenantId || null;
}

export function runWithTenantDbContext(tenantId, callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('DB tenant konteksti uchun callback funksiya talab qilinadi');
  }

  const normalizedTenantId = normalizeTenantId(tenantId);
  const activeStore = getTenantDbStore();
  if (activeStore?.tenantId === normalizedTenantId) return callback();
  if (activeStore) {
    throw new Error(
      `Aktiv DB tenant kontekstini ${activeStore.tenantId} dan ${normalizedTenantId} ga almashtirish taqiqlanadi`
    );
  }

  return tenantStorage.run({
    tenantId: normalizedTenantId,
    transactionClient: null,
    cleanupStarted: false,
  }, callback);
}

async function cleanupStore(store) {
  if (!store || store.cleanupStarted || !store.transactionClient) return;
  store.cleanupStarted = true;
  const client = store.transactionClient;
  store.transactionClient = null;
  try {
    await client.query('ROLLBACK');
  } catch (_) {
    // Connection xatosida original request natijasini o'zgartirmaymiz.
  } finally {
    client.release();
  }
}

/** Express middleware ichida tenant contextni keyingi handlerlarga bog'laydi. */
export function bindTenantDbContext(tenantId, res, next) {
  return runWithTenantDbContext(tenantId, () => {
    const store = getTenantDbStore();
    const cleanup = () => { void cleanupStore(store); };
    if (typeof res?.once === 'function') {
      res.once('finish', cleanup);
      res.once('close', cleanup);
    }
    return next();
  });
}
