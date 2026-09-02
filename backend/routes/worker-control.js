// ============================================================
// Falcon AI OS — Xodim nazorati API (kamera + Face ID + smena)
//
// Roadmap modullari 4/5. Qoida: kamera = DALIL, jazo emas.
// Hisobotlar rahbarga ko'rsatiladi, qaror odamda.
//
// Manbalar: attendance_events (Face ID), vision_events (Edge),
// staff_shifts (kutilayotgan jadval), vision_zone_rules (zonalar).
// ============================================================
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { q, qGet } from '../db.js';
import { authMiddleware, validate } from '../shared.js';
import { requirePermission } from '../rbac.js';
import { serverFail } from '../services/safe-error.js';
import {
  buildDailyReport, buildZonePresence, detectPresenceAlerts,
  detectZoneAlerts, staffSubjectRef,
} from '../services/worker-control.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const shiftSchema = z.object({
  staff_name: z.string().trim().min(2).max(120),
  doctor_id: z.string().uuid().optional(),
  shift_date: z.string().regex(DATE_RE, "shift_date: 'YYYY-MM-DD'"),
  start_time: z.string().regex(TIME_RE, "start_time: 'HH:MM'"),
  end_time: z.string().regex(TIME_RE, "end_time: 'HH:MM'"),
  grace_minutes: z.number().int().min(0).max(120).default(15),
});

const zoneRuleSchema = z.object({
  zone_id: z.string().trim().min(3).max(64),
  rule_type: z.enum(['after_hours', 'restricted', 'presence_required']),
  allowed_start: z.string().regex(TIME_RE).optional(),
  allowed_end: z.string().regex(TIME_RE).optional(),
  severity: z.enum(['info', 'warning', 'critical']).default('warning'),
});

function dateParam(req, res) {
  const date = req.query.date && String(req.query.date);
  if (!date || !DATE_RE.test(date)) {
    res.status(400).json({ error: "date parametri kerak va 'YYYY-MM-DD' formatda bo'lishi shart" });
    return null;
  }
  return date;
}

export default function workerControlRoutes() {
  const router = Router();

  // GET /api/workers/attendance?date=YYYY-MM-DD — kunlik davomat hisoboti
  router.get('/attendance', authMiddleware, requirePermission('staff.read'), async (req, res) => {
    const date = dateParam(req, res);
    if (!date) return;
    try {
      const shifts = await q(
        `SELECT staff_name, doctor_id, shift_date, start_time, end_time, grace_minutes
         FROM staff_shifts WHERE tenant_id = $1 AND shift_date = $2 ORDER BY start_time`,
        [req.user.tenant_id, date]
      );
      const attendance = await q(
        `SELECT person_name, direction, occurred_at, confidence
         FROM attendance_events
         WHERE tenant_id = $1
           AND occurred_at >= $2::timestamp - interval '2 hours'
           AND occurred_at <  $2::timestamp + interval '30 hours'`,
        [req.user.tenant_id, date]
      );
      // Kamera dalillari (subject_ref 'staff:...' bilan belgilanadi)
      const vision = await q(
        `SELECT subject_ref, occurred_at FROM vision_events
         WHERE tenant_id = $1 AND subject_ref LIKE 'staff:%'
           AND occurred_at >= $2::timestamp - interval '2 hours'
           AND occurred_at <  $2::timestamp + interval '30 hours'`,
        [req.user.tenant_id, date]
      );
      res.json({ success: true, date, ...buildDailyReport(shifts, attendance, vision) });
    } catch (e) {
      serverFail(res, e, 'Davomat hisobotini olib bo\'lmadi');
    }
  });

  // GET /api/workers/alerts?date=YYYY-MM-DD — zona buzilish signallari
  router.get('/alerts', authMiddleware, requirePermission('staff.read'), async (req, res) => {
    const date = dateParam(req, res);
    if (!date) return;
    try {
      const rules = await q(
        'SELECT zone_id, rule_type, allowed_start, allowed_end, severity, enabled FROM vision_zone_rules WHERE tenant_id = $1',
        [req.user.tenant_id]
      );
      const events = await q(
        `SELECT id, zone_id, subject_ref, camera_id, occurred_at FROM vision_events
         WHERE tenant_id = $1
           AND occurred_at >= $2::timestamp - interval '2 hours'
           AND occurred_at <  $2::timestamp + interval '30 hours'`,
        [req.user.tenant_id, date]
      );
      const shifts = await q(
        `SELECT staff_name, shift_date, start_time FROM staff_shifts
         WHERE tenant_id = $1 AND shift_date = $2`,
        [req.user.tenant_id, date]
      );
      const zoneAlerts = detectZoneAlerts(events, rules);
      const missing = detectPresenceAlerts(shifts, rules, buildZonePresence(events));
      const alerts = [...missing, ...zoneAlerts]
        .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
      res.json({ success: true, date, total: alerts.length, alerts });
    } catch (e) {
      serverFail(res, e, 'Signallarni olib bo\'lmadi');
    }
  });

  // GET /api/workers/presence?date=YYYY-MM-DD — xodimlarning zona-faolligi
  router.get('/presence', authMiddleware, requirePermission('staff.read'), async (req, res) => {
    const date = dateParam(req, res);
    if (!date) return;
    try {
      const events = await q(
        `SELECT zone_id, subject_ref, occurred_at FROM vision_events
         WHERE tenant_id = $1 AND subject_ref LIKE 'staff:%'
           AND occurred_at >= $2::timestamp - interval '2 hours'
           AND occurred_at <  $2::timestamp + interval '30 hours'`,
        [req.user.tenant_id, date]
      );
      // subject_ref → xodim ismi: smena jadvali + faol xodimlar ro'yxati
      const [shiftNames, staffNames] = await Promise.all([
        q('SELECT DISTINCT staff_name FROM staff_shifts WHERE tenant_id = $1 AND shift_date = $2',
          [req.user.tenant_id, date]),
        q('SELECT full_name FROM staff_members WHERE tenant_id = $1 AND is_active = true',
          [req.user.tenant_id]),
      ]);
      const names = new Map();
      for (const n of [...shiftNames.map((s) => s.staff_name), ...staffNames.map((s) => s.full_name)]) {
        const ref = staffSubjectRef(n);
        if (ref && !names.has(ref)) names.set(ref, n);
      }
      const presence = buildZonePresence(events)
        .map((p) => ({ ...p, staff_name: names.get(p.subject_ref) || null }));
      res.json({ success: true, date, total: presence.length, presence });
    } catch (e) {
      serverFail(res, e, 'Zona faolligini olib bo\'lmadi');
    }
  });

  // ─── Smena jadvali ─────────────────────────────────────────────────
  router.get('/shifts', authMiddleware, requirePermission('staff.read'), async (req, res) => {
    const from = req.query.from && DATE_RE.test(String(req.query.from)) ? String(req.query.from) : null;
    const to = req.query.to && DATE_RE.test(String(req.query.to)) ? String(req.query.to) : null;
    try {
      let sql = `SELECT id, staff_name, doctor_id, shift_date, start_time, end_time, grace_minutes
                 FROM staff_shifts WHERE tenant_id = $1`;
      const params = [req.user.tenant_id];
      if (from) { params.push(from); sql += ` AND shift_date >= $${params.length}`; }
      if (to) { params.push(to); sql += ` AND shift_date <= $${params.length}`; }
      sql += ' ORDER BY shift_date, start_time LIMIT 500';
      res.json({ success: true, shifts: await q(sql, params) });
    } catch (e) {
      serverFail(res, e, 'Smenalarni o\'qib bo\'lmadi');
    }
  });

  router.post('/shifts', authMiddleware, requirePermission('staff.manage'), validate(shiftSchema), async (req, res) => {
    try {
      const { staff_name, doctor_id, shift_date, start_time, end_time, grace_minutes } = req.body;
      const id = uuidv4();
      await q(
        `INSERT INTO staff_shifts (id, tenant_id, staff_name, doctor_id, shift_date, start_time, end_time, grace_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, req.user.tenant_id, staff_name, doctor_id || null, shift_date, start_time, end_time, grace_minutes]
      );
      res.status(201).json({ success: true, shift: { id, staff_name, shift_date, start_time, end_time } });
    } catch (e) {
      if (e.code === '23505') {
        return res.status(409).json({ error: `${req.body.staff_name} uchun ${req.body.shift_date} kuni smena allaqachon mavjud` });
      }
      serverFail(res, e, 'Smena qo\'shib bo\'lmadi');
    }
  });

  router.delete('/shifts/:id', authMiddleware, requirePermission('staff.manage'), async (req, res) => {
    try {
      const row = await qGet(
        'DELETE FROM staff_shifts WHERE id = $1 AND tenant_id = $2 RETURNING id',
        [req.params.id, req.user.tenant_id]
      );
      if (!row) return res.status(404).json({ error: 'Smena topilmadi' });
      res.json({ success: true });
    } catch (e) {
      serverFail(res, e, 'Smenani o\'chirib bo\'lmadi');
    }
  });

  // ─── Zona qoidalari ────────────────────────────────────────────────
  router.get('/zone-rules', authMiddleware, requirePermission('staff.read'), async (req, res) => {
    try {
      const rules = await q(
        `SELECT id, zone_id, rule_type, allowed_start, allowed_end, severity, enabled, created_at
         FROM vision_zone_rules WHERE tenant_id = $1 ORDER BY created_at`,
        [req.user.tenant_id]
      );
      res.json({ success: true, rules });
    } catch (e) {
      serverFail(res, e, 'Zona qoidalarini o\'qib bo\'lmadi');
    }
  });

  router.post('/zone-rules', authMiddleware, requirePermission('staff.manage'), validate(zoneRuleSchema), async (req, res) => {
    try {
      const { zone_id, rule_type, allowed_start, allowed_end, severity } = req.body;
      if (rule_type === 'after_hours' && (!allowed_start || !allowed_end)) {
        return res.status(400).json({ error: "after_hours qoidasi uchun allowed_start va allowed_end kerak" });
      }
      const id = uuidv4();
      await q(
        `INSERT INTO vision_zone_rules (id, tenant_id, zone_id, rule_type, allowed_start, allowed_end, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, zone_id, rule_type)
         DO UPDATE SET allowed_start = EXCLUDED.allowed_start,
                       allowed_end = EXCLUDED.allowed_end,
                       severity = EXCLUDED.severity,
                       enabled = true`,
        [id, req.user.tenant_id, zone_id, rule_type, allowed_start || null, allowed_end || null, severity]
      );
      res.status(201).json({ success: true, rule: { id, zone_id, rule_type, severity } });
    } catch (e) {
      serverFail(res, e, 'Zona qoidasini saqlab bo\'lmadi');
    }
  });

  router.put('/zone-rules/:id', authMiddleware, requirePermission('staff.manage'), async (req, res) => {
    try {
      const enabled = req.body?.enabled;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Faqat enabled: true|false qabul qilinadi' });
      }
      const row = await qGet(
        'UPDATE vision_zone_rules SET enabled = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id, enabled',
        [enabled, req.params.id, req.user.tenant_id]
      );
      if (!row) return res.status(404).json({ error: 'Zona qoidasi topilmadi' });
      res.json({ success: true, rule: row });
    } catch (e) {
      serverFail(res, e, 'Zona qoidasini yangilab bo\'lmadi');
    }
  });

  return router;
}
