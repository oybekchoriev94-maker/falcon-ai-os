import { getPool, q as pgQ, qGet as pgQGet, qExec as pgQExec } from '../../backend/db.js';

export function setDatabase(db) {}
export function getDatabase() { return null; }

export function isReady() {
  try {
    return !!getPool();
  } catch { return false; }
}

async function q(sql, params = []) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

async function qGet(sql, params = []) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}

async function qExec(sql, params = []) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

export { q, qGet, qExec };

export const TABLES = {
  clinics: 'tenants',
  doctors: 'doctors',
  referrals: 'referrals',
  inventory: 'inventory_items',
  inventoryTransactions: 'inventory_transactions',
  appointments: 'appointments',
  doctorAnalytics: 'doctor_analytics',
  medicationReminders: 'medication_reminders',
  telegramUsers: 'telegram_users',
  faceLogs: 'face_logs',
  patientQueue: 'patient_queue',
  voiceCalls: 'voice_calls',
  financialTransactions: 'financial_transactions',
  patientConsultations: 'patient_consultations',
  users: 'users',
};

export const AGENT_QUERIES = {
  totalPatientsToday: (tenantId) => qGet(`SELECT COUNT(*) as count FROM appointments WHERE tenant_id = $1 AND date(created_at) = CURRENT_DATE`, [tenantId]),
  totalRevenueToday: (tenantId) => qGet(`SELECT COALESCE(SUM(CAST(data_json->>'estimated_cost' AS REAL)), 0) as total FROM referrals WHERE tenant_id = $1 AND date(created_at) = CURRENT_DATE AND status = 'completed'`, [tenantId]),
  activeReminders: (tenantId) => qGet(`SELECT COUNT(*) as count FROM medication_reminders WHERE tenant_id = $1 AND status = 'active'`, [tenantId]),
  lowStockItems: (tenantId) => q(`SELECT id, name, sku, current_stock, min_stock, unit FROM inventory_items WHERE tenant_id = $1 AND current_stock <= min_stock ORDER BY (current_stock * 1.0 / NULLIF(min_stock, 0)) ASC LIMIT 20`, [tenantId]),
  doctorLeaderboard: (tenantId, period = 'daily') => {
    const days = { daily: 1, weekly: 7, monthly: 30 }[period] || 1;
    return q(`SELECT doctor_name, patients_count, total_revenue, total_procedures, errors_count FROM doctor_analytics WHERE tenant_id = $1 AND period_start >= CURRENT_DATE - $2::int ORDER BY total_revenue DESC`, [tenantId, days]);
  },
  pendingReferrals: (tenantId) => q(`SELECT id, patient_name, service_required, status, created_at FROM referrals WHERE tenant_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 20`, [tenantId]),
  recentAppointments: (tenantId) => q(`SELECT id, patient_name, doctor_name, department, status, created_at FROM appointments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10`, [tenantId]),
};
