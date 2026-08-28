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
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { normalizePhone } from '../services/patient-store.js';
import { createPayment } from '../services/payment-gateway.js';
import { checkInAppointment } from '../services/appointment-checkin.js';
import { dedupeKey, buildCallAnnouncement } from '../services/queue-service.js';
import { isTtsEnabled, synthesize, concatWavBuffers } from '../services/tts-client.js';
import { listConsultations } from '../services/consultation-catalog.js';
import { bindTenantDbContext } from '../request-tenant-context.js';

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
      req.tenant_id = dev.tenant_id;

      // last_seen (fire-and-forget)
      pool.query(
        `UPDATE kiosk_devices SET last_seen_at = NOW(), last_seen_ip = $1::inet WHERE id = $2`,
        [ip || null, dev.id]
      ).catch(() => {});

      // RLS KONTEKSTI MAJBURIY — device-auth.js dagi izohga qarang.
      // Busiz kiosk barcha so'rovlarda bo'sh natija olardi: xizmatlar
      // ro'yxati bo'sh, shifokorlar bo'sh, bemor topilmaydi, bron
      // yozilmaydi. Hech qanday xato chiqmaydi.
      return bindTenantDbContext(dev.tenant_id, res, next);
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
        `SELECT id, name, category, specialty, price::float8 AS price, duration_min,
                COALESCE(is_consultation, false) AS is_consultation
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

  // GET /api/kiosk/consultation-catalog — "Shifokor qabuli" bo'limi.
  // Registratura va Telegram bilan AYNAN bir xil ro'yxat (yagona manba).
  router.get('/consultation-catalog', deviceAuth, async (req, res) => {
    try {
      const data = await listConsultations(pool, req.kioskTenantId);
      res.json({ success: true, specialties: data.specialties });
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
  //
  // Bitta tashrifda bir nechta shifokorga yozilish mumkin: `visits`
  // massivi. Hammasi BITTA tranzaksiyada yaratiladi — bittasi
  // muvaffaqiyatsiz bo'lsa (masalan vaqt band bo'lib qolsa) hech biri
  // yozilmaydi. Bemor yarim bron bilan qolib ketmaydi.
  const visitSchema = z.object({
    doctor_id: z.string().uuid(),
    service_id: z.string().uuid(),
    scheduled_at: z.string(),
  });

  const bookSchema = z.object({
    session_id: z.string().uuid(),
    patient_name: z.string().min(2).max(200),
    phone: z.string().min(9).max(20),
    complaint: z.string().max(1000).optional(),
    // Kioskda bemor ikkitadan birini tanlaydi. Bazadagi qiymatlar
    // booking.js bilan bir xil: 'cashier' (kassada naqd/karta) yoki
    // 'online' (QR orqali telefondan to'lash).
    payment_method: z.enum(['cash', 'qr']).default('cash'),

    // Yangi shakl
    visits: z.array(visitSchema).min(1).max(6).optional(),
    // Eski shakl (bitta tashrif) — moslik uchun saqlanadi
    doctor_id: z.string().uuid().optional(),
    service_id: z.string().uuid().optional(),
    scheduled_at: z.string().optional(),
  }).refine(
    (d) => (d.visits?.length ?? 0) > 0 || (d.doctor_id && d.service_id && d.scheduled_at),
    { message: 'visits yoki doctor_id+service_id+scheduled_at kerak' }
  );

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

      // Tashriflar ro'yxati (eski bitta-tashrif shakli ham qo'llab-quvvatlanadi)
      const visits = b.visits?.length
        ? b.visits
        : [{ doctor_id: b.doctor_id, service_id: b.service_id, scheduled_at: b.scheduled_at }];

      // Har bir tashrif uchun shifokor va xizmatni tenant ichida tekshiramiz
      const resolved = [];
      for (const v of visits) {
        const doc = (await client.query(
          `SELECT id, first_name, last_name, specialization FROM doctors
            WHERE tenant_id = $1 AND id = $2 AND (status IS NULL OR status = 'Faol')`,
          [tenantId, v.doctor_id]
        )).rows[0];
        if (!doc) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, error: 'Shifokor topilmadi' });
        }
        const svc = (await client.query(
          `SELECT id, name, price::float8 AS price FROM services_catalog
            WHERE tenant_id = $1 AND id = $2 AND active = TRUE`,
          [tenantId, v.service_id]
        )).rows[0];
        if (!svc) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, error: 'Xizmat topilmadi' });
        }
        resolved.push({ doc, svc, scheduled_at: v.scheduled_at });
      }

      // Bir xil shifokor + bir xil vaqt ikki marta tanlanganini oldindan
      // ushlaymiz — DB indeksigacha bormasdan aniq xabar beramiz.
      const seen = new Set();
      for (const r of resolved) {
        const key = `${r.doc.id}@${r.scheduled_at}`;
        if (seen.has(key)) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            error: 'Bir shifokorga bir vaqtning o\'zida ikki marta yozilib bo\'lmaydi',
          });
        }
        seen.add(key);
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

      // Kod generatori — chalkashadigan belgilar (0/O, 1/I) yo'q
      const CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const newAccessCode = () => {
        const buf = crypto.randomBytes(6);
        let c = '';
        for (let i = 0; i < 6; i++) c += CODE[buf[i] % CODE.length];
        return c;
      };

      // 'qr' -> onlayn to'lov havolasi, 'cash' -> kassada
      const payMethod = b.payment_method === 'qr' ? 'online' : 'cashier';
      const groupId = uuidv4();

      const created = [];
      let totalAmount = 0;

      for (const r of resolved) {
        const apptCode = 'K' + Date.now().toString(36).toUpperCase()
          + crypto.randomBytes(3).toString('hex').toUpperCase();
        const accessCode = newAccessCode();

        const appt = (await client.query(
          `INSERT INTO appointments
             (tenant_id, appointment_id, patient_id, patient_name, phone,
              doctor_id, doctor_name, service_id, scheduled_at, amount,
              department, source, status, payment_status, payment_method,
              access_code, notes, kiosk_device_id, booking_group_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'kiosk','scheduled','pending',$12,$13,$14,$15,$16)
           RETURNING id, access_code, amount::float8 AS amount`,
          [tenantId, apptCode, patientId, b.patient_name, phone,
           r.doc.id, `${r.doc.first_name} ${r.doc.last_name || ''}`.trim(),
           r.svc.id, r.scheduled_at, r.svc.price,
           r.doc.specialization || 'therapy',
           payMethod, accessCode, b.complaint || null, req.kioskDevice.id, groupId]
        )).rows[0];

        // Xizmat snapshot — narx keyin o'zgarsa ham chekda o'sha narx qoladi
        await client.query(
          `INSERT INTO appointment_services (tenant_id, appointment_id, service_id, name, price)
           VALUES ($1,$2,$3,$4,$5)`,
          [tenantId, appt.id, r.svc.id, r.svc.name, r.svc.price]
        ).catch(() => {});

        totalAmount += r.svc.price || 0;
        created.push({
          id: appt.id,
          access_code: appt.access_code,
          amount: appt.amount,
          doctor_name: `${r.doc.first_name} ${r.doc.last_name || ''}`.trim(),
          service_name: r.svc.name,
          scheduled_at: r.scheduled_at,
        });
      }

      // QR to'lov tanlansa — butun guruh uchun BITTA tranzaksiya
      // (bemor bir marta to'laydi, har tashrif uchun alohida emas)
      let paymentId = null;
      if (payMethod === 'online') {
        paymentId = uuidv4();
        await client.query(
          `INSERT INTO payment_transactions
             (id, tenant_id, appointment_id, amount, description, provider, status, created_at)
           VALUES ($1,$2,$3,$4,$5,'auto','pending',NOW())`,
          [paymentId, tenantId, created[0].id, totalAmount,
           `${created.length > 1 ? `${created.length} ta tashrif` : created[0].service_name} — ${b.patient_name}`]
        );
      }

      // Sessiyani yakunlash — birinchi tashrifga bog'laymiz (audit uchun)
      await client.query(
        `UPDATE kiosk_sessions
            SET step_reached = 'done', appointment_id = $1, patient_id = $2, finished_at = NOW()
          WHERE id = $3 AND tenant_id = $4`,
        [created[0].id, patientId, b.session_id, tenantId]
      ).catch(() => {});

      await client.query('COMMIT');

      // Triage agentini fon rejimda chaqiramiz (shikoyat bo'lsa)
      if (b.complaint && b.complaint.length > 5) {
        (async () => {
          try {
            const { triageAgent } = await import('../../ai/agents/time-savers.js');
            const t = await triageAgent.handler({ complaint: b.complaint });
            await pool.query(
              `UPDATE appointments SET triage_severity = $1, triage_json = $2::jsonb
                WHERE tenant_id = $3 AND booking_group_id = $4`,
              [t.severity, JSON.stringify(t), tenantId, groupId]
            );
          } catch (e) { console.warn('[KIOSK triage]', e.message); }
        })();
      }

      // QR to'lov: provayder havolasini olamiz va uni QR rasmga aylantiramiz.
      // Bemor telefonida skanerlaydi. Havola olinmasa (provayder sozlanmagan
      // yoki javob bermadi) — bron baribir qoladi, bemor kassada to'laydi.
      let paymentQr = null;
      let paymentUrl = null;
      if (payMethod === 'online' && paymentId) {
        try {
          const baseUrl = process.env.PUBLIC_URL || 'https://falconmedai.uz';
          const payment = await createPayment({
            amount: totalAmount,
            description: `${created.length > 1 ? `${created.length} ta tashrif` : created[0].service_name} — ${b.patient_name}`,
            orderId: paymentId,
            returnUrl: `${baseUrl}/qr-pay.html?order=${paymentId}`,
            provider: 'auto',
          });
          if (payment?.success && payment?.paymentUrl) {
            paymentUrl = payment.paymentUrl;
            await pool.query(
              'UPDATE payment_transactions SET payment_url = $1, provider = $2 WHERE id = $3',
              [paymentUrl, payment.provider || 'auto', paymentId]
            );
            paymentQr = await QRCode.toDataURL(paymentUrl, { width: 420, margin: 1 });
          }
        } catch (e) {
          console.warn('[KIOSK payment]', e.message);
        }
      }

      res.status(201).json({
        success: true,
        booking_group_id: groupId,
        // Birinchi tashrif maydonlari — eski mijozlar uchun moslik
        access_code: created[0].access_code,
        amount: totalAmount,
        doctor_name: created[0].doctor_name,
        service_name: created[0].service_name,
        scheduled_at: created[0].scheduled_at,
        // To'liq ro'yxat — har tashrifning o'z kodi bor
        visits: created.map(({ id: _id, ...v }) => v),
        payment_method: b.payment_method,
        payment_qr: paymentQr,
        payment_url: paymentUrl,
        message: payMethod === 'online' && paymentQr
          ? 'Bron qilindi. QR kodni skanerlab to\'lang.'
          : 'Bron qilindi. Kassaga o\'ting.',
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});

      // Poyga holati: shu vaqtni Telegram yoki qabulxona bir soniya oldin
      // band qilib ulgurgan. DB unique indeksi (appointments_doctor_slot_unique)
      // ikkinchi yozuvni rad etadi — bu YAXSHI, ikkilanish bo'lmaydi.
      // Bemorga tushunarli qilib aytamiz va vaqt tanlashga qaytaramiz.
      if (e.code === '23505' && String(e.constraint || '').includes('appointments_doctor_slot_unique')) {
        return res.status(409).json({
          success: false,
          error: 'Bu vaqt hozirgina band bo\'ldi. Iltimos, boshqa vaqt tanlang.',
          code: 'SLOT_TAKEN',
        });
      }
      // Access-code to'qnashuvi (juda kam) — qayta urinish yetarli
      if (e.code === '23505' && String(e.constraint || '').includes('appointments_access_code_unique')) {
        return res.status(409).json({
          success: false,
          error: 'Qayta urinib ko\'ring.',
          code: 'CODE_CLASH',
        });
      }

      console.error('[KIOSK book]', e);
      res.status(500).json({ success: false, error: 'Bron qilishda xatolik. Registraturaga murojaat qiling.' });
    } finally {
      client.release();
    }
  });

  // ============================================================
  // STATSIONAR (yotib davolanish)
  //
  // MUHIM: bemor aniq koykani O'ZI TANLAMAYDI. Kimni qaysi palataga
  // yotqizish — klinik va ma'muriy qaror (jinsi, tashxisi, infeksiya
  // xavfi, shifokor qarori). Kiosk faqat:
  //   1) bo'sh joy borligini ko'rsatadi (raqam, kim yotganini emas)
  //   2) so'rov qoldiradi — xodim /wards sahifasida tasdiqlab, koyka
  //      tayinlaydi
  // ============================================================

  // GET /api/kiosk/wards — bo'limlar bo'yicha bo'sh joy soni
  router.get('/wards', deviceAuth, async (req, res) => {
    try {
      const rows = await q(
        `SELECT w.id, w.name, w.department,
                COUNT(b.id)::int AS total,
                COUNT(b.id) FILTER (WHERE b.status = 'free')::int AS free
           FROM wards w
           LEFT JOIN beds b ON b.ward_id = w.id
          WHERE w.tenant_id = $1
          GROUP BY w.id, w.name, w.department
          ORDER BY w.name`,
        [req.kioskTenantId]
      );
      res.json({ success: true, wards: rows });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // POST /api/kiosk/admission-request — yotqizish so'rovi
  const admissionSchema = z.object({
    session_id: z.string().uuid(),
    patient_name: z.string().min(2).max(200),
    phone: z.string().min(9).max(20),
    ward_id: z.string().uuid().optional(),
    complaint: z.string().max(1000).optional(),
  });

  router.post('/admission-request', deviceAuth, async (req, res) => {
    if (!checkRate(`adm:${req.kioskDevice.id}`, 5, 60_000)) {
      return res.status(429).json({ success: false, error: 'Juda ko\'p so\'rov. Registraturaga murojaat qiling.' });
    }
    const parsed = admissionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Ma\'lumot to\'liq emas' });
    }
    const a = parsed.data;
    const client = await pool.connect();
    try {
      const tenantId = req.kioskTenantId;
      await client.query('BEGIN');

      // Bemor kartasi — bron bilan bir xil upsert mantiqi
      const phone = normalizePhone(a.phone);
      let patientId = null;
      const existing = (await client.query(
        `SELECT id FROM patients WHERE tenant_id = $1 AND phone = $2`,
        [tenantId, phone]
      )).rows[0];
      if (existing) {
        patientId = existing.id;
      } else {
        const [fn, ...rest] = a.patient_name.trim().split(/\s+/);
        const newId = uuidv4();
        const year = new Date().getFullYear();
        const last = (await client.query(
          `SELECT medical_record_number AS mrn FROM patients
            WHERE tenant_id = $1 AND medical_record_number LIKE $2
            ORDER BY medical_record_number DESC LIMIT 1`,
          [tenantId, `${year}-%`]
        )).rows[0];
        const next = last?.mrn ? (parseInt(String(last.mrn).slice(5), 10) || 0) + 1 : 1;
        await client.query(
          `INSERT INTO patients (id, tenant_id, first_name, last_name, phone, medical_record_number)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [newId, tenantId, fn || 'Bemor', rest.join(' ') || '', phone,
           `${year}-${String(next).padStart(6, '0')}`]
        );
        patientId = newId;
      }

      // Takroriy so'rovni oldini olamiz — bemor sabrsizlanib bir necha
      // marta bosishi mumkin
      const dup = (await client.query(
        `SELECT id FROM admissions
          WHERE tenant_id = $1 AND patient_id = $2 AND status = 'requested'
            AND created_at > NOW() - INTERVAL '6 hours'
          LIMIT 1`,
        [tenantId, patientId]
      )).rows[0];
      if (dup) {
        await client.query('ROLLBACK');
        return res.status(200).json({
          success: true,
          already: true,
          message: 'So\'rovingiz allaqachon qabul qilingan. Registraturaga murojaat qiling.',
        });
      }

      // bed_id ATAYLAB bo'sh: koykani xodim tayinlaydi
      const admId = uuidv4();
      await client.query(
        `INSERT INTO admissions
           (id, tenant_id, patient_id, patient_name, patient_phone,
            ward_id, admission_date, admission_type, status, notes)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),'rejali','requested',$7)`,
        [admId, tenantId, patientId, a.patient_name, phone,
         a.ward_id || null,
         a.complaint ? `Kiosk so'rovi: ${a.complaint}` : 'Kiosk orqali yotqizish so\'rovi']
      );

      await client.query(
        `UPDATE kiosk_sessions SET step_reached = 'admission_request', patient_id = $1, finished_at = NOW()
          WHERE id = $2 AND tenant_id = $3`,
        [patientId, a.session_id, tenantId]
      ).catch(() => {});

      await client.query('COMMIT');
      res.status(201).json({
        success: true,
        already: false,
        message: 'So\'rovingiz qabul qilindi. Registraturaga o\'ting.',
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[KIOSK admission]', e);
      res.status(500).json({ success: false, error: 'Xatolik. Registraturaga murojaat qiling.' });
    } finally {
      client.release();
    }
  });

  // POST /api/kiosk/checkin — bemor kelganini o'zi tasdiqlaydi (access_code
  // bilan). Registratura va Telegramdagi bir xil funksiyani chaqiradi
  // (backend/services/appointment-checkin.js) — natija har doim bir xil.
  const checkinSchema = z.object({
    access_code: z.string().trim().min(4).max(12),
  });

  router.post('/checkin', deviceAuth, async (req, res) => {
    if (!checkRate(`checkin:${req.kioskDevice.id}`, 20, 60_000)) {
      return res.status(429).json({ success: false, error: 'Juda ko\'p urinish. Registraturaga murojaat qiling.' });
    }
    const parsed = checkinSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Kirish kodi noto\'g\'ri' });
    }
    try {
      const r = await checkInAppointment(pool, {
        tenantId: req.kioskTenantId,
        accessCode: parsed.data.access_code,
        source: 'kiosk',
      });
      res.json({
        success: true,
        already: r.already,
        queue_position: r.queue_position ?? null,
        appointment: {
          patient_name: r.appointment.patient_name,
          doctor_name: r.appointment.doctor_name,
          scheduled_at: r.appointment.scheduled_at,
        },
        message: r.already
          ? 'Siz allaqachon kelganingizni belgilagansiz.'
          : r.queue_position
            ? `Xush kelibsiz! Navbatda ${r.queue_position}-o'rindasiz.`
            : 'Xush kelibsiz! Navbatga qo\'shildingiz.',
      });
    } catch (e) {
      res.status(e.status || 500).json({ success: false, error: e.message, code: e.code });
    }
  });

  // GET /api/kiosk/queue — kutish zali TV ekrani uchun
  //
  // FILTR TARIXI: avval `status IN ('scheduled','in_progress') AND
  // payment_status='paid'` edi. Real ma'lumotda bronlar 'confirmed'+'paid'
  // yoki 'scheduled'+'pending' bo'lgani uchun ekran DOIM bo'sh turardi.
  // Keyin bugungi faol bronlarning hammasi ko'rsatildi — lekin bu ham
  // noto'g'ri edi: bron qilib KELMAGAN bemorlar ham "navbatda" ko'rinardi,
  // bu haqiqiy navbat uzunligini bilib bo'lmaydigan qilardi.
  //
  // Endi: faqat arrived_at bor (ya'ni jismonan KELGAN) bemorlar ko'rinadi.
  // Har biriga taxminiy kutish vaqti hisoblanadi — o'sha shifokorda
  // undan oldin kutayotganlar soni x xizmat davomiyligi.
  //
  // 2026-08: walk-in bemorlar ham qo'shildi — registraturada jonli
  // navbatga qo'yilganlar (patient_queue). Dublikatlar telefon+ism
  // bo'yicha tozalanadi (queue-service.dedupeKey — /queue/live bilan bir xil).
  router.get('/queue', deviceAuth, async (req, res) => {
    try {
      const rows = await q(
        `SELECT a.id, a.access_code, a.patient_name, a.phone, a.scheduled_at, a.status,
                a.arrived_at, a.payment_status, a.doctor_id, a.doctor_name, d.specialization,
                COALESCE(s.duration_min, 20) AS duration_min
           FROM appointments a
           LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
           LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1
            AND date(a.scheduled_at) = CURRENT_DATE
            AND a.status IN ('scheduled','confirmed','in_progress')
            AND a.arrived_at IS NOT NULL
          LIMIT 30`,
        [req.kioskTenantId]
      );

      // Walk-in: bron qilmagan, registraturada navbatga qo'yilgan bemorlar.
      const walkins = await q(
        `SELECT id, queue_number, patient_name, phone, doctor, status, created_at
           FROM patient_queue
          WHERE tenant_id = $1 AND status IN ('waiting', 'in_progress')`,
        [req.kioskTenantId]
      );
      const seen = new Set(rows.map((r) => dedupeKey(r.patient_name, r.phone)));
      const merged = [...rows];
      for (const w of walkins) {
        if (seen.has(dedupeKey(w.patient_name, w.phone))) continue;
        seen.add(dedupeKey(w.patient_name, w.phone));
        merged.push({
          access_code: null,
          queue_number: w.queue_number,
          patient_name: w.patient_name,
          scheduled_at: w.created_at,
          status: w.status,
          arrived_at: w.created_at,
          payment_status: 'pending',
          doctor_id: null,
          doctor_name: w.doctor || 'Qabul',
          specialization: null,
          duration_min: 20,
          walk_in: true,
        });
      }
      // Tartib: qabuldagilar tepada, keyin kim OLDIN kelgan bo'lsa shu oldin
      merged.sort((a, b) => {
        const pa = a.status === 'in_progress' ? 0 : 1;
        const pb = b.status === 'in_progress' ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return new Date(a.arrived_at).getTime() - new Date(b.arrived_at).getTime();
      });

      // Taxminiy kutish — har shifokor uchun alohida hisoblanadi: undan
      // oldin (in_progress yoki undan oldin kelgan) nechta bemor bo'lsa,
      // shularning xizmat davomiyligi yig'indisi.
      const aheadByDoctor = new Map();
      const withWait = merged.map((r) => {
        const key = r.doctor_id || r.doctor_name;
        const waitedSoFar = aheadByDoctor.get(key) || 0;
        const isWaiting = r.status !== 'in_progress';
        const waitMinutes = isWaiting ? waitedSoFar : 0;
        aheadByDoctor.set(key, waitedSoFar + (r.duration_min || 20));
        return { ...r, wait_minutes: waitMinutes };
      });

      // PII: to'liq ism ko'rsatilmaydi — kod + familiya bosh harfi
      res.json({
        success: true,
        queue: withWait.map((r) => {
          const parts = String(r.patient_name || '').trim().split(/\s+/);
          return {
            // Walk-in bemorda access_code yo'q — navbat raqami ko'rsatiladi
            code: r.access_code || `N${r.queue_number}`,
            display_name: parts.length > 1
              ? `${parts[0]} ${parts[1][0]}.`
              : (parts[0] || '—'),
            time: new Date(r.scheduled_at).toISOString(),
            doctor: r.doctor_name,
            department: r.specialization,
            status: r.status,
            paid: r.payment_status === 'paid',
            walk_in: !!r.walk_in,
            wait_minutes: r.wait_minutes,
          };
        }),
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Chaqirilayotgan bemorlar ro'yxati — /queue/announce va
  // /queue/announce/audio ikkalasi ham shu funksiyani ishlatadi.
  async function fetchAnnouncementCalls(tenantId) {
    const rows = await q(
      `SELECT a.access_code, a.patient_name, a.doctor_name, a.status
         FROM appointments a
        WHERE a.tenant_id = $1
          AND date(a.scheduled_at) = CURRENT_DATE
          AND a.status = 'in_progress'
          AND a.arrived_at IS NOT NULL
        ORDER BY a.arrived_at DESC LIMIT 5`,
      [tenantId]
    );
    const walkins = await q(
      `SELECT queue_number, patient_name, doctor, status
         FROM patient_queue
        WHERE tenant_id = $1 AND status = 'in_progress'
        ORDER BY created_at DESC LIMIT 5`,
      [tenantId]
    );
    return [
      ...rows.map((r) => ({
        code: r.access_code,
        doctor: r.doctor_name,
        text: buildCallAnnouncement(r),
      })),
      ...walkins.map((r) => ({
        code: `N${r.queue_number}`,
        doctor: r.doctor || 'Qabul',
        text: buildCallAnnouncement({
          patient_name: r.patient_name, doctor_name: r.doctor, queue_number: r.queue_number,
        }),
      })),
    ].filter((c) => c.text);
  }

  // GET /api/kiosk/queue/announce — ovozli chaqiruv matni (TTS uchun).
  // TV/karnay tizimi shu matnni oladi va TTS dvigatelida (masalan
  // OmniVoice — uz/uzn tillarini qo'llaydi) o'qib beradi.
  // Chaqiriladiganlar: qabulga kirayotgan (in_progress) bemorlar.
  router.get('/queue/announce', deviceAuth, async (req, res) => {
    try {
      const calls = await fetchAnnouncementCalls(req.kioskTenantId);
      res.json({ success: true, total: calls.length, calls, tts_enabled: isTtsEnabled() });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // GET /api/kiosk/queue/announce/audio — tayyor WAV (24kHz mono).
  // Barcha chaqiruvlar bitta audioga birlashtiriladi. TTS o'chiq
  // bo'lsa 503 + TTS_DISABLED — TV shunda ham matnni ko'rsatadi.
  router.get('/queue/announce/audio', deviceAuth, async (req, res) => {
    if (!isTtsEnabled()) {
      return res.status(503).json({ success: false, code: 'TTS_DISABLED', error: 'TTS xizmati ulanmagan (TTS_URL)' });
    }
    try {
      const calls = await fetchAnnouncementCalls(req.kioskTenantId);
      if (calls.length === 0) {
        return res.status(404).json({ success: false, code: 'NO_CALLS', error: 'Hozircha chaqiruv yo\'q' });
      }
      const bufs = [];
      for (const c of calls) {
        const b = await synthesize(c.text, { voice: process.env.TTS_VOICE || undefined });
        if (b) bufs.push(b);
      }
      if (bufs.length === 0) {
        return res.status(502).json({ success: false, code: 'TTS_UNAVAILABLE', error: 'TTS xizmatiga ulanib bo\'lmadi' });
      }
      const wav = concatWavBuffers(bufs);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'no-store');
      res.send(wav);
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
    // 'attendance' — klinika kompyuteridagi davomat agenti. Kiosk emas,
    // lekin qurilma tokeni tizimi bir xil, shuning uchun shu jadvalda.
    kind: z.enum(['entry', 'queue_tv', 'result', 'attendance']).default('entry'),
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
