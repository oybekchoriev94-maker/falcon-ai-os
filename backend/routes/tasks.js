// ============================================================
// Falcon AI OS — Xodim vazifalari API
//
// Rahbar vazifa belgilaydi (staff.manage), xodim bajarib
// belgilaydi (tasks.write). Kechikish — hisobotdagi DALIL,
// avtomatik jazo yo'q (roadmap qoidasi).
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { q, qGet } from '../db.js';
import { authMiddleware, validate } from '../shared.js';
import { requirePermission } from '../rbac.js';
import { canTransition, isOverdue, summarizeTasks } from '../services/task-service.js';
import { serverFail } from '../services/safe-error.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const createSchema = z.object({
  staff_member_id: z.number().int().positive(),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(2000).optional(),
  due_at: z.string().datetime({ offset: true }).optional(),
});

const updateSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  due_at: z.string().datetime({ offset: true }).nullable().optional(),
});

const statusSchema = z.object({
  status: z.enum(['in_progress', 'done']),
  result_note: z.string().trim().max(2000).optional(),
});

export default function taskRoutes() {
  const router = Router();

  // GET /api/tasks?status=&staff_member_id=&overdue=true
  router.get('/', authMiddleware, requirePermission('tasks.read'), async (req, res) => {
    try {
      let sql = `SELECT id, staff_member_id, staff_name, title, description,
                        assigned_by, due_at, status, done_at, result_note,
                        created_at, updated_at
                   FROM staff_tasks WHERE tenant_id = $1`;
      const params = [req.user.tenant_id];
      if (req.query.status && ['pending', 'in_progress', 'done'].includes(req.query.status)) {
        sql += ` AND status = $${params.length + 1}`;
        params.push(req.query.status);
      }
      if (req.query.staff_member_id) {
        const sid = Number(req.query.staff_member_id);
        if (!Number.isInteger(sid)) {
          res.status(400).json({ success: false, error: 'staff_member_id butun son bo\'lishi shart' });
          return;
        }
        sql += ` AND staff_member_id = $${params.length + 1}`;
        params.push(sid);
      }
      sql += ' ORDER BY created_at DESC LIMIT 200';
      const rows = await q(sql, params);
      const now = new Date();
      const tasks = rows.map((t) => ({ ...t, overdue: isOverdue(t, now) }));
      const filtered = req.query.overdue === 'true' ? tasks.filter((t) => t.overdue) : tasks;
      res.json({ success: true, total: filtered.length, tasks: filtered });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Vazifalarni olib bo\'lmadi', details: e.message });
    }
  });

  // GET /api/tasks/summary — direktor dashboard agregati
  router.get('/summary', authMiddleware, requirePermission('tasks.read'), async (req, res) => {
    try {
      const rows = await q(
        `SELECT staff_member_id, staff_name, status, due_at FROM staff_tasks WHERE tenant_id = $1`,
        [req.user.tenant_id]
      );
      res.json({ success: true, ...summarizeTasks(rows) });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Hisobotni olib bo\'lmadi', details: e.message });
    }
  });

  // POST /api/tasks — vazifa belgilash (faqat rahbar)
  router.post('/', authMiddleware, requirePermission('staff.manage'), validate(createSchema), async (req, res) => {
    try {
      const staff = await qGet(
        'SELECT id, full_name FROM staff_members WHERE tenant_id = $1 AND id = $2',
        [req.user.tenant_id, req.body.staff_member_id]
      );
      if (!staff) {
        res.status(404).json({ success: false, error: 'Xodim topilmadi' });
        return;
      }
      const row = await qGet(
        `INSERT INTO staff_tasks (tenant_id, staff_member_id, staff_name, title, description, assigned_by, due_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [req.user.tenant_id, staff.id, staff.full_name, req.body.title,
          req.body.description || null, req.user.id || null, req.body.due_at || null]
      );
      res.status(201).json({ success: true, task: row });
    } catch (e) {
      serverFail(res, e, 'Vazifa yaratilmadi', 500);
    }
  });

  // PUT /api/tasks/:id — tahrirlash (faqat rahbar)
  router.put('/:id', authMiddleware, requirePermission('staff.manage'), validate(updateSchema), async (req, res) => {
    try {
      if (!UUID_RE.test(String(req.params.id))) {
        res.status(400).json({ success: false, error: 'id UUID formatda bo\'lishi shart' });
        return;
      }
      const fields = [];
      const values = [req.user.tenant_id, req.params.id];
      for (const key of ['title', 'description', 'due_at']) {
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
        `UPDATE staff_tasks SET ${fields.join(', ')}
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        values
      );
      if (!row) {
        res.status(404).json({ success: false, error: 'Vazifa topilmadi' });
        return;
      }
      res.json({ success: true, task: row });
    } catch (e) {
      serverFail(res, e, 'Yangilanmadi', 500);
    }
  });

  // PATCH /api/tasks/:id/status — status o'tishi (xodim o'z vazifasini bajaradi)
  router.patch('/:id/status', authMiddleware, requirePermission('tasks.write'), validate(statusSchema), async (req, res) => {
    try {
      if (!UUID_RE.test(String(req.params.id))) {
        res.status(400).json({ success: false, error: 'id UUID formatda bo\'lishi shart' });
        return;
      }
      const task = await qGet(
        'SELECT * FROM staff_tasks WHERE tenant_id = $1 AND id = $2',
        [req.user.tenant_id, req.params.id]
      );
      if (!task) {
        res.status(404).json({ success: false, error: 'Vazifa topilmadi' });
        return;
      }
      if (!canTransition(task.status, req.body.status)) {
        res.status(409).json({
          success: false,
          error: `'${task.status}' holatidan '${req.body.status}'ga o'tib bo'lmaydi`,
        });
        return;
      }
      const done = req.body.status === 'done';
      const row = await qGet(
        `UPDATE staff_tasks
            SET status = $3,
                done_at = ${done ? 'now()' : 'done_at'},
                result_note = COALESCE($4, result_note),
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2 RETURNING *`,
        [req.user.tenant_id, req.params.id, req.body.status, req.body.result_note || null]
      );
      res.json({ success: true, task: row });
    } catch (e) {
      serverFail(res, e, 'Status yangilanmadi', 500);
    }
  });

  // DELETE /api/tasks/:id — o'chirish (faqat rahbar)
  router.delete('/:id', authMiddleware, requirePermission('staff.manage'), async (req, res) => {
    try {
      if (!UUID_RE.test(String(req.params.id))) {
        res.status(400).json({ success: false, error: 'id UUID formatda bo\'lishi shart' });
        return;
      }
      const row = await qGet(
        'DELETE FROM staff_tasks WHERE tenant_id = $1 AND id = $2 RETURNING id',
        [req.user.tenant_id, req.params.id]
      );
      if (!row) {
        res.status(404).json({ success: false, error: 'Vazifa topilmadi' });
        return;
      }
      res.json({ success: true, deleted: true });
    } catch (e) {
      res.status(500).json({ success: false, error: 'O\'chirilmadi', details: e.message });
    }
  });

  return router;
}
