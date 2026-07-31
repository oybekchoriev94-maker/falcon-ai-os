// ============================================================
// FALCON AI OS — AI xavfsizlik ogohlantirish yordamchisi
//
// Agentlar chiqargan alertlar shu servis orqali bazaga tushadi. Har
// endpoint (obhod, lab, retsept) o'z ishini bajarib, oxirida
// `saveAlerts(pool, {...}, alerts)` chaqiradi. Agent xato bersa yoki
// LLM off bo'lsa — asosiy oqim buzilmaydi (fire-and-forget).
// ============================================================
import { v4 as uuidv4 } from 'uuid';

/**
 * Alertlar ro'yxatini ai_alerts jadvaliga yozadi.
 * @param {import('pg').Pool} pool
 * @param {object} ctx { tenantId, patientId, admissionId, sourceKind, sourceId, agentName }
 * @param {Array<{severity, title, details}>} alerts
 */
export async function saveAlerts(pool, ctx, alerts) {
  if (!alerts || alerts.length === 0) return 0;
  const rows = alerts.map((a) => [
    uuidv4(),
    ctx.tenantId,
    ctx.patientId || null,
    ctx.admissionId || null,
    ctx.sourceKind,
    ctx.sourceId || null,
    ctx.agentName,
    a.severity || 'info',
    a.title,
    a.details || null,
    a.data_json ? JSON.stringify(a.data_json) : null,
  ]);
  try {
    // Bir INSERT bir necha alert (bir uzatilishda tenglash)
    const values = rows.map((_, i) => {
      const b = i * 11;
      return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10},$${b+11})`;
    }).join(', ');
    await pool.query(
      `INSERT INTO ai_alerts
         (id, tenant_id, patient_id, admission_id, source_kind, source_id,
          agent_name, severity, title, details, data_json)
       VALUES ${values}`,
      rows.flat()
    );
    return rows.length;
  } catch (e) {
    console.warn('[ALERTS] saveAlerts:', e.message);
    return 0;
  }
}

/**
 * Faol dorilar ro'yxati (drug-interaction agenti uchun input).
 */
export async function fetchActiveMeds(pool, tenantId, patientId) {
  if (!patientId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT p.medicine_name || ' ' || COALESCE(p.dosage, '') AS med
       FROM prescriptions p
       JOIN admissions a ON a.id = p.admission_id AND a.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1 AND a.patient_id = $2
         AND p.status = 'active'
         AND (p.end_date IS NULL OR p.end_date >= CURRENT_DATE)
       LIMIT 30`,
      [tenantId, patientId]
    );
    return rows.map((r) => r.med).filter(Boolean);
  } catch (e) {
    console.warn('[ALERTS] fetchActiveMeds:', e.message);
    return [];
  }
}

/**
 * Bemor allergiya matnini olish (drug-interaction agenti uchun input).
 */
export async function fetchAllergies(pool, tenantId, patientId) {
  if (!patientId) return '';
  try {
    const { rows } = await pool.query(
      `SELECT allergies FROM patients WHERE tenant_id = $1 AND id = $2`,
      [tenantId, patientId]
    );
    return rows[0]?.allergies || '';
  } catch { return ''; }
}
