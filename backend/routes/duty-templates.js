// ============================================================
// Falcon AI OS — Lavozim bo'yicha doimiy vazifa shablonlari
//
// Masalan "hamshira" lavozimiga 5 ta standart vazifa biriktiriladi;
// har kuni backend/cron/duty-tasks.js shu shablonlar asosida
// staff_tasks yaratadi (idempotent).
//
// position — staff_members.position bilan HARFMA-HARF mos kelishi
// kerak (qat'iy tashqi kalit emas, matn taqqoslash). UI shuni
// ochiq ogohlantiradi.
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { q, qGet } from '../db.js';
import { authMiddleware, validate } from '../shared.js';
import { requirePermission } from '../rbac.js';
import { serverFail } from '../services/safe-error.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const templateSchema = z.object({
  position: z.string().trim().min(2).max(80),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
});

const templateUpdateSchema = templateSchema.partial().extend({
  is_active: z.boolean().optional(),
});

export default function dutyTemplateRoutes() {
  const router = Router();

  // GET /api/v1/duty-templates/positions — staff_members'dagi mavjud lavozimlar
  // (aniq /:id bilan chalkashmasligi uchun /positions ustida turishi shart)
  router.get('/positions', authMiddleware, requirePermission('staff.read'), async (req, res) => {
    try {
      const rows = await q(
        `SELECT DISTINCT position FROM staff_members
          WHERE tenant_id = $1 AND position IS NOT NULL AND position <> ''
          ORDER BY position`,
        [req.user.tenant_id]
      );
      res.json({ success: true, positions: rows.map((r) => r.position) });
    } catch (e) {
      serverFail(res, e, "Lavozimlar ro'yxatini olib bo'lmadi");
    }
  });

  // GET /api/v1/duty-templates?position=
  router.get('/', authMiddleware, requirePermission('staff.read'), async (req, res) => {
    try {
      let sql = `SELECT id, position, title, description, sort_order, is_active, created_at
                   FROM duty_templates WHERE tenant_id = $1`;
      const params = [req.user.tenant_id];
      if (req.query.position) {
        sql += ` AND position = $${params.length + 1}`;
        params.push(String(req.query.position));
      }
      sql += ' ORDER BY position, sort_order, title';
      const rows = await q(sql, params);
      res.json({ success: true, total: rows.length, templates: rows });
    } catch (e) {
      serverFail(res, e, "Ro'yxatni olib bo'lmadi");
    }
  });

  // POST /api/v1/duty-templates — yangi doimiy vazifa
  router.post('/', authMiddleware, requirePermission('staff.manage'), validate(templateSchema), async (req, res) => {
    try {
      const b = req.body;
      const row = await qGet(
        `INSERT INTO duty_templates (tenant_id, position, title, description, sort_order)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, position, title, description, sort_order, is_active`,
        [req.user.tenant_id, b.position, b.title, b.description || null, b.sort_order ?? 0]
      );
      res.status(201).json({ success: true, template: row });
    } catch (e) {
      serverFail(res, e, 'Vazifa shabloni qo\'shilmadi');
    }
  });

  // PUT /api/v1/duty-templates/:id
  router.put('/:id', authMiddleware, requirePermission('staff.manage'), validate(templateUpdateSchema), async (req, res) => {
    if (!UUID_RE.test(String(req.params.id))) {
      res.status(400).json({ success: false, error: 'id UUID formatda bo\'lishi shart' });
      return;
    }
    try {
      const fields = [];
      const values = [req.user.tenant_id, req.params.id];
      for (const key of ['position', 'title', 'description', 'sort_order', 'is_active']) {
        if (req.body[key] !== undefined) {
          values.push(req.body[key]);
          fields.push(`${key} = $${values.length}`);
        }
      }
      if (!fields.length) {
        res.status(400).json({ success: false, error: 'Yangilanadigan maydon yuborilmadi' });
        return;
      }
      fields.push('updated_at = now()');
      const row = await qGet(
        `UPDATE duty_templates SET ${fields.join(', ')}
          WHERE tenant_id = $1 AND id = $2
          RETURNING id, position, title, description, sort_order, is_active`,
        values
      );
      if (!row) {
        res.status(404).json({ success: false, error: 'Shablon topilmadi' });
        return;
      }
      res.json({ success: true, template: row });
    } catch (e) {
      serverFail(res, e, 'Yangilanmadi', 500);
    }
  });

  // DELETE /api/v1/duty-templates/:id
  router.delete('/:id', authMiddleware, requirePermission('staff.manage'), async (req, res) => {
    if (!UUID_RE.test(String(req.params.id))) {
      res.status(400).json({ success: false, error: 'id UUID formatda bo\'lishi shart' });
      return;
    }
    try {
      const row = await qGet(
        'DELETE FROM duty_templates WHERE tenant_id = $1 AND id = $2 RETURNING id',
        [req.user.tenant_id, req.params.id]
      );
      if (!row) {
        res.status(404).json({ success: false, error: 'Shablon topilmadi' });
        return;
      }
      res.json({ success: true, deleted: true });
    } catch (e) {
      serverFail(res, e, "O'chirilmadi");
    }
  });

  return router;
}
