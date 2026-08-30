// ============================================================
// Falcon AI OS — HRMS API: xodim reestri + Frappe HRMS sync
// (roadmap PR #9)
//
// Ichki qism (Frappe'siz ham ishlaydi):
//   - staff_members CRUD (smena/davomat shu nomlar bilan ishlaydi)
//   - GET /summary — oylik davomat agregati (rahbar hisoboti)
//
// Tashqi qism (gate: FRAPPE_URL bo'sh = o'chiq):
//   - POST /sync/employee/:id — xodim -> Frappe Employee
//   - POST /sync/attendance?date= — kunlik natijalar -> Frappe
//     Attendance (idempotent: avval qidiradi, keyin create/update)
//
// Qoida: kechikish/erta ketish — remarks'dagi DALIL, Frappe
// statusi faqat Present/Absent (kamera = jazo emas).
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { q, qGet } from '../db.js';
import { authMiddleware, validate } from '../shared.js';
import { requirePermission } from '../rbac.js';
import { buildDailyReport } from '../services/worker-control.js';
import {
  isFrappeEnabled,
  toFrappeEmployee,
  toFrappeAttendance,
  createFrappeDoc,
  updateFrappeDoc,
  findFrappeDoc,
} from '../services/frappe-client.js';
import { serverFail } from '../services/safe-error.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FRAPPE_COMPANY = process.env.FRAPPE_COMPANY || '';
const MAX_SUMMARY_DAYS = 62;

const staffSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  role: z.string().trim().min(2).max(50).default('staff'),
  position: z.string().trim().max(80).optional(),
  phone: z.string().trim().max(30).optional(),
  doctor_id: z.string().uuid().optional(),
});

const staffUpdateSchema = staffSchema.partial().extend({
  is_active: z.boolean().optional(),
});

// Kunlik davomat hisoboti uchun uch manba (worker-control route bilan bir xil)
async function loadDailySources(tenantId, date) {
  const shifts = await q(
    `SELECT staff_name, doctor_id, shift_date, start_time, end_time, grace_minutes
       FROM staff_shifts WHERE tenant_id = $1 AND shift_date = $2 ORDER BY start_time`,
    [tenantId, date]
  );
  const attendance = await q(
    `SELECT person_name, direction, occurred_at, confidence
       FROM attendance_events
      WHERE tenant_id = $1
        AND occurred_at >= $2::timestamp - interval '2 hours'
        AND occurred_at <  $2::timestamp + interval '30 hours'`,
    [tenantId, date]
  );
  const vision = await q(
    `SELECT subject_ref, occurred_at FROM vision_events
      WHERE tenant_id = $1 AND subject_ref LIKE 'staff:%'
        AND occurred_at >= $2::timestamp - interval '2 hours'
        AND occurred_at <  $2::timestamp + interval '30 hours'`,
    [tenantId, date]
  );
  return { shifts, attendance, vision };
}

function guardDisabled(res) {
  if (isFrappeEnabled()) return false;
  res.status(503).json({
    success: false,
    code: 'FRAPPE_DISABLED',
    error: "FRAPPE_URL sozlanmagan — HRMS integratsiyasi o'chirilgan",
  });
  return true;
}

export default function hrmsRoutes() {
  const router = Router();

  // GET /api/hrms/status — integratsiya holati
  router.get('/status', authMiddleware, requirePermission('staff.read'), async (req, res) => {
    try {
      const stat = await qGet(
        `SELECT COUNT(*)::int AS total,
                COUNT(frappe_employee_name)::int AS synced
           FROM staff_members WHERE tenant_id = $1`,
        [req.user.tenant_id]
      );
      res.json({ success: true, enabled: isFrappeEnabled(), staff: stat?.total || 0, synced: stat?.synced || 0 });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Holatni olib bo\'lmadi', details: e.message });
    }
  });

  // ─── Xodim reestri ──────────────────────────────────────────────
  // GET /api/hrms/staff?active=true
  router.get('/staff', authMiddleware, requirePermission('staff.read'), async (req, res) => {
    try {
      let sql = `SELECT id, full_name, role, position, phone, doctor_id, is_active,
                        frappe_employee_name, telegram_id IS NOT NULL AS has_telegram
                   FROM staff_members WHERE tenant_id = $1`;
      const params = [req.user.tenant_id];
      if (req.query.active === 'true' || req.query.active === 'false') {
        sql += ' AND is_active = $2';
        params.push(req.query.active === 'true');
      }
      const rows = await q(`${sql} ORDER BY full_name`, params);
      res.json({ success: true, total: rows.length, staff: rows });
    } catch (e) {
      serverFail(res, e, "Ro'yxatni olib bo'lmadi", 500);
    }
  });

  // POST /api/hrms/staff — yangi xodim
  router.post('/staff', authMiddleware, requirePermission('staff.manage'), validate(staffSchema), async (req, res) => {
    try {
      const b = req.body;
      const row = await qGet(
        `INSERT INTO staff_members (tenant_id, full_name, role, position, phone, doctor_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, full_name, role, position, phone, doctor_id, is_active`,
        [req.user.tenant_id, b.full_name, b.role, b.position || null, b.phone || null, b.doctor_id || null]
      );
      res.status(201).json({ success: true, staff: row });
    } catch (e) {
      if (e.code === '23505') {
        res.status(409).json({ success: false, error: 'Bu ismli xodim allaqachon bor' });
        return;
      }
      res.status(500).json({ success: false, error: 'Xodim qo\'shilmadi', details: e.message });
    }
  });

  // PUT /api/hrms/staff/:id — ma'lumotlarini yangilash
  router.put('/staff/:id', authMiddleware, requirePermission('staff.manage'), validate(staffUpdateSchema), async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ success: false, error: 'id butun son bo\'lishi shart' });
        return;
      }
      const fields = [];
      const values = [req.user.tenant_id, id];
      for (const [key, col] of [['full_name', 'full_name'], ['role', 'role'], ['position', 'position'],
        ['phone', 'phone'], ['doctor_id', 'doctor_id'], ['is_active', 'is_active']]) {
        if (req.body[key] !== undefined) {
          values.push(req.body[key]);
          fields.push(`${col} = $${values.length}`);
        }
      }
      if (!fields.length) {
        res.status(400).json({ success: false, error: 'Yangilanadigan maydon yuborilmadi' });
        return;
      }
      fields.push(`updated_at = now()`);
      const row = await qGet(
        `UPDATE staff_members SET ${fields.join(', ')}
          WHERE tenant_id = $1 AND id = $2
          RETURNING id, full_name, role, position, phone, doctor_id, is_active, frappe_employee_name`,
        values
      );
      if (!row) {
        res.status(404).json({ success: false, error: 'Xodim topilmadi' });
        return;
      }
      res.json({ success: true, staff: row });
    } catch (e) {
      if (e.code === '23505') {
        res.status(409).json({ success: false, error: 'Bu ismli xodim allaqachon bor' });
        return;
      }
      serverFail(res, e, 'Yangilanmadi', 500);
    }
  });

  // ─── Frappe sinhronizatsiya ─────────────────────────────────────
  // POST /api/hrms/sync/employee/:id — xodimni Frappe'ga yuborish
  router.post('/sync/employee/:id', authMiddleware, requirePermission('staff.manage'), async (req, res) => {
    if (guardDisabled(res)) return;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ success: false, error: 'id butun son bo\'lishi shart' });
      return;
    }
    try {
      const staff = await qGet(
        'SELECT * FROM staff_members WHERE tenant_id = $1 AND id = $2',
        [req.user.tenant_id, id]
      );
      if (!staff) {
        res.status(404).json({ success: false, error: 'Xodim topilmadi' });
        return;
      }
      const doc = { ...toFrappeEmployee(staff), ...(FRAPPE_COMPANY ? { company: FRAPPE_COMPANY } : {}) };
      const name = staff.frappe_employee_name
        ? await updateFrappeDoc('Employee', staff.frappe_employee_name, doc)
        : await createFrappeDoc('Employee', doc);
      if (!name) {
        res.status(502).json({ success: false, code: 'FRAPPE_ERROR', error: "Frappe'ga ulanib bo'lmadi" });
        return;
      }
      await q(
        'UPDATE staff_members SET frappe_employee_name = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2',
        [req.user.tenant_id, id, name]
      );
      res.json({ success: true, synced: true, frappe_employee_name: name });
    } catch (e) {
      serverFail(res, e, 'Sinhronizatsiya xatosi', 500);
    }
  });

  // POST /api/hrms/sync/attendance?date=YYYY-MM-DD — kunlik natijalar
  // Idempotent: Frappe'da bor Attendance topilsa UPDATE, bo'lmasa CREATE.
  router.post('/sync/attendance', authMiddleware, requirePermission('staff.manage'), async (req, res) => {
    if (guardDisabled(res)) return;
    const date = String(req.query.date || '');
    if (!DATE_RE.test(date)) {
      res.status(400).json({ success: false, error: "date parametri 'YYYY-MM-DD' formatda bo'lishi shart" });
      return;
    }
    try {
      const { shifts, attendance, vision } = await loadDailySources(req.user.tenant_id, date);
      const { rows } = buildDailyReport(shifts, attendance, vision);

      // staff_name -> Frappe Employee doc name
      const staffRows = await q(
        'SELECT full_name, frappe_employee_name FROM staff_members WHERE tenant_id = $1 AND frappe_employee_name IS NOT NULL',
        [req.user.tenant_id]
      );
      const nameMap = new Map(staffRows.map((s) => [s.full_name, s.frappe_employee_name]));

      const result = { created: 0, updated: 0, skipped: 0, failed: 0 };
      for (const row of rows) {
        const employeeName = nameMap.get(row.staff_name);
        const doc = toFrappeAttendance({
          employeeName,
          date,
          status: row.status,
          lateMinutes: row.late_minutes,
          earlyLeaveMinutes: row.early_leave_minutes,
        });
        if (!doc) { result.skipped += 1; continue; }

        const existing = await findFrappeDoc('Attendance', [
          ['employee', '=', employeeName],
          ['attendance_date', '=', date],
        ]);
        const name = existing
          ? await updateFrappeDoc('Attendance', existing.name, doc)
          : await createFrappeDoc('Attendance', doc);
        if (!name) { result.failed += 1; continue; }
        result[existing ? 'updated' : 'created'] += 1;
      }
      res.json({ success: true, date, ...result });
    } catch (e) {
      serverFail(res, e, 'Sinhronizatsiya xatosi', 500);
    }
  });

  // ─── Oylik summary (Frappe'siz ham ishlaydi) ────────────────────
  // GET /api/hrms/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
  router.get('/summary', authMiddleware, requirePermission('staff.read'), async (req, res) => {
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      res.status(400).json({ success: false, error: "from/to 'YYYY-MM-DD' va from <= to bo'lishi shart" });
      return;
    }
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    if (days > MAX_SUMMARY_DAYS) {
      res.status(400).json({ success: false, error: `Oraliq ${MAX_SUMMARY_DAYS} kundan oshmasin` });
      return;
    }
    try {
      const agg = new Map();
      for (let i = 0; i < days; i += 1) {
        const d = new Date(`${from}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        const date = d.toISOString().slice(0, 10);
        const { shifts, attendance, vision } = await loadDailySources(req.user.tenant_id, date);
        const { rows } = buildDailyReport(shifts, attendance, vision);
        for (const row of rows) {
          const slot = agg.get(row.staff_name)
            || { staff_name: row.staff_name, shifts: 0, present: 0, late: 0, early_leave: 0, absent: 0 };
          slot.shifts += 1;
          slot[row.status] = (slot[row.status] || 0) + 1;
          agg.set(row.staff_name, slot);
        }
      }
      res.json({ success: true, from, to, days, total: agg.size, summary: [...agg.values()] });
    } catch (e) {
      res.status(500).json({ success: false, error: 'Hisobotni olib bo\'lmadi', details: e.message });
    }
  });

  return router;
}
