import { Router } from 'express';
import { safeError } from '../services/safe-error.js';

export default function patientRoutes(pool, authMiddleware) {
  const router = Router();
  router.use(authMiddleware);

  router.get('/report/:id', async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM medical_reports WHERE id = $1 AND tenant_id = $2",
        [req.params.id, req.user.tenant_id]
      );
      const r = result.rows[0] || null;
      if (!r) return res.status(404).json({ success: false, error: 'Hisobot topilmadi' });
      let data = {};
      if (r.data_json) {
        try { data = JSON.parse(r.data_json); } catch (e) { data = { raw: r.data_json }; }
      }
      const medicines = data.medicines || data.medication || null;
      res.json({
        success: true,
        report: {
          id: r.id,
          patient_name: r.patient_name,
          doctor_name: r.doctor_name,
          specialization: r.specialization,
          specialization_label: r.specialization_label,
          pdf_url: r.pdf_path ? `/reports/${r.pdf_path}` : null,
          created_at: r.created_at,
          data
        },
        medicines
      });
    } catch (e) {
      safeError(res, e);
    }
  });

  return router;
}
