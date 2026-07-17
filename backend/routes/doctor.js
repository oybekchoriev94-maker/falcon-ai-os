import { Router } from 'express';

export default function doctorRoutes(pool, authMiddleware, checkRole, serverError) {
  const router = Router();

  async function q(sql, params = []) {
    const r = await pool.query(sql, params);
    return /^SELECT/i.test(sql.trim()) ? r.rows : r;
  }
  async function qGet(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  }

  router.get('/my-patients', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const patients = await q("SELECT * FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY created_at DESC LIMIT 50", [tenantId, req.user.id]);
      const appointments = await q("SELECT * FROM appointments WHERE tenant_id = $1 AND doctor_name = $2 ORDER BY created_at DESC LIMIT 20", [tenantId, req.user.name]);
      res.json({ success: true, patients: patients.length, consultations: patients, appointments });
    } catch (e) { serverError(res, e); }
  });

  router.get('/my-stats', authMiddleware, checkRole('doctor'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const stats = await qGet("SELECT * FROM doctor_analytics WHERE tenant_id = $1 AND doctor_id = $2 ORDER BY period_start DESC LIMIT 1", [tenantId, req.user.id]);
      const recent = await qGet("SELECT COUNT(*) as c FROM patient_consultations WHERE tenant_id = $1 AND doctor_id = $2 AND date(created_at) = CURRENT_DATE", [tenantId, req.user.id]);
      res.json({ success: true, stats: stats || { patients_count: 0, total_revenue: 0 }, today_patients: parseInt(recent?.c || 0) });
    } catch (e) { serverError(res, e); }
  });

  return router;
}
