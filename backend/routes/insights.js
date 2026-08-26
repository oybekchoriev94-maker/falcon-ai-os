// ============================================================
// FALCON AI OS — Biznes hisobotlar (Bosqich P)
//
// XAVFSIZLIK:
//  1) FAQAT ceo/admin/superadmin — checkRole enforce.
//  2) Tenant izolatsiya — barcha SQL tenant_id bilan filter.
//  3) Rate limit — soatiga 20 chaqiruv (og'ir hisobot).
//  4) Kesh — 1 soat (LLM chaqirig'ini takrorlamaslik).
//  5) Audit — kim, qachon, qaysi hisobot ochgani business_report_audit'ga.
//  6) PII protection — LLM'ga bemor F.I.O yoki telefon o'tmaydi.
// ============================================================
import { Router } from 'express';
import {
  revenueForecaster, staffUtilization, serviceProfitability, churnDetector,
} from '../../ai/agents/business-intel.js';

// Sodda rate limiter (tenant + user bo'yicha, in-memory)
const rateBuckets = new Map();
function checkRate(key, limitPerHour = 20) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + 3600_000 };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + 3600_000; }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count <= limitPerHour;
}

export default function insightsRoutes(pool, authMiddleware, checkRole) {
  const router = Router();
  const tenantOf = (req) => req.user?.tenant_id || req.tenant_id || 'default';

  // Barcha endpointlar ceo/admin/superadmin uchun
  router.use(authMiddleware, checkRole('ceo', 'admin', 'superadmin'));

  // Rate limit middleware
  router.use((req, res, next) => {
    const key = `${tenantOf(req)}:${req.user?.id || 'anon'}`;
    if (!checkRate(key, 20)) {
      return res.status(429).json({ success: false, error: 'Juda ko\'p so\'rov — 1 soatdan keyin qayta urinib ko\'ring' });
    }
    next();
  });

  // Audit middleware
  async function logAudit(req, insight_kind, period, params = {}) {
    try {
      await pool.query(
        `INSERT INTO business_report_audit (tenant_id, user_id, user_role, insight_kind, period, params_json, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [tenantOf(req), req.user?.id || null, req.user?.role || null,
         insight_kind, period, JSON.stringify(params),
         req.ip || req.headers['x-forwarded-for'] || null]
      );
    } catch (_) { /* audit ishlamasa asosiy oqim buzilmaydi */ }
  }

  // Kesh helper
  async function getCached(tenantId, kind, period) {
    const { rows } = await pool.query(
      `SELECT data_json FROM business_insights_cache
       WHERE tenant_id = $1 AND insight_kind = $2 AND period = $3 AND expires_at > NOW()`,
      [tenantId, kind, period]
    );
    return rows[0]?.data_json || null;
  }
  async function setCached(tenantId, kind, period, data) {
    await pool.query(
      `INSERT INTO business_insights_cache (tenant_id, insight_kind, period, data_json)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (tenant_id, insight_kind, period)
       DO UPDATE SET data_json = EXCLUDED.data_json,
                     generated_at = NOW(),
                     expires_at = NOW() + INTERVAL '1 hour'`,
      [tenantId, kind, period, JSON.stringify(data)]
    );
  }

  // ── 1) REVENUE FORECAST ──
  router.get('/revenue', async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const period = String(req.query.period || '12m');
      const monthsBack = period === '6m' ? 6 : period === '3m' ? 3 : 12;

      const cached = await getCached(tenantId, 'revenue', period);
      if (cached && !req.query.refresh) return res.json({ success: true, cached: true, ...cached });

      // Aggregate — hech qanday bemor F.I.O LLM'ga o'tmaydi
      const monthly = (await pool.query(
        `SELECT to_char(paid_at, 'YYYY-MM') AS month,
                SUM(amount)::float8 AS total,
                COUNT(DISTINCT appointment_id) AS appointments_count,
                COUNT(DISTINCT (SELECT patient_id FROM appointments WHERE id = pt.appointment_id))::int AS unique_patients
         FROM payment_transactions pt
         WHERE tenant_id = $1 AND status = 'paid'
           AND paid_at >= NOW() - ($2 || ' months')::interval
         GROUP BY 1 ORDER BY 1`,
        [tenantId, String(monthsBack)]
      )).rows;

      if (monthly.length === 0) {
        return res.json({ success: true, cached: false, empty: true,
          message: 'To\'lov tarixi bo\'sh — bashorat qilib bo\'lmaydi' });
      }

      const result = await revenueForecaster.handler({
        monthly_revenue: monthly.map((m) => ({
          month: m.month,
          total: m.total || 0,
          appointments_count: parseInt(m.appointments_count || 0, 10),
          unique_patients: parseInt(m.unique_patients || 0, 10),
        })),
      });

      const out = { ...result, history: monthly };
      await setCached(tenantId, 'revenue', period, out);
      await logAudit(req, 'revenue', period);
      res.json({ success: true, cached: false, ...out });
    } catch (e) {
      console.error('[INSIGHTS revenue]', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── 2) STAFF UTILIZATION ──
  router.get('/staff', async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const period = String(req.query.period || '30d');
      const daysBack = period === '7d' ? 7 : period === '90d' ? 90 : 30;

      const cached = await getCached(tenantId, 'staff', period);
      if (cached && !req.query.refresh) return res.json({ success: true, cached: true, ...cached });

      // Har shifokor uchun band vaqt (haftalik o'rtacha)
      const rows = (await pool.query(
        `WITH slot AS (
           SELECT doctor_id,
                  COUNT(*)::float8 AS appt_count,
                  SUM(COALESCE(s.duration_min, 20))::float8 / 60.0 AS total_hours
           FROM appointments a
           LEFT JOIN services_catalog s ON s.id = a.service_id
           WHERE a.tenant_id = $1
             AND a.scheduled_at >= NOW() - ($2 || ' days')::interval
             AND a.status IN ('scheduled', 'completed')
           GROUP BY doctor_id
         )
         SELECT d.id, d.first_name || ' ' || COALESCE(d.last_name, '') AS name,
                d.specialization,
                COALESCE(slot.total_hours, 0) AS booked_hours,
                40.0 AS capacity_hours   -- default: 8h × 5 kun (kelajakda doctor_schedule'dan)
         FROM doctors d
         LEFT JOIN slot ON slot.doctor_id = d.id
         WHERE d.tenant_id = $1 AND d.is_active IS NOT FALSE
         ORDER BY name`,
        [tenantId, String(daysBack)]
      )).rows;

      const weeks = daysBack / 7;
      const doctors = rows.map((r) => ({
        id: r.id,
        name: (r.name || '').trim(),
        specialization: r.specialization,
        capacity_hours_per_week: 40,
        booked_hours_per_week: Math.round((r.booked_hours / weeks) * 10) / 10,
      }));

      const result = staffUtilization.handler({ doctors });
      await setCached(tenantId, 'staff', period, result);
      await logAudit(req, 'staff', period);
      res.json({ success: true, cached: false, ...result });
    } catch (e) {
      console.error('[INSIGHTS staff]', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── 3) SERVICE PROFITABILITY ──
  router.get('/services', async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const period = String(req.query.period || '30d');
      const daysBack = period === '7d' ? 7 : period === '90d' ? 90 : 30;

      const cached = await getCached(tenantId, 'services', period);
      if (cached && !req.query.refresh) return res.json({ success: true, cached: true, ...cached });

      const rows = (await pool.query(
        `SELECT s.name, s.category,
                COUNT(a.id)::int AS count,
                SUM(a.amount)::float8 AS revenue,
                AVG(a.amount)::float8 AS avg_price
         FROM appointments a
         JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1
           AND a.status = 'completed'
           AND a.scheduled_at >= NOW() - ($2 || ' days')::interval
         GROUP BY s.name, s.category
         ORDER BY revenue DESC NULLS LAST`,
        [tenantId, String(daysBack)]
      )).rows;

      const result = serviceProfitability.handler({
        services: rows.map((r) => ({
          name: r.name,
          category: r.category,
          count: r.count || 0,
          revenue: r.revenue || 0,
          avg_price: Math.round(r.avg_price || 0),
        })),
      });
      await setCached(tenantId, 'services', period, result);
      await logAudit(req, 'services', period);
      res.json({ success: true, cached: false, ...result });
    } catch (e) {
      console.error('[INSIGHTS services]', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── 4) CHURN DETECTOR ──
  router.get('/churn', async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const period = String(req.query.period || '90d');
      const daysBack = parseInt(period, 10) || 90;

      const cached = await getCached(tenantId, 'churn', period);
      if (cached && !req.query.refresh) return res.json({ success: true, cached: true, ...cached });

      // Ilgari kelgan, lekin oxirgi N kunda kelmagan bemorlar
      const candidates = (await pool.query(
        `WITH last_visit AS (
           SELECT patient_id,
                  MAX(scheduled_at) AS last_at,
                  COUNT(*)::int AS total
           FROM appointments
           WHERE tenant_id = $1 AND patient_id IS NOT NULL AND status = 'completed'
           GROUP BY patient_id
         )
         SELECT patient_id::text,
                (EXTRACT(EPOCH FROM (NOW() - last_at)) / 86400)::int AS days_ago,
                total
         FROM last_visit
         WHERE last_at < NOW() - ($2 || ' days')::interval
           AND total >= 2
         ORDER BY total DESC, last_at DESC
         LIMIT 200`,
        [tenantId, String(daysBack)]
      )).rows;

      const totalActive = (await pool.query(
        `SELECT COUNT(DISTINCT patient_id)::int AS n
         FROM appointments WHERE tenant_id = $1 AND patient_id IS NOT NULL
           AND scheduled_at >= NOW() - INTERVAL '365 days'`,
        [tenantId]
      )).rows[0]?.n || 0;

      const result = churnDetector.handler({
        patients: candidates.map((c) => ({
          patient_id: c.patient_id,
          last_visit_days_ago: c.days_ago,
          total_visits: c.total,
        })),
        total_active_patients: totalActive,
      });
      await setCached(tenantId, 'churn', period, result);
      await logAudit(req, 'churn', period);
      res.json({ success: true, cached: false, ...result });
    } catch (e) {
      console.error('[INSIGHTS churn]', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
