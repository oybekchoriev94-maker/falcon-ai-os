// ============================================================
// FALCON AI OS — AI Alerts (xavfsizlik ogohlantirishlari)
//
// Xavfsizlik agentlari chiqargan ogohlantirishlarni ko'rish va yopish.
// UI header'idagi qo'ng'iroq belgisi ochilmagan alertlar sonini ko'rsatadi.
// ============================================================
import { Router } from 'express';

export default function alertsRoutes(pool, authMiddleware) {
  const router = Router();
  const tenantOf = (req) => req.user?.tenant_id || req.tenant_id || 'default';

  // GET /api/alerts?status=unresolved|resolved|all&severity=critical|warning|info&limit=50
  router.get('/', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const status = String(req.query.status || 'unresolved');
      const severity = String(req.query.severity || '').trim();
      const limit = Math.min(200, parseInt(req.query.limit || '50', 10) || 50);

      const filters = ['a.tenant_id = $1'];
      const params = [tenantId];
      let i = 2;
      if (status === 'unresolved') filters.push('a.resolved_at IS NULL');
      else if (status === 'resolved') filters.push('a.resolved_at IS NOT NULL');
      if (severity) { filters.push(`a.severity = $${i++}`); params.push(severity); }

      const { rows } = await pool.query(
        `SELECT a.id, a.severity, a.title, a.details, a.data_json,
                a.agent_name, a.source_kind, a.source_id,
                a.patient_id, a.admission_id, a.created_at, a.resolved_at,
                p.first_name || ' ' || COALESCE(p.last_name, '') AS patient_name,
                p.medical_record_number
         FROM ai_alerts a
         LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
         WHERE ${filters.join(' AND ')}
         ORDER BY (CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END),
                  a.created_at DESC
         LIMIT ${limit}`,
        params
      );

      // Yopilmagan alertlar bo'yicha soflar (UI badge)
      const { rows: countRows } = await pool.query(
        `SELECT severity, COUNT(*)::int AS n FROM ai_alerts
         WHERE tenant_id = $1 AND resolved_at IS NULL
         GROUP BY severity`,
        [tenantId]
      );
      const counts = { critical: 0, warning: 0, info: 0, total: 0 };
      for (const r of countRows) {
        counts[r.severity] = r.n;
        counts.total += r.n;
      }

      res.json({ success: true, alerts: rows, counts });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/alerts/:id/resolve  (api-client patch qo'llamaydi — POST ishlatamiz)
  router.post('/:id/resolve', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const note = String(req.body?.note || '').slice(0, 500) || null;
      const { rowCount } = await pool.query(
        `UPDATE ai_alerts SET resolved_at = NOW(), resolved_by = $1, resolution_note = $2
         WHERE tenant_id = $3 AND id = $4 AND resolved_at IS NULL`,
        [req.user?.id || null, note, tenantId, req.params.id]
      );
      if (rowCount === 0) {
        return res.status(404).json({ success: false, error: 'Alert topilmadi yoki allaqachon yechilgan' });
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
