// ============================================================
// Falcon AI OS — Tenant qo'riqchisi (umumiy)
//
// SaaS'da eng xavfli xato — so'rovda tenant_id ni unutish (boshqa klinika
// ma'lumoti ko'rinib qoladi). Bu modul shunday so'rovlarni aniqlaydi.
//
// Rejimlar:
//   development/test → XATO tashlaydi (regressiya darhol ko'rinadi)
//   production       → OGOHLANTIRISH loglaydi (ishlab turgan tizim to'xtamasin)
//
// Ba'zi so'rovlar qonuniy ravishda tenantsiz bo'ladi (superadmin panel,
// login, tarif rejalari) — ular unsafeQuery() bilan belgilanadi.
// ============================================================

// tenant_id ustuniga ega jadvallar
export const TENANT_SCOPED_TABLES = new Set([
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

const TABLE_RE = /\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)/gi;

export class TenantScopeError extends Error {
  constructor(table) {
    super(
      `Tenant xavfsizligi: "${table}" jadvaliga so'rov tenant_id bo'yicha filtrlanmagan. ` +
      `WHERE tenant_id = $n qo'shing yoki (agar bu ataylab bo'lsa) unsafeQuery() ishlating.`
    );
    this.name = 'TenantScopeError';
    this.code = 'TENANT_SCOPE_MISSING';
  }
}

/** So'rov tenant bo'yicha filtrlanmagan jadvalga tegsa — jadval nomini qaytaradi, aks holda null */
export function findUnscopedTable(sql) {
  const lower = String(sql).toLowerCase();
  if (lower.includes('tenant_id')) return null;
  TABLE_RE.lastIndex = 0;
  let m;
  while ((m = TABLE_RE.exec(lower)) !== null) {
    if (TENANT_SCOPED_TABLES.has(m[1])) return m[1];
  }
  return null;
}

const STRICT = process.env.NODE_ENV !== 'production';
const warned = new Set();

/**
 * So'rovni tekshiradi. Dev/test'da xato tashlaydi, productionda ogohlantiradi.
 * @param {string} sql
 * @param {boolean} allowUnscoped - unsafeQuery() orqali ataylab ruxsat berilgan
 */
export function assertTenantScoped(sql, allowUnscoped = false) {
  if (allowUnscoped) return;
  const table = findUnscopedTable(sql);
  if (!table) return;

  if (STRICT) throw new TenantScopeError(table);

  // Productionda: bir xil so'rov uchun bir marta ogohlantiramiz (log toshib ketmasin)
  const key = String(sql).slice(0, 120);
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[TENANT-GUARD] tenant_id siz so'rov: ${table} — ${key}`);
  }
}
