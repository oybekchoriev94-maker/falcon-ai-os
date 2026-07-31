// ============================================================
// FALCON AI OS — Laborator tekshiruvlar (Bosqich D).
// Shifokor buyuradi -> laborant/hamshira bajaradi -> natija bemor kartasiga.
// ============================================================
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { labCritical } from '../../ai/agents/safety-agents.js';
import { saveAlerts } from '../services/alerts.js';

const LAB_TEST_TYPES = [
  'blood_general', 'urine_general', 'biochem', 'coagulo', 'ekg',
  'rentgen', 'uzi', 'efgds', 'msct_mrt', 'specialist', 'custom',
];

export default function labsRoutes(pool, authMiddleware, checkRole) {
  const router = Router();

  async function q(sql, params = []) {
    const r = await pool.query(sql, params);
    return /^SELECT/i.test(sql.trim()) ? r.rows : r;
  }
  async function qGet(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  }
  const tenantOf = (req) => req.user?.tenant_id || req.tenant_id || 'default';
  const serverError = (res, e) => {
    console.error('[LABS]', e);
    res.status(500).json({ success: false, error: e?.message || 'Server xatosi' });
  };

  // POST /orders — tekshiruv buyurish (shifokor)
  const orderSchema = z.object({
    patient_id: z.string().uuid(),
    admission_id: z.string().uuid().optional(),
    appointment_id: z.number().int().optional(),
    test_type: z.enum(LAB_TEST_TYPES),
    test_name: z.string().max(200).optional(),
    reason: z.string().max(500).optional(),
  });

  router.post('/orders', authMiddleware, checkRole('doctor', 'admin', 'ceo'), async (req, res) => {
    const parsed = orderSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
    }
    const b = parsed.data;
    try {
      const tenantId = tenantOf(req);
      const patient = await qGet('SELECT id FROM patients WHERE id = $1 AND tenant_id = $2', [b.patient_id, tenantId]);
      if (!patient) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });

      const id = uuidv4();
      await q(
        `INSERT INTO lab_orders
           (id, tenant_id, patient_id, admission_id, appointment_id,
            ordered_by_doctor_id, ordered_by_doctor_name,
            test_type, test_name, reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, tenantId, patient.id, b.admission_id || null, b.appointment_id || null,
         req.user?.id || null, req.user?.name || req.user?.username || null,
         b.test_type, b.test_name || null, b.reason || null]
      );
      res.status(201).json({ success: true, id });
    } catch (e) { serverError(res, e); }
  });

  // GET /queue — laborant ish stoli uchun.
  // paid_at IS NOT NULL (bemor to'lagan) va status='ordered' bo'lgan buyurtmalar,
  // bemor F.I.O + MRN + telefon bilan. Bosqich J oqimida bemor kassaga to'lagach,
  // laborant shu ro'yxatda ko'radi.
  router.get('/queue', authMiddleware, checkRole('doctor', 'admin', 'ceo', 'receptionist'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const paidOnly = String(req.query.paid_only || 'true') === 'true';
      const paidFilter = paidOnly ? 'AND lo.paid_at IS NOT NULL' : '';
      const rows = await q(
        `SELECT lo.id, lo.test_type, lo.reason, lo.status, lo.ordered_at, lo.paid_at,
                lo.patient_id, lo.doctor_id,
                p.first_name || ' ' || COALESCE(p.last_name, '') AS patient_name,
                p.medical_record_number, p.phone,
                p.birth_date, p.gender,
                d.first_name || ' ' || COALESCE(d.last_name, '') AS doctor_name
         FROM lab_orders lo
         LEFT JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
         LEFT JOIN doctors d  ON d.id = lo.doctor_id  AND d.tenant_id = lo.tenant_id
         WHERE lo.tenant_id = $1 AND lo.status = 'ordered' ${paidFilter}
         ORDER BY lo.paid_at NULLS LAST, lo.ordered_at ASC LIMIT 200`,
        [tenantId]
      );
      res.json({ success: true, orders: rows });
    } catch (e) { serverError(res, e); }
  });

  // GET /orders?status=&patient_id=&admission_id=
  router.get('/orders', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const filters = ['tenant_id = $1'];
      const params = [tenantId];
      let i = 2;
      if (req.query.status) { filters.push(`status = $${i++}`); params.push(String(req.query.status)); }
      if (req.query.patient_id) { filters.push(`patient_id = $${i++}`); params.push(String(req.query.patient_id)); }
      if (req.query.admission_id) { filters.push(`admission_id = $${i++}`); params.push(String(req.query.admission_id)); }

      const rows = await q(
        `SELECT lo.*, lr.values_json AS result_values, lr.conclusion AS result_conclusion,
                lr.pdf_path AS result_pdf, lr.entered_at AS result_at, lr.entered_by_name AS result_by
         FROM lab_orders lo
         LEFT JOIN lab_results lr ON lr.lab_order_id = lo.id AND lr.tenant_id = lo.tenant_id
         WHERE ${filters.join(' AND ')}
         ORDER BY lo.ordered_at DESC LIMIT 200`,
        params
      );
      res.json({ success: true, orders: rows });
    } catch (e) { serverError(res, e); }
  });

  // POST /orders/:id/result — natijani kiritish (laborant/hamshira)
  const resultSchema = z.object({
    values_json: z.record(z.any()).optional(),
    conclusion: z.string().max(4000).optional(),
    pdf_path: z.string().max(500).optional(),
  });

  router.post('/orders/:id/result', authMiddleware, checkRole('doctor', 'admin', 'ceo', 'receptionist'), async (req, res) => {
    const parsed = resultSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
    }
    const b = parsed.data;
    const client = await pool.connect();
    try {
      const tenantId = tenantOf(req);
      const order = await qGet(
        'SELECT id, patient_id FROM lab_orders WHERE id = $1 AND tenant_id = $2',
        [req.params.id, tenantId]
      );
      if (!order) return res.status(404).json({ success: false, error: 'Buyurtma topilmadi' });

      await client.query('BEGIN');
      const resId = uuidv4();
      await client.query(
        `INSERT INTO lab_results (id, tenant_id, lab_order_id, patient_id,
           values_json, conclusion, pdf_path, entered_by, entered_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [resId, tenantId, order.id, order.patient_id,
         b.values_json ? JSON.stringify(b.values_json) : null,
         b.conclusion || null, b.pdf_path || null,
         req.user?.id || null, req.user?.name || req.user?.username || null]
      );
      await client.query(
        `UPDATE lab_orders SET status = 'completed', completed_at = NOW(),
           performed_by = $1, performed_by_name = $2
         WHERE id = $3 AND tenant_id = $4`,
        [req.user?.id || null, req.user?.name || req.user?.username || null, order.id, tenantId]
      );
      await client.query('COMMIT');

      // AUTO-AGENT: lab-critical — natija matnidan hayotiy chegaralarni tekshiradi
      try {
        // values_json.text yoki conclusion — qaysi bo'lsa shu ishlatiladi
        const raw = (b.values_json && (b.values_json.text || JSON.stringify(b.values_json))) || b.conclusion || '';
        if (raw && raw.length > 3) {
          const lc = labCritical.handler({ raw_text: raw });
          if (lc?.alerts?.length) {
            saveAlerts(pool, {
              tenantId, patientId: order.patient_id, admissionId: null,
              sourceKind: 'lab_result', sourceId: resId, agentName: 'lab-critical',
            }, lc.alerts).catch(() => {});
          }
        }
      } catch (aiErr) {
        console.warn('[SAFETY lab-critical]', aiErr.message);
      }

      res.json({ success: true, result_id: resId });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      serverError(res, e);
    } finally { client.release(); }
  });

  // POST /orders/:id/cancel
  router.post('/orders/:id/cancel', authMiddleware, checkRole('doctor', 'admin', 'ceo'), async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const r = await pool.query(
        `UPDATE lab_orders SET status = 'cancelled'
         WHERE id = $1 AND tenant_id = $2 AND status = 'ordered'`,
        [req.params.id, tenantId]
      );
      if (r.rowCount === 0) return res.status(404).json({ success: false, error: 'Buyurtma topilmadi yoki bajarilgan' });
      res.json({ success: true });
    } catch (e) { serverError(res, e); }
  });

  return router;
}
