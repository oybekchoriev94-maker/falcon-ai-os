// ============================================================
// Falcon AI OS — Agentlar uchun tenant-himoyalangan DB konteksti
//
// Maqsad: agent yozgan har qanday so'rov o'z klinikasi (tenant) chegarasidan
// chiqib keta olmasligi. Ilova qatlamidagi "esdan chiqdi" xatolari SaaS'da
// eng xavfli sinf bo'lgani uchun, bu yerda ular RUNTIME'da bloklanadi.
// ============================================================

import { getPool } from '../../backend/db.js';

// tenant_id ustuniga ega jadvallar — bularga murojaat qilgan so'rov
// albatta tenant_id bo'yicha filtrlanishi shart
const TENANT_SCOPED_TABLES = new Set([
  'users', 'doctors', 'patients', 'appointments', 'bookings', 'doctor_schedules',
  'inventory_items', 'inventory_batches', 'inventory_transactions',
  'procedure_material_norms', 'procedure_material_standards',
  'referrals', 'referral_partners', 'partner_transactions',
  'financial_transactions', 'platform_ledger', 'invoices', 'loyalty_ledger',
  'payment_transactions', 'payment_webhook_logs', 'wallet_log',
  'patient_consultations', 'medical_reports', 'doctor_analytics', 'patient_queue',
  'medication_reminders', 'family_monitors', 'clinic_settings', 'staff_members',
  'telegram_users', 'wards', 'beds', 'admissions', 'daily_notes', 'prescriptions',
  'inpatient_services', 'discharges', 'usage_metering', 'subscriptions',
  'b2b_contracts', 'idempotency_keys', 'clinic_services', 'audit_logs',
]);

// FROM/JOIN/INTO/UPDATE dan keyingi jadval nomlarini ajratib olish
const TABLE_RE = /\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)/gi;

export class TenantScopeError extends Error {
  constructor(table) {
    super(
      `Tenant xavfsizligi: "${table}" jadvaliga so'rov tenant_id bo'yicha filtrlanmagan. ` +
      `Agent so'rovlarida har doim tenant_id ishlating (masalan: WHERE tenant_id = $1).`
    );
    this.name = 'TenantScopeError';
    this.code = 'TENANT_SCOPE_MISSING';
  }
}

function assertTenantScoped(sql) {
  const lower = String(sql).toLowerCase();
  if (lower.includes('tenant_id')) return; // filtrlangan — ruxsat
  TABLE_RE.lastIndex = 0;
  let m;
  while ((m = TABLE_RE.exec(lower)) !== null) {
    const table = m[1];
    if (TENANT_SCOPED_TABLES.has(table)) throw new TenantScopeError(table);
  }
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
