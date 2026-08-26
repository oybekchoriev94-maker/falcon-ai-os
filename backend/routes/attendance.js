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
import { parseFaceSubject, validateFaceEvent } from '../services/face-validation.js';
import { checkInAppointment } from '../services/appointment-checkin.js';

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
    // Face ID v2 (PR #10) maydonlari — eski agent yubormasligi mumkin.
    subject_type: z.enum(['staff', 'patient']).optional(),
    frame_count: z.number().int().min(1).max(50).optional(),
    liveness_score: z.number().min(0).max(1).optional(),
    liveness_ok: z.boolean().optional(),
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
    let autoCheckedIn = 0;

    try {
      await client.query('BEGIN');

      for (const ev of parsed.data.events) {
        const when = new Date(ev.occurred_at);
        if (Number.isNaN(when.getTime())) { duplicates += 1; continue; }

        // Kelajakdagi vaqtni qabul qilmaymiz — agentda soat noto'g'ri
        // bo'lsa davomat buziladi. 5 daqiqa zaxira (soat farqi uchun).
        if (when.getTime() > Date.now() + 5 * 60_000) { duplicates += 1; continue; }

        // Kim ekanini aniqlash: agent to'g'ridan-to'g'ri subject_type
        // yuboradi; eski agentda papka prefiksiga qaraymiz.
        const parsedSubject = parseFaceSubject(ev.person_name);
        const subjectType = ev.subject_type || parsedSubject.subjectType;
        const personName = ev.subject_type ? ev.person_name : parsedSubject.personName;

        // Server qayta tekshiruvi — shubhali hodisa ham SAQLANADI
        // (dalil yo'qolmasin), faqat flag bilan ko'rinadi.
        const check = validateFaceEvent(ev);

        // Yaqin oynada shu odamning shu yo'nalishdagi hodisasi bormi?
        const { rows } = await client.query(
          `SELECT 1 FROM attendance_events
            WHERE tenant_id = $1 AND person_name = $2 AND direction = $3 AND subject_type = $4
              AND occurred_at BETWEEN $5::timestamptz - INTERVAL '${DEDUP_WINDOW_MIN} minutes'
                                  AND $5::timestamptz + INTERVAL '${DEDUP_WINDOW_MIN} minutes'
            LIMIT 1`,
          [tenantId, personName, ev.direction, subjectType, when.toISOString()]
        );
        if (rows.length) { duplicates += 1; continue; }

        let doctorId = null;
        let patientId = null;
        if (subjectType === 'staff') {
          // Ismni shifokor bilan bog'lashga urinamiz (ixtiyoriy — bog'lanmasa
          // ham davomat ishlayveradi, chunki ism matn sifatida saqlanadi)
          doctorId = (await client.query(
            `SELECT id FROM doctors
              WHERE tenant_id = $1
                AND lower(trim(first_name || ' ' || coalesce(last_name,''))) = lower(trim($2))
              LIMIT 1`,
            [tenantId, personName]
          )).rows[0]?.id || null;
        } else {
          patientId = (await client.query(
            `SELECT id FROM patients
              WHERE tenant_id = $1
                AND lower(trim(first_name || ' ' || coalesce(last_name,''))) = lower(trim($2))
              LIMIT 1`,
            [tenantId, personName]
          )).rows[0]?.id || null;
        }

        await client.query(
          `INSERT INTO attendance_events
             (tenant_id, person_name, doctor_id, patient_id, direction, occurred_at,
              device_id, source, confidence, subject_type, frame_count,
              liveness_score, liveness_ok, flag)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'face',$8,$9,$10,$11,$12,$13)
           ON CONFLICT DO NOTHING`,
          [tenantId, personName, doctorId, patientId, ev.direction,
           when.toISOString(), req.device.id, ev.confidence ?? null,
           subjectType, ev.frame_count ?? null,
           ev.liveness_score ?? null, ev.liveness_ok ?? false, check.flag]
        );
        accepted += 1;

        // Bemor keldi va liveness o'tdi -> bugungi bronini avtomatik
        // check-in qilamiz (navbatga tushadi). Best-effort: check-in
        // xatosi hodisani bekor qilmaydi.
        if (subjectType === 'patient' && ev.direction === 'in' && check.ok) {
          try {
            const appt = (await client.query(
              `SELECT id FROM appointments
                WHERE tenant_id = $1
                  AND lower(trim(patient_name)) = lower(trim($2))
                  AND scheduled_at::date = CURRENT_DATE
                  AND arrived_at IS NULL
                  AND status IN ('scheduled', 'confirmed')
                ORDER BY scheduled_at LIMIT 1`,
              [tenantId, personName]
            )).rows[0];
            if (appt) {
              await checkInAppointment(pool, {
                tenantId, appointmentId: appt.id, source: 'face', actorUserId: null,
              });
              autoCheckedIn += 1;
            }
          } catch (checkinErr) {
            console.warn('[ATTENDANCE avto check-in]', checkinErr.message);
          }
        }
      }

      await client.query('COMMIT');
      res.json({ success: true, accepted, duplicates, auto_checked_in: autoCheckedIn });
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
            AND subject_type = 'staff'
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

      // Bugun Face ID orqali kelgan bemorlar (registratura uchun tez ko'rinish)
      const patientRows = await q(
        `SELECT person_name, min(occurred_at) AS first_in,
                bool_or(liveness_ok) AS liveness_ok
           FROM attendance_events
          WHERE tenant_id = $1 AND subject_type = 'patient' AND direction = 'in'
            AND date(occurred_at AT TIME ZONE 'Asia/Tashkent') = $2::date
          GROUP BY person_name
          ORDER BY min(occurred_at)`,
        [tenantId, today]
      );

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
        patient_arrivals: patientRows,
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

  // GET /api/attendance/events?date=&type=staff|patient|all — xom hodisalar
  router.get('/events', authMiddleware, checkRole('ceo', 'admin', 'superadmin'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const d = String(req.query.date || '').slice(0, 10) ||
        new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
      const type = String(req.query.type || 'all');
      if (!['staff', 'patient', 'all'].includes(type)) {
        return res.status(400).json({ success: false, error: 'type=staff|patient|all' });
      }
      const where = type === 'all' ? '' : ' AND subject_type = $3';
      const params = type === 'all' ? [tenantId, d] : [tenantId, d, type];
      const rows = await q(
        `SELECT person_name, direction, occurred_at, confidence, source,
                subject_type, frame_count, liveness_score, liveness_ok, flag
           FROM attendance_events
          WHERE tenant_id = $1 AND date(occurred_at AT TIME ZONE 'Asia/Tashkent') = $2::date${where}
          ORDER BY occurred_at DESC
          LIMIT 500`,
        params
      );
      res.json({ success: true, date: d, events: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
