// ============================================================
// FALCON AI OS — Xodimlar davomati
//
// Klinika kompyuteridagi agent yuzni LOKAL taniydi va bu yerga faqat
// hodisa yuboradi: {ism, kirdi/chiqdi, vaqt}. Yuz shablonlari hech
// qachon bu serverga kelmaydi.
//
// Ikki xil kirish:
//   - Agent  -> qurilma tokeni (X-Kiosk-Token), faqat yozish
//   - Xodim  -> JWT, faqat o'qish (hisobotlar)
// ============================================================
import { Router } from 'express';
import { z } from 'zod';
import { makeDeviceAuth, checkRate } from '../services/device-auth.js';

// Bir odam kelgach, keyingi "keldi" shu vaqt ichida e'tiborga olinmaydi.
// Agent ham buni tekshiradi, lekin ikki kamera bir odamni ko'rsa yoki
// navbat qayta yuborilsa — server oxirgi to'siq bo'lib qoladi.
const DEDUP_WINDOW_MIN = 3;

export default function attendanceRoutes(pool, authMiddleware, checkRole) {
  const router = Router();
  const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
  const deviceAuth = makeDeviceAuth(pool, ['attendance']);

  // ── AGENT: hodisalarni qabul qilish ───────────────────────

  const eventSchema = z.object({
    person_name: z.string().min(1).max(120),
    direction: z.enum(['in', 'out']),
    // ISO 8601. Agent lokal vaqtini yuboradi (uzilishdan keyin ham
    // haqiqiy vaqt saqlanishi uchun — qabul vaqti emas).
    occurred_at: z.string().min(10).max(40),
    confidence: z.number().min(0).max(1).optional(),
  });

  const batchSchema = z.object({
    events: z.array(eventSchema).min(1).max(500),
  });

  router.post('/events', deviceAuth, async (req, res) => {
    // Agent normalda kuniga bir necha yuz hodisa yuboradi. Daqiqada 60 ta
    // so'rov — uzilishdan keyingi katta navbat uchun ham yetarli.
    if (!checkRate(`att:${req.device.id}`, 60, 60_000)) {
      return res.status(429).json({ success: false, error: 'Juda ko\'p so\'rov' });
    }

    const parsed = batchSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: 'Ma\'lumot noto\'g\'ri',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const tenantId = req.deviceTenantId;
    const client = await pool.connect();
    let accepted = 0;
    let duplicates = 0;

    try {
      await client.query('BEGIN');

      for (const ev of parsed.data.events) {
        const when = new Date(ev.occurred_at);
        if (Number.isNaN(when.getTime())) { duplicates += 1; continue; }

        // Kelajakdagi vaqtni qabul qilmaymiz — agentda soat noto'g'ri
        // bo'lsa davomat buziladi. 5 daqiqa zaxira (soat farqi uchun).
        if (when.getTime() > Date.now() + 5 * 60_000) { duplicates += 1; continue; }

        // Yaqin oynada shu odamning shu yo'nalishdagi hodisasi bormi?
        const { rows } = await client.query(
          `SELECT 1 FROM attendance_events
            WHERE tenant_id = $1 AND person_name = $2 AND direction = $3
              AND occurred_at BETWEEN $4::timestamptz - INTERVAL '${DEDUP_WINDOW_MIN} minutes'
                                  AND $4::timestamptz + INTERVAL '${DEDUP_WINDOW_MIN} minutes'
            LIMIT 1`,
          [tenantId, ev.person_name, ev.direction, when.toISOString()]
        );
        if (rows.length) { duplicates += 1; continue; }

        // Ismni shifokor bilan bog'lashga urinamiz (ixtiyoriy — bog'lanmasa
        // ham davomat ishlayveradi, chunki ism matn sifatida saqlanadi)
        const doc = (await client.query(
          `SELECT id FROM doctors
            WHERE tenant_id = $1
              AND lower(trim(first_name || ' ' || coalesce(last_name,''))) = lower(trim($2))
            LIMIT 1`,
          [tenantId, ev.person_name]
        )).rows[0];

        await client.query(
          `INSERT INTO attendance_events
             (tenant_id, person_name, doctor_id, direction, occurred_at,
              device_id, source, confidence)
           VALUES ($1,$2,$3,$4,$5,$6,'face',$7)
           ON CONFLICT DO NOTHING`,
          [tenantId, ev.person_name, doc?.id || null, ev.direction,
           when.toISOString(), req.device.id, ev.confidence ?? null]
        );
        accepted += 1;
      }

      await client.query('COMMIT');
      res.json({ success: true, accepted, duplicates });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[ATTENDANCE ingest]', e);
      res.status(500).json({ success: false, error: 'Saqlashda xatolik' });
    } finally {
      client.release();
    }
  });

  // ── XODIM: hisobotlar (JWT) ───────────────────────────────

  /**
   * Kunlik jadval: har odam uchun birinchi kirish, oxirgi chiqish,
   * kelishlar soni va hozir ichkarida ekani.
   *
   * "Hozir ichkarida" = oxirgi hodisa 'in' bo'lsa. Agent 'out' ni
   * xodim uzoq ko'rinmaganda yozadi, shuning uchun bu ishonchli.
   */
  async function dailyReport(tenantId, dateStr) {
    return q(
      `WITH ev AS (
         SELECT person_name, direction, occurred_at,
                row_number() OVER (PARTITION BY person_name ORDER BY occurred_at DESC) AS rn_desc
           FROM attendance_events
          WHERE tenant_id = $1 AND date(occurred_at AT TIME ZONE 'Asia/Tashkent') = $2::date
       )
       SELECT person_name,
              min(occurred_at) FILTER (WHERE direction = 'in')  AS first_in,
              max(occurred_at) FILTER (WHERE direction = 'out') AS last_out,
              count(*) FILTER (WHERE direction = 'in')::int     AS arrivals,
              bool_or(direction = 'in' AND rn_desc = 1)         AS present
         FROM ev
        GROUP BY person_name
        ORDER BY min(occurred_at) FILTER (WHERE direction = 'in') NULLS LAST`,
      [tenantId, dateStr]
    );
  }

  // GET /api/attendance/today
  router.get('/today', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
      const rows = await dailyReport(tenantId, today);

      // Agent tirikmi — davomat qurilmasining oxirgi aloqasi
      const dev = (await q(
        `SELECT name, last_seen_at FROM kiosk_devices
          WHERE tenant_id = $1 AND kind = 'attendance' AND is_active = true
          ORDER BY last_seen_at DESC NULLS LAST LIMIT 1`,
        [tenantId]
      ))[0];
      const online = dev?.last_seen_at
        ? (Date.now() - new Date(dev.last_seen_at).getTime()) < 5 * 60_000
        : false;

      res.json({
        success: true,
        date: today,
        agent: { name: dev?.name || null, last_seen_at: dev?.last_seen_at || null, online },
        present_count: rows.filter((r) => r.present).length,
        arrived_count: rows.length,
        people: rows,
      });
    } catch (e) {
      console.error('[ATTENDANCE today]', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/attendance/report?date=YYYY-MM-DD
  router.get('/report', authMiddleware, async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const d = String(req.query.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        return res.status(400).json({ success: false, error: 'date=YYYY-MM-DD kerak' });
      }
      const rows = await dailyReport(tenantId, d);
      res.json({ success: true, date: d, people: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/attendance/events?date= — xom hodisalar (tekshirish uchun)
  router.get('/events', authMiddleware, checkRole('ceo', 'admin', 'superadmin'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const d = String(req.query.date || '').slice(0, 10) ||
        new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
      const rows = await q(
        `SELECT person_name, direction, occurred_at, confidence, source
           FROM attendance_events
          WHERE tenant_id = $1 AND date(occurred_at AT TIME ZONE 'Asia/Tashkent') = $2::date
          ORDER BY occurred_at DESC
          LIMIT 500`,
        [tenantId, d]
      );
      res.json({ success: true, date: d, events: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
