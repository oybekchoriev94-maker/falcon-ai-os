// ============================================================
// Falcon AI OS — Klinika va filial tuzilmasi (roadmap PR #4)
//
// tenant -> clinics -> branches. Hozircha barcha yozuvlar NULL branch_id
// bilan "bosh filial"ga tegishli hisoblanadi; filial tanlash keyingi
// PR'larda UI va agentlarga kirib boradi.
// ============================================================
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { q, qGet } from '../db.js';
import { authMiddleware, validate } from '../shared.js';
import { requirePermission } from '../rbac.js';
import { serverFail } from '../services/safe-error.js';

const CODE_RE = /^[a-z0-9][a-z0-9_-]{1,49}$/;

const clinicSchema = z.object({
  name: z.string().trim().min(2).max(255),
  code: z.string().regex(CODE_RE, "code: kichik harf/raqam, 2-50 belgi, '-','_' mumkin"),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
  region: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
});

const clinicUpdateSchema = clinicSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

const branchSchema = z.object({
  name: z.string().trim().min(2).max(255),
  code: z.string().regex(CODE_RE, "code: kichik harf/raqam, 2-50 belgi, '-','_' mumkin"),
  phone: z.string().max(50).optional(),
  address: z.string().max(500).optional(),
});

const branchUpdateSchema = branchSchema.partial().extend({
  status: z.enum(['active', 'inactive']).optional(),
});

export default function clinicRoutes() {
  const router = Router();

  // GET /api/clinics — tenant klinikalari, filiallari bilan
  router.get('/', authMiddleware, requirePermission('patients.read'), async (req, res) => {
    try {
      const clinics = await q(
        `SELECT id, name, code, phone, address, region, city, status, created_at
         FROM clinics WHERE tenant_id = $1 ORDER BY created_at`,
        [req.user.tenant_id]
      );
      const branches = await q(
        `SELECT id, clinic_id, name, code, phone, address, status, created_at
         FROM branches WHERE tenant_id = $1 ORDER BY created_at`,
        [req.user.tenant_id]
      );
      const byClinic = new Map(clinics.map((c) => [c.id, { ...c, branches: [] }]));
      for (const b of branches) {
        byClinic.get(b.clinic_id)?.branches.push(b);
      }
      res.json({ success: true, clinics: [...byClinic.values()] });
    } catch (e) {
      serverFail(res, e, 'Klinikalarni o\'qib bo\'lmadi');
    }
  });

  // POST /api/clinics — yangi klinika (faqat ceo/admin)
  router.post('/', authMiddleware, requirePermission('structure.manage'), validate(clinicSchema), async (req, res) => {
    try {
      const { name, code, phone, address, region, city } = req.body;
      const dup = await qGet(
        'SELECT id FROM clinics WHERE tenant_id = $1 AND code = $2',
        [req.user.tenant_id, code]
      );
      if (dup) return res.status(409).json({ error: `Bu code bilan klinika mavjud: ${code}` });

      const id = uuidv4();
      await q(
        `INSERT INTO clinics (id, tenant_id, name, code, phone, address, region, city)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, req.user.tenant_id, name, code, phone || null, address || null, region || null, city || null]
      );
      res.status(201).json({ success: true, clinic: { id, name, code } });
    } catch (e) {
      serverFail(res, e, 'Klinika yaratib bo\'lmadi');
    }
  });

  // PUT /api/clinics/:id — yangilash
  router.put('/:id', authMiddleware, requirePermission('structure.manage'), validate(clinicUpdateSchema), async (req, res) => {
    try {
      const fields = Object.entries(req.body);
      if (fields.length === 0) return res.status(400).json({ error: 'O\'zgartiriladigan maydon yo\'q' });
      const sets = fields.map(([k], i) => `${k} = $${i + 1}`).join(', ');
      const params = fields.map(([, v]) => v);
      const updated = await qGet(
        `UPDATE clinics SET ${sets}, updated_at = NOW()
         WHERE id = $${params.length + 1} AND tenant_id = $${params.length + 2}
         RETURNING id, name, code, phone, address, region, city, status`,
        [...params, req.params.id, req.user.tenant_id]
      );
      if (!updated) return res.status(404).json({ error: 'Klinika topilmadi' });
      res.json({ success: true, clinic: updated });
    } catch (e) {
      serverFail(res, e, 'Klinikani yangilab bo\'lmadi');
    }
  });

  // POST /api/clinics/:id/branches — filial qo'shish
  router.post('/:id/branches', authMiddleware, requirePermission('structure.manage'), validate(branchSchema), async (req, res) => {
    try {
      const clinic = await qGet(
        'SELECT id FROM clinics WHERE id = $1 AND tenant_id = $2',
        [req.params.id, req.user.tenant_id]
      );
      if (!clinic) return res.status(404).json({ error: 'Klinika topilmadi' });

      const { name, code, phone, address } = req.body;
      const dup = await qGet(
        'SELECT id FROM branches WHERE tenant_id = $1 AND clinic_id = $2 AND code = $3',
        [req.user.tenant_id, clinic.id, code]
      );
      if (dup) return res.status(409).json({ error: `Bu code bilan filial mavjud: ${code}` });

      const id = uuidv4();
      await q(
        `INSERT INTO branches (id, tenant_id, clinic_id, name, code, phone, address)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, req.user.tenant_id, clinic.id, name, code, phone || null, address || null]
      );
      res.status(201).json({ success: true, branch: { id, clinic_id: clinic.id, name, code } });
    } catch (e) {
      serverFail(res, e, 'Filial yaratib bo\'lmadi');
    }
  });

  // PUT /api/branches/:id — filialni yangilash
  router.put('/branches/:id', authMiddleware, requirePermission('structure.manage'), validate(branchUpdateSchema), async (req, res) => {
    try {
      const fields = Object.entries(req.body);
      if (fields.length === 0) return res.status(400).json({ error: 'O\'zgartiriladigan maydon yo\'q' });
      const sets = fields.map(([k], i) => `${k} = $${i + 1}`).join(', ');
      const params = fields.map(([, v]) => v);
      const updated = await qGet(
        `UPDATE branches SET ${sets}, updated_at = NOW()
         WHERE id = $${params.length + 1} AND tenant_id = $${params.length + 2}
         RETURNING id, clinic_id, name, code, phone, address, status`,
        [...params, req.params.id, req.user.tenant_id]
      );
      if (!updated) return res.status(404).json({ error: 'Filial topilmadi' });
      res.json({ success: true, branch: updated });
    } catch (e) {
      serverFail(res, e, 'Filialni yangilab bo\'lmadi');
    }
  });

  return router;
}
