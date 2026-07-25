// ============================================================
// Falcon AI OS — Agentlar uchun tenant-himoyalangan DB konteksti
//
// Maqsad: agent yozgan har qanday so'rov o'z klinikasi (tenant) chegarasidan
// chiqib keta olmasligi. Ilova qatlamidagi "esdan chiqdi" xatolari SaaS'da
// eng xavfli sinf bo'lgani uchun, bu yerda ular RUNTIME'da bloklanadi.
// ============================================================

import { getPool } from '../../backend/db.js';
import { findUnscopedTable, TenantScopeError } from '../../backend/tenant-guard.js';

export { TenantScopeError };

// Agentlar uchun qoida qat'iy: production'da ham XATO tashlaymiz.
// (Agent kodi yangi va to'liq nazorat ostida — jim sizib chiqishdan ko'ra
//  to'xtagani yaxshi.)
function assertTenantScoped(sql) {
  const table = findUnscopedTable(sql);
  if (table) throw new TenantScopeError(table);
}

/**
 * Berilgan tenant uchun DB kontekstini yaratadi.
 * @param {string} tenantId
 */
export function createTenantDb(tenantId) {
  if (!tenantId) throw new Error('createTenantDb: tenantId majburiy');

  async function run(sql, params = []) {
    assertTenantScoped(sql);
    const pool = getPool();
    if (!pool) throw new Error('Ma\'lumotlar bazasi ulanmagan');
    return pool.query(sql, params);
  }

  return {
    tenantId,
    /** Barcha qatorlar */
    async q(sql, params = []) {
      return (await run(sql, params)).rows;
    },
    /** Birinchi qator yoki null */
    async qGet(sql, params = []) {
      return (await run(sql, params)).rows[0] || null;
    },
    /** INSERT/UPDATE/DELETE — natija obyekti (rowCount bilan) */
    async qExec(sql, params = []) {
      return run(sql, params);
    },
    /** Tranzaksiya ichida bir nechta so'rov */
    async transaction(fn) {
      const pool = getPool();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const scoped = {
          tenantId,
          q: async (sql, params = []) => { assertTenantScoped(sql); return (await client.query(sql, params)).rows; },
          qGet: async (sql, params = []) => { assertTenantScoped(sql); return (await client.query(sql, params)).rows[0] || null; },
          qExec: async (sql, params = []) => { assertTenantScoped(sql); return client.query(sql, params); },
        };
        const result = await fn(scoped);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    isReady() {
      try { return !!getPool(); } catch { return false; }
    },
  };
}
