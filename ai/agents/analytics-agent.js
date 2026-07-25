// ============================================================
// Analytics Agent — klinika KPI, trend va tavsiyalar tahlili
// ============================================================

import { z } from 'zod';
import { llmJson } from '../core/tools.js';

export const name = 'analytics-agent';
export const description = 'Klinika tahlilchisi — moliyaviy KPI, shifokor samaradorligi, trend va tavsiyalar';
export const version = '3.0.0';
export const category = 'analytics';

export const schema = z.object({
  type: z.enum(['full', 'kpi', 'doctor', 'finance', 'inventory']).optional(),
  doctor_id: z.string().uuid().optional(),
  days: z.number().int().min(1).max(365).optional(),
});

const SYSTEM_PROMPT = `Siz klinika bosh tahlilchisisiz. Berilgan ma'lumotlarni tahlil qilib,
faqat JSON qaytaring (boshqa matnsiz):
{
  "summary": "string",
  "score": 0.0,
  "trends": { "revenue": "up|down|stable", "patients": "up|down|stable" },
  "anomalies": ["string"],
  "recommendations": ["string"],
  "forecast": { "next_month_revenue": 0, "confidence": 0.0 }
}
Javobni o'zbek tilida yozing. Ma'lumot kam bo'lsa, buni summary da halol ayting.`;

export async function handler(input, ctx) {
  const { db, tenantId } = ctx;
  const days = input.days || 30;

  // ─── Metrikalarni yig'ish (hammasi tenant chegarasida) ────
  const [todayPatients, periodRevenue, lowStock, doctors, pendingRefs, deptDist, consultations] = await Promise.all([
    db.qGet(
      `SELECT COUNT(*)::int AS count FROM appointments WHERE tenant_id = $1 AND created_at::date = CURRENT_DATE`,
      [tenantId]
    ),
    db.qGet(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM payment_transactions
       WHERE tenant_id = $1 AND status = 'paid' AND created_at >= CURRENT_DATE - ($2::int || ' days')::interval`,
      [tenantId, days]
    ),
    db.qGet(
      `SELECT COUNT(*)::int AS count FROM inventory_items
       WHERE tenant_id = $1 AND min_stock IS NOT NULL AND current_stock <= min_stock`,
      [tenantId]
    ),
    db.q(
      `SELECT doctor_name, SUM(patients_count)::int AS patients_count,
              COALESCE(SUM(total_revenue),0) AS total_revenue, COALESCE(SUM(total_procedures),0)::int AS total_procedures
       FROM doctor_analytics WHERE tenant_id = $1
       GROUP BY doctor_name ORDER BY 3 DESC LIMIT 10`,
      [tenantId]
    ),
    db.qGet(
      `SELECT COUNT(*)::int AS count FROM referrals WHERE tenant_id = $1 AND status = 'pending'`,
      [tenantId]
    ),
    db.q(
      `SELECT COALESCE(department,'—') AS department, COUNT(*)::int AS count FROM appointments
       WHERE tenant_id = $1 AND created_at >= CURRENT_DATE - ($2::int || ' days')::interval
       GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
      [tenantId, days]
    ),
    db.qGet(
      `SELECT COUNT(*)::int AS count FROM patient_consultations
       WHERE tenant_id = $1 AND created_at >= CURRENT_DATE - ($2::int || ' days')::interval`,
      [tenantId, days]
    ),
  ]);

  const metrics = {
    period_days: days,
    today_patients: todayPatients?.count || 0,
    period_revenue: Number(periodRevenue?.total || 0),
    low_stock_items: lowStock?.count || 0,
    consultations: consultations?.count || 0,
    pending_referrals: pendingRefs?.count || 0,
    doctor_leaderboard: doctors,
    department_distribution: deptDist,
    generated_at: new Date().toISOString(),
  };

  let prompt = SYSTEM_PROMPT + `\n\nTahlil turi: ${input.type || 'full'}`;
  if (input.doctor_id) prompt += `\nDiqqat: ${input.doctor_id} ID li shifokorga e'tibor bering.`;

  const analysis = await llmJson(prompt, `Klinika ma'lumotlari:\n${JSON.stringify(metrics, null, 2)}`, {
    temperature: 0.2,
    maxTokens: 1500,
  });

  return {
    analysis_type: input.type || 'full',
    metrics,
    analysis: (analysis && typeof analysis === 'object') ? analysis : { summary: String(analysis || '') },
  };
}
