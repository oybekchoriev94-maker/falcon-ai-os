// ============================================================
// FALCON AI OS — Kiosk API (Bosqich T)
//
// Kirish zalidagi planshet uchun. Bemor o'zi bo'lib qabulga yoziladi.
//
// XAVFSIZLIK QATLAMLARI:
//  1) QURILMA TOKENI — `X-Kiosk-Token` sarlavhasi majburiy. Token
//     sha256 hash bilan solishtiriladi (ochiq token bazada turmaydi).
//  2) TENANT — token o'z klinikasiga bog'langan; boshqa klinika
//     ma'lumotiga kira olmaydi.
//  3) IP CHEKLOVI (ixtiyoriy) — allowed_ips bo'lsa faqat shu IP'lardan.
//  4) PII MINIMIZATSIYA — lookup bemor ismini TO'LIQ qaytarmaydi.
//     Faqat maskalangan ("A**** K*****") + karta bor/yo'qligi. To'liq ism
//     faqat bemor o'zi tasdiqlagach (confirm) beriladi.
//  5) RATE LIMIT — bir qurilma daqiqada 20 lookup (raqam enumeratsiyasiga
//     qarshi).
//  6) AUDIT — har sessiya kiosk_sessions ga yoziladi.
//  7) YOZISH CHEKLOVI — kiosk faqat bron yaratadi. O'chirish, tahrirlash,
//     boshqa bemor ma'lumotini ko'rish MUMKIN EMAS.
// ============================================================
import { Router } from 'express';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { normalizePhone } from '../services/patient-store.js';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Ismni maskalash: "Alisher Karimov" -> "A****** K******" */
function maskName(first, last) {
  const m = (s) => {
    const t = String(s || '').trim();
    if (!t) return '';
    return t[0].toUpperCase() + '*'.repeat(Math.max(3, t.length - 1));
  };
  return [m(first), m(last)].filter(Boolean).join(' ') || 'Bemor';
}

/** Telefonni maskalash: "+998901234567" -> "+998 90 *** 45 67" */
function maskPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length < 9) return '***';
  const t = d.slice(-9);
  return `+998 ${t.slice(0, 2)} *** ${t.slice(5, 7)} ${t.slice(7, 9)}`;
}

// Rate limiter — qurilma bo'yicha, daqiqada
const rateBuckets = new Map();
function checkRate(key, limit, windowMs) {
  const now = Date.now();
  const b = rateBuckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n += 1;
  rateBuckets.set(key, b);
  return b.n <= limit;
}

export default function kioskRoutes(pool, authMiddleware, checkRole) {
  const router = Router();
  const q = async (sql, p = []) => (await pool.query(sql, p)).rows;
  const qGet = async (sql, p = []) => (await pool.query(sql, p)).rows[0] || null;

  // ── QURILMA AUTENTIFIKATSIYASI ────────────────────────────
  async function deviceAuth(req, res, next) {
    const token = req.headers['x-kiosk-token'] || '';
    if (!token) {
      return res.status(401).json({ success: false, error: 'Qurilma tokeni yo\'q', code: 'NO_DEVICE_TOKEN' });
    }
    try {
      const dev = await qGet(
        `SELECT id, tenant_id, name, kind, allowed_ips
           FROM kiosk_devices
          WHERE token_hash = $1 AND is_active = true`,
        [sha256(token)]
      );
      if (!dev) {
        return res.status(401).json({ success: false, error: 'Qurilma tokeni yaroqsiz', code: 'BAD_DEVICE_TOKEN' });
      }

      // IP cheklovi (agar sozlangan bo'lsa)
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      if (dev.allowed_ips?.length && ip && !dev.allowed_ips.includes(ip)) {
        return res.status(403).json({ success: false, error: 'Ruxsat etilmagan tarmoq', code: 'IP_BLOCKED' });
      }

      req.kioskDevice = dev;
      req.kioskTenantId = dev.tenant_id;

      // last_seen (fire-and-forget)
      pool.query(
        `UPDATE kiosk_devices SET last_seen_at = NOW(), last_seen_ip = $1::inet WHERE id = $2`,
        [ip || null, dev.id]
      ).catch(() => {});

      next();
    } catch (e) {
      console.error('[KIOSK auth]', e);
      res.status(500).json({ success: false, error: 'Server xatosi' });
    }
  }

  // ============================================================
  // KIOSK PUBLIC API (qurilma tokeni bilan)
  // ============================================================

  // GET /api/kiosk/config — klinika nomi, logo, bo'limlar (ekran boshi)
  router.get('/config', deviceAuth, async (req, res) => {
    try {
      const t = await qGet(
        `SELECT name, address, phone FROM tenants WHERE id = $1`,
        [req.kioskTenantId]
      );
      // Logo va to'lov QR — clinic_settings key-value jadvalida
      // (tenants jadvalida bu ustunlar yo'q).
      const settings = await q(
        `SELECT key, value FROM clinic_settings
          WHERE tenant_id = $1 AND key IN ('logo_url', 'payment_qr_url')`,
        [req.kioskTenantId]
      );
      const get = (k) => settings.find((s) => s.key === k)?.value || null;

      res.json({
        success: true,
        clinic: {
          name: t?.name || 'Klinika',
          logo_url: get('logo_url'),
          payment_qr_url: get('payment_qr_url'),
          address: t?.address || null,
          phone: t?.phone || null,
        },
        device: { name: req.kioskDevice.name, kind: req.kioskDevice.kind },
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/kiosk/lookup — telefon bo'yicha karta bor-yo'qligini tekshirish
  // PII: to'liq ism QAYTMAYDI. Faqat maskalangan + MRN oxirgi 4 raqami.
  const lookupSchema = z.object({
    phone: z.string().min(9).max(20),
  });

  router.post('/lookup', deviceAuth, async (req, res) => {
    // Rate limit: daqiqada 20 (raqam enumeratsiyasiga qarshi)
    if (!checkRate(`lookup:${req.kioskDevice.id}`, 20, 60_000)) {
      return res.status(429).json({ success: false, error: 'Juda ko\'p urinish. Registraturaga murojaat qiling.' });
    }
    const parsed = lookupSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Telefon raqami noto\'g\'ri' });
    }
    try {
      const phone = normalizePhone(parsed.data.phone);
      if (!phone) return res.status(400).json({ success: false, error: 'Telefon raqami noto\'g\'ri' });

      const p = await qGet(
        `SELECT id, first_name, last_name, medical_record_number
           FROM patients WHERE tenant_id = $1 AND phone = $2`,
        [req.kioskTenantId, phone]
      );

      // Sessiya boshlash (audit)
      const sessionId = uuidv4();
      pool.query(
        `INSERT INTO kiosk_sessions (id, tenant_id, device_id, patient_id, phone_masked, step_reached)
         VALUES ($1, $2, $3, $4, $5, 'phone')`,
        [sessionId, req.kioskTenantId, req.kioskDevice.id, p?.id || null, maskPhone(phone)]
      ).catch(() => {});

      if (!p) {
        return res.json({ success: true, session_id: sessionId, found: false });
      }

      res.json({
        success: true,
        session_id: sessionId,
        found: true,
        // PII minimizatsiya — to'liq ism yo'q
        masked_name: maskName(p.first_name, p.last_name),
        mrn_tail: p.medical_record_number ? String(p.medical_record_number).slice(-4) : null,
        // Bemor "Ha, bu men" bosgach confirm bilan to'liq ism olinadi
        confirm_token: crypto.createHmac('sha256', process.env.INTERNAL_SECRET || 'falcon')
          .update(`${sessionId}:${p.id}`).digest('hex').slice(0, 32),
        patient_ref: sessionId,   // haqiqiy patient_id emas — sessiya orqali ishlaydi
      });
    } catch (e) {
      console.error('[KIOSK lookup]', e);
      res.status(500).json({ success: false, error: 'Server xatosi' });
    }
  });

  // POST /api/kiosk/confirm — bemor "Ha, bu men" bosgach to'liq ism
  const confirmSchema = z.object({
    session_id: z.string().uuid(),
    confirm_token: z.string().min(16).max(64),
  });

  router.post('/confirm', deviceAuth, async (req, res) => {
    const parsed = confirmSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Validatsiya xatosi' });
    try {
      const s = await qGet(
        `SELECT patient_id FROM kiosk_sessions
          WHERE id = $1 AND tenant_id = $2 AND device_id = $3
            AND started_at > NOW() - INTERVAL '15 minutes'`,
        [parsed.data.session_id, req.kioskTenantId, req.kioskDevice.id]
      );
      if (!s?.patient_id) {
        return res.status(404).json({ success: false, error: 'Sessiya topilmadi yoki muddati o\'tgan' });
      }

      // Token tekshirish
      const expected = crypto.createHmac('sha256', process.env.INTERNAL_SECRET || 'falcon')
        .update(`${parsed.data.session_id}:${s.patient_id}`).digest('hex').slice(0, 32);
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.data.confirm_token))) {
        return res.status(403).json({ success: false, error: 'Token mos kelmadi' });
      }

      const p = await qGet(
        `SELECT id, first_name, last_name, middle_name, medical_record_number, birth_date
           FROM patients WHERE tenant_id = $1 AND id = $2`,
        [req.kioskTenantId, s.patient_id]
      );
      if (!p) return res.status(404).json({ success: false, error: 'Bemor topilmadi' });

      res.json({
        success: true,
        patient: {
          id: p.id,
          full_name: [p.last_name, p.first_name, p.middle_name].filter(Boolean).join(' ').trim(),
          medical_record_number: p.medical_record_number,
        },
      });
    } catch (e) {
      console.error('[KIOSK confirm]', e);
      res.status(500).json({ success: false, error: 'Server xatosi' });
    }
  });

  // GET /api/kiosk/departments — bo'limlar + shifokorlar (bugungi bo'sh joyi bilan)
  router.get('/departments', deviceAuth, async (req, res) => {
    try {
      const rows = await q(
        `SELECT d.id, d.first_name, d.last_name, d.specialization,
                COUNT(a.id) FILTER (
                  WHERE date(a.scheduled_at) = CURRENT_DATE
                    AND a.status NOT IN ('cancelled','no_show')
                )::int AS today_booked
           FROM doctors d
           LEFT JOIN appointments a ON a.doctor_id = d.id AND a.tenant_id = d.tenant_id
          WHERE d.tenant_id = $1 AND (d.status IS NULL OR d.status = 'Faol')
          GROUP BY d.id, d.first_name, d.last_name, d.specialization
          ORDER BY d.specialization NULLS LAST, d.first_name`,
        [req.kioskTenantId]
      );

      // Bo'limlar bo'yicha guruhlash
      const byDept = new Map();
      for (const r of rows) {
        const dept = r.specialization || 'Boshqa';
        if (!byDept.has(dept)) byDept.set(dept, []);
        byDept.get(dept).push({
          id: r.id,
          name: `${r.first_name} ${r.last_name || ''}`.trim(),
          today_booked: r.today_booked,
        });
      }
      res.json({
        success: true,
        departments: [...byDept.entries()].map(([name, doctors]) => ({ name, doctors })),
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/kiosk/services?doctor_id= — shifokor xizmatlari (narx bilan)
  router.get('/services', deviceAuth, async (req, res) => {
    try {
      const rows = await q(
        `SELECT id, name, category, specialty, price::float8 AS price, duration_min
           FROM services_catalog
          WHERE tenant_id = $1 AND active = TRUE
          ORDER BY category NULLS LAST, name
          LIMIT 200`,
        [req.kioskTenantId]
      );
      res.json({ success: true, services: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/kiosk/slots?doctor_id=&date= — bo'sh vaqtlar
  router.get('/slots', deviceAuth, async (req, res) => {
    try {
      const doctorId = String(req.query.doctor_id || '');
      const date = String(req.query.date || new Date().toISOString().slice(0, 10));
      if (!doctorId) return res.status(400).json({ success: false, error: 'doctor_id kerak' });

      // Band vaqtlar
      const taken = await q(
        `SELECT to_char(scheduled_at, 'HH24:MI') AS t
           FROM appointments
          WHERE tenant_id = $1 AND doctor_id = $2
            AND date(scheduled_at) = $3::date
            AND status NOT IN ('cancelled','no_show')`,
        [req.kioskTenantId, doctorId, date]
      );
      const takenSet = new Set(taken.map((r) => r.t));

      // 09:00–17:00, 20 daqiqalik oraliq. O'tgan vaqtlar chiqarilmaydi.
      const slots = [];
      const now = new Date();
      const isToday = date === now.toISOString().slice(0, 10);
      for (let h = 9; h < 17; h++) {
        for (const m of [0, 20, 40]) {
          const label = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
          if (takenSet.has(label)) continue;
          if (isToday && (h < now.getHours() || (h === now.getHours() && m <= now.getMinutes() + 10))) continue;
          slots.push({ time: label, iso: `${date}T${label}:00` });
        }
      }
      res.json({ success: true, date, slots });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/kiosk/book — bron yaratish (kassa to'lovi kutiladi)
  const bookSchema = z.object({
    session_id: z.string().uuid(),
    patient_name: z.string().min(2).max(200),
    phone: z.string().min(9).max(20),
    doctor_id: z.string().uuid(),
    service_id: z.string().uuid(),
    scheduled_at: z.string(),
    complaint: z.string().max(1000).optional(),
  });

  router.post('/book', deviceAuth, async (req, res) => {
    // Rate limit: daqiqada 5 bron (bir qurilmadan)
    if (!checkRate(`book:${req.kioskDevice.id}`, 5, 60_000)) {
      return res.status(429).json({ success: false, error: 'Juda ko\'p bron. Registraturaga murojaat qiling.' });
    }
    const parsed = bookSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Ma\'lumot to\'liq emas', details: parsed.error.flatten().fieldErrors });
    }
    const b = parsed.data;
    const client = await pool.connect();
    try {
      const tenantId = req.kioskTenantId;
      await client.query('BEGIN');

      // Shifokor + xizmat tekshirish (tenant ichida)
      const doc = (await client.query(
        `SELECT id, first_name, last_name, specialization FROM doctors
          WHERE tenant_id = $1 AND id = $2 AND (status IS NULL OR status = 'Faol')`,
        [tenantId, b.doctor_id]
      )).rows[0];
      if (!doc) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Shifokor topilmadi' });
      }
      const svc = (await client.query(
        `SELECT id, name, price::float8 AS price FROM services_catalog
          WHERE tenant_id = $1 AND id = $2 AND active = TRUE`,
        [tenantId, b.service_id]
      )).rows[0];
      if (!svc) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Xizmat topilmadi' });
      }

      // Bemor kartasi — telefon bo'yicha upsert (booking.js bilan bir xil mantiq)
      const phone = normalizePhone(b.phone);
      let patientId = null;
      const existing = (await client.query(
        `SELECT id FROM patients WHERE tenant_id = $1 AND phone = $2`,
        [tenantId, phone]
      )).rows[0];
      if (existing) {
        patientId = existing.id;
      } else {
        const [fn, ...rest] = b.patient_name.trim().split(/\s+/);
        const newId = uuidv4();
        const year = new Date().getFullYear();
        const last = (await client.query(
          `SELECT medical_record_number AS mrn FROM patients
            WHERE tenant_id = $1 AND medical_record_number LIKE $2
            ORDER BY medical_record_number DESC LIMIT 1`,
          [tenantId, `${year}-%`]
        )).rows[0];
        const next = last?.mrn ? (parseInt(String(last.mrn).slice(5), 10) || 0) + 1 : 1;
        const mrn = `${year}-${String(next).padStart(6, '0')}`;
        await client.query(
          `INSERT INTO patients (id, tenant_id, first_name, last_name, phone, medical_record_number)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [newId, tenantId, fn || 'Bemor', rest.join(' ') || '', phone, mrn]
        );
        patientId = newId;
      }

      // Bron
      const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const buf = crypto.randomBytes(6);
      let accessCode = '';
      for (let i = 0; i < 6; i++) accessCode += CODE[buf[i] % CODE.length];
      const apptCode = 'K' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();

      const appt = (await client.query(
        `INSERT INTO appointments
           (tenant_id, appointment_id, patient_id, patient_name, phone,
            doctor_id, doctor_name, service_id, scheduled_at, amount,
            department, source, status, payment_status, payment_method,
            access_code, notes, kiosk_device_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'kiosk','scheduled','pending','cashier',$12,$13,$14)
         RETURNING id, appointment_id, access_code, amount::float8 AS amount`,
        [tenantId, apptCode, patientId, b.patient_name, phone,
         doc.id, `${doc.first_name} ${doc.last_name || ''}`.trim(),
         svc.id, b.scheduled_at, svc.price,
         doc.specialization || 'therapy',
         accessCode, b.complaint || null, req.kioskDevice.id]
      )).rows[0];

      // Xizmat snapshot
      await client.query(
        `INSERT INTO appointment_services (tenant_id, appointment_id, service_id, name, price)
         VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, appt.id, svc.id, svc.name, svc.price]
      ).catch(() => {});

      // Sessiyani yakunlash
      await client.query(
        `UPDATE kiosk_sessions
            SET step_reached = 'done', appointment_id = $1, patient_id = $2, finished_at = NOW()
          WHERE id = $3 AND tenant_id = $4`,
        [appt.id, patientId, b.session_id, tenantId]
      ).catch(() => {});

      await client.query('COMMIT');

      // Triage agentini fon rejimda chaqiramiz (shikoyat bo'lsa)
      if (b.complaint && b.complaint.length > 5) {
        (async () => {
          try {
            const { triageAgent } = await import('../../ai/agents/time-savers.js');
            const t = await triageAgent.handler({ complaint: b.complaint });
            await pool.query(
              `UPDATE appointments SET triage_severity = $1, triage_json = $2::jsonb WHERE id = $3`,
              [t.severity, JSON.stringify(t), appt.id]
            );
          } catch (e) { console.warn('[KIOSK triage]', e.message); }
        })();
      }

      res.status(201).json({
        success: true,
        access_code: appt.access_code,
        amount: appt.amount,
        doctor_name: `${doc.first_name} ${doc.last_name || ''}`.trim(),
        service_name: svc.name,
        scheduled_at: b.scheduled_at,
        message: 'Bron qilindi. Kassaga o\'ting.',
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[KIOSK book]', e);
      res.status(500).json({ success: false, error: 'Bron qilishda xatolik. Registraturaga murojaat qiling.' });
    } finally {
      client.release();
    }
  });

  // GET /api/kiosk/queue — kutish zali TV ekrani uchun
  router.get('/queue', deviceAuth, async (req, res) => {
    try {
      const rows = await q(
        `SELECT a.access_code, a.patient_name, a.scheduled_at, a.status,
                a.doctor_name, d.specialization
           FROM appointments a
           LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1
            AND date(a.scheduled_at) = CURRENT_DATE
            AND a.status IN ('scheduled','in_progress')
            AND a.payment_status = 'paid'
          ORDER BY a.scheduled_at ASC
          LIMIT 20`,
        [req.kioskTenantId]
      );
      // PII: to'liq ism ko'rsatilmaydi — kod + familiya bosh harfi
      res.json({
        success: true,
        queue: rows.map((r) => {
          const parts = String(r.patient_name || '').trim().split(/\s+/);
          return {
            code: r.access_code,
            display_name: parts.length > 1
              ? `${parts[0]} ${parts[1][0]}.`
              : (parts[0] || '—'),
            time: new Date(r.scheduled_at).toISOString(),
            doctor: r.doctor_name,
            department: r.specialization,
            status: r.status,
          };
        }),
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ============================================================
  // ADMIN API — qurilmalarni boshqarish (JWT + ceo/admin)
  // ============================================================

  router.get('/devices', authMiddleware, checkRole('ceo', 'admin', 'superadmin'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const rows = await q(
        `SELECT id, name, kind, location, token_prefix, is_active,
                last_seen_at, last_seen_ip, created_at
           FROM kiosk_devices WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId]
      );
      res.json({ success: true, devices: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  const deviceSchema = z.object({
    name: z.string().min(2).max(100),
    kind: z.enum(['entry', 'queue_tv', 'result']).default('entry'),
    location: z.string().max(200).optional(),
  });

  // POST /devices — yangi qurilma. Token FAQAT SHU JAVOBDA ko'rsatiladi.
  router.post('/devices', authMiddleware, checkRole('ceo', 'admin', 'superadmin'), async (req, res) => {
    const parsed = deviceSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
    }
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const rawToken = 'kd_' + crypto.randomBytes(24).toString('base64url');
      const id = uuidv4();
      await pool.query(
        `INSERT INTO kiosk_devices (id, tenant_id, name, kind, location, token_hash, token_prefix, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, tenantId, parsed.data.name, parsed.data.kind, parsed.data.location || null,
         sha256(rawToken), rawToken.slice(0, 12), req.user?.id || null]
      );
      res.status(201).json({
        success: true,
        device: { id, name: parsed.data.name, kind: parsed.data.kind },
        token: rawToken,
        warning: 'Bu token faqat HOZIR ko\'rsatiladi. Planshetda saqlang — qayta ko\'rib bo\'lmaydi.',
      });
    } catch (e) {
      console.error('[KIOSK device create]', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /devices/:id/toggle — yoqish/o'chirish (yo'qolgan planshetni bloklash)
  router.post('/devices/:id/toggle', authMiddleware, checkRole('ceo', 'admin', 'superadmin'), async (req, res) => {
    try {
      const tenantId = req.user?.tenant_id || req.tenant_id;
      const { rows } = await pool.query(
        `UPDATE kiosk_devices SET is_active = NOT is_active
          WHERE tenant_id = $1 AND id = $2 RETURNING is_active`,
        [tenantId, req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ success: false, error: 'Qurilma topilmadi' });
      res.json({ success: true, is_active: rows[0].is_active });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
