// ============================================================
// FALCON AI OS — Bemorlar CRUD
// (avval face.js ichida edi; Face ID olib tashlangach shu yerga ko'chirildi)
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { safeError } from '../services/safe-error.js';

const PATIENT_COLUMNS =
  'id, first_name, last_name, middle_name, phone, birth_date, region, district, address, ' +
  'passport_number, gender, benefit_category, department, order_number, medical_record_number, notes, created_at';

export default function patientsRoutes(pool, authMiddleware) {
  const router = Router();
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
  const qGet = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;

  const patientSchema = z.object({
    first_name: z.string().min(2).max(100),
    last_name: z.string().max(100).optional(),
    middle_name: z.string().max(100).optional(),
    phone: z.string().max(20).optional(),
    birth_date: z.string().max(20).optional(),
    region: z.string().max(100).optional(),
    district: z.string().max(100).optional(),
    address: z.string().max(500).optional(),
    passport_number: z.string().max(20).optional(),
    gender: z.string().max(10).optional(),
    benefit_category: z.string().max(100).optional(),
    department: z.string().max(100).optional(),
    order_number: z.string().max(50).optional(),
    medical_record_number: z.string().max(50).optional(),
    notes: z.string().max(1000).optional(),
  });

  const validate = (schema) => (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ error: 'Validatsiya xatosi', details: result.error.flatten().fieldErrors });
    }
    req.body = result.data;
    next();
  };

  const tenantOf = (req) => req.user?.tenant_id || req.tenant_id || 'default';

  // GET / — bemorlarni qidirish/ro'yxatlash
  router.get('/', authMiddleware, async (req, res) => {
    try {
      const tenantId = tenantOf(req);
      const query = (req.query.q || '').trim();
      const patients = query
        ? await q(
            `SELECT ${PATIENT_COLUMNS} FROM patients WHERE tenant_id = $1 AND (first_name ILIKE $2 OR last_name ILIKE $2 OR phone ILIKE $2) ORDER BY created_at DESC LIMIT 50`,
            [tenantId, `%${query}%`]
          )
        : await q(
            `SELECT ${PATIENT_COLUMNS} FROM patients WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
            [tenantId]
          );
      res.json({ success: true, total: patients.length, patients });
    } catch (e) { safeError(res, e); }
  });

  // POST / — yangi bemor qo'shish
  router.post('/', authMiddleware, validate(patientSchema), async (req, res) => {
    try {
      const b = req.body;
      const tenantId = tenantOf(req);
      const id = uuidv4();
      await q(
        `INSERT INTO patients (id, tenant_id, first_name, last_name, middle_name, phone, birth_date, region, district,
         address, passport_number, gender, benefit_category, department, order_number, medical_record_number, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [id, tenantId, b.first_name, b.last_name || '', b.middle_name || '', b.phone || '', b.birth_date || null,
         b.region || '', b.district || '', b.address || '', b.passport_number || '', b.gender || '',
         b.benefit_category || '', b.department || '', b.order_number || '', b.medical_record_number || '', b.notes || '']
      );
      const patient = await qGet(`SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1`, [id]);
      res.status(201).json({ success: true, patient });
    } catch (e) { safeError(res, e); }
  });

  // PUT /:id — bemor ma'lumotini yangilash
  router.put('/:id', authMiddleware, validate(patientSchema), async (req, res) => {
    try {
      const { id } = req.params;
      const b = req.body;
      const tenantId = tenantOf(req);
      const existing = await qGet('SELECT id FROM patients WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
      if (!existing) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      await q(
        `UPDATE patients SET first_name=$1, last_name=$2, middle_name=$3, phone=$4, birth_date=$5, region=$6,
         district=$7, address=$8, passport_number=$9, gender=$10, benefit_category=$11, department=$12,
         order_number=$13, medical_record_number=$14, notes=$15 WHERE id=$16 AND tenant_id=$17`,
        [b.first_name, b.last_name || '', b.middle_name || '', b.phone || '', b.birth_date || null, b.region || '',
         b.district || '', b.address || '', b.passport_number || '', b.gender || '', b.benefit_category || '',
         b.department || '', b.order_number || '', b.medical_record_number || '', b.notes || '', id, tenantId]
      );
      const patient = await qGet(`SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1`, [id]);
      res.json({ success: true, patient });
    } catch (e) { safeError(res, e); }
  });

  // DELETE /:id — bemorni o'chirish (faqat admin/ceo)
  router.delete('/:id', authMiddleware, async (req, res) => {
    try {
      if (!['admin', 'ceo', 'superadmin'].includes(req.user?.role)) {
        return res.status(403).json({ success: false, error: 'Bemorni faqat ma\'mur o\'chira oladi' });
      }
      const tenantId = tenantOf(req);
      const existing = await qGet('SELECT id FROM patients WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
      if (!existing) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      await q('DELETE FROM patients WHERE id = $1 AND tenant_id = $2', [req.params.id, tenantId]);
      res.json({ success: true, message: 'Bemor o\'chirildi' });
    } catch (e) { safeError(res, e); }
  });

  // GET /:id — bitta bemor
  router.get('/:id', authMiddleware, async (req, res) => {
    try {
      const patient = await qGet(
        `SELECT ${PATIENT_COLUMNS} FROM patients WHERE id = $1 AND tenant_id = $2`,
        [req.params.id, tenantOf(req)]
      );
      if (!patient) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      res.json({ success: true, patient });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
