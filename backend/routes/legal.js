// ============================================================
// FALCON AI OS — Yuridik hujjatlar (Bosqich F).
// Rozilik shabloni + bemor imzosi, shartnoma, xizmat akti.
// ============================================================
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

export default function legalRoutes(pool, authMiddleware, checkRole) {
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
    console.error('[LEGAL]', e);
    res.status(500).json({ success: false, error: e?.message || 'Server xatosi' });
  };

  // ── CONSENT TEMPLATES (klinika admin) ──
  router.get('/consent-templates', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const rows = await q(
        `SELECT * FROM consent_templates WHERE tenant_id = $1 AND active = true ORDER BY kind, title`,
        [tenantId]
      );
      res.json({ success: true, templates: rows });
    } catch (e) { serverError(res, e); }
  });

  const templateSchema = z.object({
    kind: z.enum(['surgery_general', 'surgery_gyn', 'anesthesia', 'blood_transfusion', 'custom']),
    title: z.string().min(2).max(300),
    body_md: z.string().max(20000).optional(),
    checkboxes_json: z.array(z.object({
      id: z.string(), label: z.string(), required: z.boolean().optional(),
    })).optional(),
  });

  router.post('/consent-templates', authMiddleware, checkRole('ceo', 'admin'), async (req, res) => {
    const parsed = templateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
    try {
      const tenantId = tenantOf(req);
      const b = parsed.data;
      const id = uuidv4();
      await q(
        `INSERT INTO consent_templates (id, tenant_id, kind, title, body_md, checkboxes_json)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, tenantId, b.kind, b.title, b.body_md || null, b.checkboxes_json ? JSON.stringify(b.checkboxes_json) : null]
      );
      res.status(201).json({ success: true, id });
    } catch (e) { serverError(res, e); }
  });

  // ── PATIENT CONSENTS ──
  const consentSchema = z.object({
    patient_id: z.string().uuid(),
    admission_id: z.string().uuid().optional(),
    template_id: z.string().uuid().optional(),
    kind: z.string().max(50),
    title: z.string().max(300).optional(),
    selected_options: z.array(z.string()).optional(),
    notes: z.string().max(2000).optional(),
    signature_image: z.string().max(500000).optional(),
  });

  router.post('/consents', authMiddleware, async (req, res) => {
    const parsed = consentSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
    try {
      const tenantId = tenantOf(req);
      const b = parsed.data;
      const id = uuidv4();
      await q(
        `INSERT INTO patient_consents
           (id, tenant_id, patient_id, admission_id, template_id, kind, title,
            selected_options, notes, signature_image, collected_by, collected_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, tenantId, b.patient_id, b.admission_id || null, b.template_id || null,
         b.kind, b.title || null,
         b.selected_options ? JSON.stringify(b.selected_options) : null,
         b.notes || null, b.signature_image || null,
         req.user?.id || null, req.user?.name || req.user?.username || null]
      );
      res.status(201).json({ success: true, id });
    } catch (e) { serverError(res, e); }
  });

  router.get('/consents', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const patientId = req.query.patient_id;
      if (!patientId) return res.status(400).json({ success: false, error: 'patient_id kerak' });
      const rows = await q(
        `SELECT id, kind, title, selected_options, signed_at, collected_by_name, pdf_path
         FROM patient_consents
         WHERE tenant_id = $1 AND patient_id = $2
         ORDER BY signed_at DESC LIMIT 100`,
        [tenantId, patientId]
      );
      res.json({ success: true, consents: rows });
    } catch (e) { serverError(res, e); }
  });

  // ── SERVICE CONTRACTS ──
  const contractItemSchema = z.object({
    name: z.string().min(1).max(500),
    unit: z.string().max(50).optional(),
    qty: z.number().positive().default(1),
    price: z.number().nonnegative(),
    sum: z.number().nonnegative().optional(),
  });
  const contractSchema = z.object({
    patient_id: z.string().uuid(),
    admission_id: z.string().uuid().optional(),
    patient_name: z.string().max(300).optional(),
    patient_passport: z.string().max(50).optional(),
    patient_address: z.string().max(500).optional(),
    sponsor_name: z.string().max(300).optional(),
    sponsor_passport: z.string().max(50).optional(),
    items: z.array(contractItemSchema).min(1),
  });

  async function nextNumber(client, tenantId, table, column, prefix) {
    const year = new Date().getFullYear();
    const like = `${prefix}${year}-%`;
    const { rows } = await client.query(
      `SELECT ${column} AS n FROM ${table} WHERE tenant_id = $1 AND ${column} LIKE $2
       ORDER BY ${column} DESC LIMIT 1`,
      [tenantId, like]
    );
    const last = rows[0]?.n;
    const num = last ? (parseInt(String(last).slice(prefix.length + 5), 10) || 0) + 1 : 1;
    return `${prefix}${year}-${String(num).padStart(5, '0')}`;
  }

  router.post('/contracts', authMiddleware, checkRole('ceo', 'admin', 'receptionist'), async (req, res) => {
    const parsed = contractSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
    const b = parsed.data;
    const client = await pool.connect();
    try {
      const tenantId = tenantOf(req);
      await client.query('BEGIN');
      const total = b.items.reduce((s, it) => s + (it.sum ?? it.qty * it.price), 0);
      const contractNumber = await nextNumber(client, tenantId, 'service_contracts', 'contract_number', 'C');
      const id = uuidv4();
      await client.query(
        `INSERT INTO service_contracts
           (id, tenant_id, contract_number, patient_id, admission_id, patient_name,
            patient_passport, patient_address, sponsor_name, sponsor_passport,
            items_json, total_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, tenantId, contractNumber, b.patient_id, b.admission_id || null,
         b.patient_name || null, b.patient_passport || null, b.patient_address || null,
         b.sponsor_name || null, b.sponsor_passport || null,
         JSON.stringify(b.items), total]
      );
      await client.query('COMMIT');
      res.status(201).json({ success: true, id, contract_number: contractNumber, total_amount: total });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      serverError(res, e);
    } finally { client.release(); }
  });

  router.get('/contracts', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const patientId = req.query.patient_id;
      if (!patientId) return res.status(400).json({ success: false, error: 'patient_id kerak' });
      const rows = await q(
        `SELECT id, contract_number, contract_date, total_amount, pdf_path, signed_at
         FROM service_contracts WHERE tenant_id = $1 AND patient_id = $2
         ORDER BY contract_date DESC LIMIT 100`,
        [tenantId, patientId]
      );
      res.json({ success: true, contracts: rows });
    } catch (e) { serverError(res, e); }
  });

  // ── SERVICE ACTS ──
  const actSchema = z.object({
    contract_id: z.string().uuid().optional(),
    patient_id: z.string().uuid(),
    admission_id: z.string().uuid().optional(),
    items: z.array(contractItemSchema).min(1),
    paid_amount: z.number().nonnegative().optional(),
  });

  router.post('/acts', authMiddleware, checkRole('ceo', 'admin', 'receptionist'), async (req, res) => {
    const parsed = actSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
    const b = parsed.data;
    const client = await pool.connect();
    try {
      const tenantId = tenantOf(req);
      await client.query('BEGIN');
      const total = b.items.reduce((s, it) => s + (it.sum ?? it.qty * it.price), 0);
      const paid = b.paid_amount || 0;
      const actNumber = await nextNumber(client, tenantId, 'service_acts', 'act_number', 'A');
      const id = uuidv4();
      await client.query(
        `INSERT INTO service_acts
           (id, tenant_id, act_number, contract_id, patient_id, admission_id,
            items_json, total_amount, paid_amount, balance)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, tenantId, actNumber, b.contract_id || null, b.patient_id, b.admission_id || null,
         JSON.stringify(b.items), total, paid, total - paid]
      );
      await client.query('COMMIT');
      res.status(201).json({ success: true, id, act_number: actNumber, total, paid, balance: total - paid });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      serverError(res, e);
    } finally { client.release(); }
  });

  router.get('/acts', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const patientId = req.query.patient_id;
      if (!patientId) return res.status(400).json({ success: false, error: 'patient_id kerak' });
      const rows = await q(
        `SELECT id, act_number, act_date, total_amount, paid_amount, balance, pdf_path
         FROM service_acts WHERE tenant_id = $1 AND patient_id = $2
         ORDER BY act_date DESC LIMIT 100`,
        [tenantId, patientId]
      );
      res.json({ success: true, acts: rows });
    } catch (e) { serverError(res, e); }
  });

  return router;
}
