// ============================================================
// Falcon AI OS — Tenant qo'riqchisi (umumiy)
//
// SaaS'da eng xavfli xato — so'rovda tenant_id ni unutish (boshqa klinika
// ma'lumoti ko'rinib qoladi). Bu modul shunday so'rovlarni aniqlaydi.
//
// Standart rejim barcha muhitda bloklaydi. Favqulodda diagnostika uchun
// TENANT_GUARD_MODE=warn vaqtincha faqat ogohlantirishga o'tkazishi mumkin.
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
  'edge_nodes', 'edge_nonces', 'vision_events',
  'clinics', 'branches', 'agent_executions',
  'staff_shifts', 'vision_zone_rules',
]);

const TABLE_RE = /\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?/gi;
const SQL_KEYWORDS = new Set([
  'where', 'set', 'values', 'on', 'inner', 'left', 'right', 'full', 'cross',
  'join', 'order', 'group', 'limit', 'returning', 'using',
]);

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

  const insert = lower.match(/\binsert\s+into\s+([a-z_][a-z0-9_]*)\s*\(([^)]*)\)/i);
  if (insert && TENANT_SCOPED_TABLES.has(insert[1])) {
    const columns = insert[2].split(',').map((column) => column.trim().replace(/"/g, ''));
    if (!columns.includes('tenant_id')) return insert[1];
  }

  const hasUnqualifiedTenantPredicate = /(?:^|[^.a-z0-9_])tenant_id\s*(?:=|in\s*\(|is\s+)/i.test(lower);
  TABLE_RE.lastIndex = 0;
  let m;
  while ((m = TABLE_RE.exec(lower)) !== null) {
    const table = m[1];
    if (!TENANT_SCOPED_TABLES.has(table)) continue;
    if (insert && insert[1] === table) continue;

    const alias = m[2] && !SQL_KEYWORDS.has(m[2]) ? m[2] : null;
    const aliasPredicate = alias
      ? new RegExp(`\\b${alias}\\.tenant_id\\s*(?:=|in\\s*\\(|is\\s+)`, 'i').test(lower)
      : false;
    const tablePredicate = new RegExp(`\\b${table}\\.tenant_id\\s*(?:=|in\\s*\\(|is\\s+)`, 'i').test(lower);

    if (!aliasPredicate && !tablePredicate && !hasUnqualifiedTenantPredicate) return table;
  }
  return null;
}

const WARN_ONLY = process.env.TENANT_GUARD_MODE === 'warn';
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

  if (!WARN_ONLY) throw new TenantScopeError(table);

  // Productionda: bir xil so'rov uchun bir marta ogohlantiramiz (log toshib ketmasin)
  const key = String(sql).slice(0, 120);
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(`[TENANT-GUARD] tenant_id siz so'rov: ${table} — ${key}`);
  }
}
