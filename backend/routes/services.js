/**
 * Xizmatlar katalogi CRUD (klinika admin/ceo tomonidan boshqariladi).
 *
 * Tenant izolyatsiyasi: barcha query'lar tenant_id bilan filtrlanadi. Bu shu klinika
 * o'ziga ko'rinadigan/boshqaradigan xizmatlarni yuritadi (services_catalog per-tenant).
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const serviceSchema = z.object({
  name: z.string().trim().min(1).max(255),
  category: z.string().trim().max(100).optional().nullable(),
  specialty: z.string().trim().max(50).optional().nullable(),
  // Ikonka: uzunligini cheklaymiz, aniq emoji tekshiruvi Unicode DB'ga bog'liq
  // bo'lganligi uchun (masalan 🩺 U+1FA7A hamma versiyalarda \p{Emoji} ga tushmaydi)
  // ishonchli oddiy chegara — 8 belgi (2-3 emoji ZWJ bilan sig'adi).
  icon: z.string().trim().max(8).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  price: z.coerce.number().min(0).max(1_000_000_000),
  duration_min: z.coerce.number().int().min(1).max(24 * 60).optional().nullable(),
  active: z.coerce.boolean().optional(),
});

export default function servicesRoutes(pool, authMiddleware, checkRole, serverError) {
  const router = Router();

  async function q(sql, params = []) {
    const r = await pool.query(sql, params);
    return /^SELECT/i.test(sql.trim()) ? r.rows : r;
  }
  async function qGet(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  }
  const tid = (req) => req.user?.tenant_id || req.tenant_id;

  // GET / — ro'yxat. `active_only=true` bo'lsa faqat faol xizmatlar (reception/kassa uchun).
  router.get('/', authMiddleware, async (req, res) => {
    try {
      const tenantId = tid(req);
      const activeOnly = String(req.query.active_only || '') === 'true';
      const specialty = req.query.specialty ? String(req.query.specialty).trim().toLowerCase() : null;
      const params = [tenantId];
      let where = 'tenant_id = $1';
      if (activeOnly) where += ' AND active = TRUE';
      if (specialty) { params.push(specialty); where += ` AND specialty = $${params.length}`; }
      const rows = await q(
        `SELECT id, name, category, specialty, icon, description, price::float8 AS price,
                duration_min, active, created_at, updated_at
         FROM services_catalog WHERE ${where} ORDER BY category NULLS LAST, name`,
        params
      );
      res.json({ success: true, total: rows.length, services: rows });
    } catch (e) { serverError(res, e); }
  });

  router.get('/:id', authMiddleware, async (req, res) => {
    try {
      const row = await qGet(
        `SELECT id, name, category, specialty, icon, description, price::float8 AS price,
                duration_min, active, created_at, updated_at
         FROM services_catalog WHERE tenant_id = $1 AND id = $2`,
        [tid(req), req.params.id]
      );
      if (!row) return res.status(404).json({ success: false, error: 'Xizmat topilmadi' });
      res.json({ success: true, service: row });
    } catch (e) { serverError(res, e); }
  });

  // POST / — yangi xizmat. Faqat admin/ceo.
  router.post('/', authMiddleware, checkRole('admin', 'ceo', 'superadmin'), async (req, res) => {
    try {
      const parsed = serviceSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Noto\'g\'ri ma\'lumot', details: parsed.error.flatten() });
      }
      const d = parsed.data;
      const id = uuidv4();
      const row = await qGet(
        `INSERT INTO services_catalog
           (id, tenant_id, name, category, specialty, icon, description, price, duration_min, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10, TRUE))
         RETURNING id, name, category, specialty, icon, description, price::float8 AS price,
                   duration_min, active, created_at, updated_at`,
        [id, tid(req), d.name, d.category || null, d.specialty || null, d.icon || null,
         d.description || null, d.price, d.duration_min ?? 15, d.active]
      );
      res.status(201).json({ success: true, service: row });
    } catch (e) { serverError(res, e); }
  });

  // PUT /:id — yangilash (qisman ham qabul qilinadi)
  router.put('/:id', authMiddleware, checkRole('admin', 'ceo', 'superadmin'), async (req, res) => {
    try {
      const parsed = serviceSchema.partial().safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: 'Noto\'g\'ri ma\'lumot', details: parsed.error.flatten() });
      }
      const d = parsed.data;
      const sets = [];
      const params = [];
      for (const [col, val] of Object.entries(d)) {
        if (val === undefined) continue;
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      }
      if (!sets.length) return res.status(400).json({ success: false, error: 'O\'zgartirish uchun maydon berilmagan' });
      sets.push('updated_at = NOW()');
      params.push(tid(req), req.params.id);
      const row = await qGet(
        `UPDATE services_catalog SET ${sets.join(', ')}
         WHERE tenant_id = $${params.length - 1} AND id = $${params.length}
         RETURNING id, name, category, specialty, icon, description, price::float8 AS price,
                   duration_min, active, created_at, updated_at`,
        params
      );
      if (!row) return res.status(404).json({ success: false, error: 'Xizmat topilmadi' });
      res.json({ success: true, service: row });
    } catch (e) { serverError(res, e); }
  });

  // DELETE /:id — soft delete (active=false). Haqiqiy o'chirish emas — chunki xizmat
  // eski appointments/payments'da referens qilinishi mumkin.
  router.delete('/:id', authMiddleware, checkRole('admin', 'ceo', 'superadmin'), async (req, res) => {
    try {
      const row = await qGet(
        `UPDATE services_catalog SET active = FALSE, updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tid(req), req.params.id]
      );
      if (!row) return res.status(404).json({ success: false, error: 'Xizmat topilmadi' });
      res.json({ success: true, deactivated: row.id });
    } catch (e) { serverError(res, e); }
  });

  return router;
}
