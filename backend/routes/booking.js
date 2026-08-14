/**
 * Yagona booking API — reception, Telegram Mini App (bemor) va agentlar bir xil
 * `appointments` jadvaliga yozadi. Shu tufayli to'qnashuv oldini olish (partial
 * unique index) BARCHA kanallar bo'ylab ishlaydi: Telegramdan bron qilingan vaqt
 * reception bilan to'qnasha olmaydi va aksincha.
 *
 * Ikki kirish darajasi:
 *  - Xodim (staff): /slots, /create, /by-code — authMiddleware / telegramOrJwtAuth
 *  - Bemor (public): /public/doctors, /public/services, /public/slots, /public/create
 *    — autentifikatsiyasiz (Telegram Mini App ochiq bron formasi), rate-limit bilan.
 *
 * To'lov turlari:
 *  - online   — Payme/Click link, veb-hook to'lovni tasdiqlaydi
 *  - cashier  — klinikada. Bemorga qisqa access_code (kassir shu kod bo'yicha topadi).
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { createPayment } from '../services/payment-gateway.js';
import { upsertPatientByPhone } from '../services/patient-store.js';
import { checkInAppointment } from '../services/appointment-checkin.js';

// Telegram "Men keldim" tugmasi — autentifikatsiyasiz, shuning uchun
// access_code brute-force'iga qarshi oddiy IP bo'yicha limit.
const checkinRateBuckets = new Map();
function checkinRateOk(key, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const b = checkinRateBuckets.get(key) || { n: 0, reset: now + windowMs };
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  b.n += 1;
  checkinRateBuckets.set(key, b);
  return b.n <= limit;
}

// I/O/1/0 chalkashmasin
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateAccessCode(len = 6) {
  let s = '';
  const buf = new Uint8Array(len);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(buf);
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return s;
}

const slotsQuery = z.object({
  doctor_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  service_id: z.string().uuid().optional(),
  // Bir nechta xizmat: "uuid,uuid" — davomiylik yig'indisi olinadi
  service_ids: z.string().optional(),
});

// Bemor bir kelishida bir nechta xizmat olishi mumkin (UZI + tahlil + qabul).
// Eski `service_id` (bitta) ham ishlayveradi — orqaga moslik.
const createSchema = z.object({
  patient_name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(50).optional().nullable(),
  doctor_id: z.string().uuid(),
  service_id: z.string().uuid().optional(),
  service_ids: z.array(z.string().uuid()).min(1).max(20).optional(),
  scheduled_at: z.string().datetime(),
  payment_method: z.enum(['online', 'cashier']),
  source: z.enum(['reception', 'telegram', 'call', 'walk_in']).default('reception'),
  telegram_id: z.union([z.string(), z.number()]).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  provider: z.enum(['payme', 'click', 'uzum', 'auto']).optional(),
  // Yashash joyi — tuman ro'yxatdan, mahalla erkin matn
  region: z.string().trim().max(60).optional().nullable(),
  district: z.string().trim().max(80).optional().nullable(),
  mahalla: z.string().trim().max(120).optional().nullable(),
}).refine((d) => d.service_id || (d.service_ids && d.service_ids.length), {
  message: 'Kamida bitta xizmat tanlanishi kerak',
});

/** So'rovdagi xizmat ro'yxatini yagona ko'rinishga keltiradi (tartib saqlanadi, takror olib tashlanadi) */
function normalizeServiceIds(d) {
  const list = d.service_ids?.length ? d.service_ids : (d.service_id ? [d.service_id] : []);
  return [...new Set(list)];
}

export default function bookingRoutes(pool, authMiddleware, telegramOrJwtAuth, serverError) {
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

  // Bemor (public) so'rovi uchun tenant: ?clinic=<id|code>, aks holda 'default'.
  // Production hozircha yagona 'default' tenant — ko'p klinika bo'lganda code orqali.
  async function resolvePublicTenant(req) {
    const clinic = String(req.query.clinic || req.body?.clinic || '').trim();
    if (!clinic) return 'default';
    const row = await qGet('SELECT id FROM tenants WHERE id = $1 OR code = $2 LIMIT 1', [clinic, clinic]);
    return row?.id || 'default';
  }

  // ---- Umumiy: bo'sh vaqtlarni hisoblash ----
  // serviceIds — bir nechta xizmat bo'lsa, davomiylik va summa yig'iladi
  async function computeSlots(tenantId, doctor_id, date, serviceIds = []) {
    const doctor = await qGet(
      'SELECT id, first_name, last_name, specialization FROM doctors WHERE tenant_id = $1 AND id = $2',
      [tenantId, doctor_id]
    );
    if (!doctor) return { status: 404, body: { success: false, error: 'Shifokor topilmadi' } };

    let stepMin = 30;
    let serviceAmount = 0;
    if (serviceIds.length) {
      const svcs = await q(
        'SELECT id, price::float8 AS price, duration_min FROM services_catalog WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND active = TRUE',
        [tenantId, serviceIds]
      );
      if (svcs.length !== serviceIds.length) {
        return { status: 404, body: { success: false, error: 'Xizmat topilmadi yoki faol emas' } };
      }
      stepMin = svcs.reduce((sum, s) => sum + (s.duration_min || 30), 0);
      serviceAmount = svcs.reduce((sum, s) => sum + (s.price || 0), 0);
    }

    // day_of_week — Postgres 0=Yakshanba .. 6=Shanba
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    const sched = await qGet(
      'SELECT start_time, end_time, slot_duration FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3',
      [tenantId, doctor_id, dow]
    );
    if (!sched) {
      return { status: 200, body: { success: true, doctor_id, date, slots: [], reason: 'Bu kunga jadval yo\'q' } };
    }

    const step = Math.max(5, serviceIds.length ? stepMin : (sched.slot_duration || 30));
    const [sh, sm] = sched.start_time.split(':').map(Number);
    const [eh, em] = sched.end_time.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    const busy = await q(
      `SELECT scheduled_at FROM appointments
       WHERE tenant_id = $1 AND doctor_id = $2
         AND scheduled_at::date = $3::date
         AND status NOT IN ('cancelled', 'no_show')`,
      [tenantId, doctor_id, date]
    );
    const busySet = new Set(busy.map((b) => new Date(b.scheduled_at).toISOString()));

    const slots = [];
    const now = Date.now();
    for (let m = startMin; m + step <= endMin; m += step) {
      const hh = String(Math.floor(m / 60)).padStart(2, '0');
      const mm = String(m % 60).padStart(2, '0');
      const dt = new Date(`${date}T${hh}:${mm}:00`);
      const iso = dt.toISOString();
      slots.push({ time: `${hh}:${mm}`, scheduled_at: iso, available: !busySet.has(iso) && dt.getTime() >= now });
    }
    return {
      status: 200,
      body: {
        success: true,
        doctor: { id: doctor.id, name: `${doctor.first_name} ${doctor.last_name || ''}`.trim(), specialization: doctor.specialization },
        date, step_min: step, amount: serviceAmount, slots,
      },
    };
  }

  // ---- Umumiy: atomik yozilish (retry + tranzaksiya + to'lov + Telegram) ----
  async function handleCreate(req, res, tenantId, d) {
    if (!tenantId) return res.status(400).json({ success: false, error: 'Tenant aniqlanmadi' });
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      try {
        const serviceIds = normalizeServiceIds(d);
        const [svcRows, doc] = await Promise.all([
          q('SELECT id, name, price::float8 AS price, duration_min, specialty FROM services_catalog WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND active = TRUE', [tenantId, serviceIds]),
          qGet('SELECT id, first_name, last_name, specialization FROM doctors WHERE tenant_id = $1 AND id = $2', [tenantId, d.doctor_id]),
        ]);
        if (svcRows.length !== serviceIds.length) {
          return res.status(404).json({ success: false, error: 'Xizmat topilmadi yoki faol emas' });
        }
        if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });

        // So'rovdagi tartibni saqlaymiz — birinchisi asosiy xizmat hisoblanadi
        const services = serviceIds.map((id) => svcRows.find((s) => s.id === id));
        const svc = services[0];
        const totalAmount = services.reduce((sum, s) => sum + (s.price || 0), 0);
        const summary = services.length > 1
          ? `${svc.name} +${services.length - 1} ta xizmat`
          : svc.name;

        const scheduledAt = new Date(d.scheduled_at);
        if (scheduledAt.getTime() < Date.now() - 60_000) {
          return res.status(400).json({ success: false, error: 'O\'tgan vaqtga yozib bo\'lmaydi' });
        }

        const appointmentId = 'A' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
        const accessCode = generateAccessCode(6);

        // Bemor kartasini telefon bo'yicha bog'laymiz (yo'q bo'lsa MRN bilan ochiladi).
        // Bu bir bemorning barcha bronlarini istoriyaga yig'ish uchun.
        // Xato bo'lsa null qaytadi — bron baribir davom etadi.
        const patientId = d.patient_id || await upsertPatientByPhone(pool, tenantId, {
          phone: d.phone,
          patient_name: d.patient_name,
          district: d.district,
          address: d.mahalla,
        });

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const apptRow = await client.query(
            `INSERT INTO appointments
               (tenant_id, appointment_id, patient_id, patient_name, phone, doctor_id, doctor_name,
                service_id, scheduled_at, amount, department, source, status, payment_status,
                payment_method, access_code, notes, region, district, mahalla)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'scheduled','pending',$13,$14,$15,$16,$17,$18)
             RETURNING id, appointment_id, access_code`,
            [
              tenantId, appointmentId, patientId, d.patient_name, d.phone || null,
              d.doctor_id, `${doc.first_name} ${doc.last_name || ''}`.trim(),
              svc.id, scheduledAt, totalAmount, doc.specialization || 'therapy',
              d.source, d.payment_method, accessCode, d.notes || null,
              d.region || null, d.district || null, d.mahalla || null,
            ]
          );
          const appt = apptRow.rows[0];

          // Barcha xizmatlar — nomi va narxi SNAPSHOT sifatida (narx keyin
          // o'zgarsa ham eski chek o'zgarmasligi kerak)
          for (const s of services) {
            await client.query(
              `INSERT INTO appointment_services (tenant_id, appointment_id, service_id, name, price, duration_min)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [tenantId, appt.id, s.id, s.name, s.price || 0, s.duration_min || null]
            );
          }

          let paymentUrl = null;
          let paymentId = null;
          if (d.payment_method === 'online') {
            paymentId = uuidv4();
            await client.query(
              `INSERT INTO payment_transactions
                 (id, tenant_id, appointment_id, amount, description, provider, status, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())`,
              [paymentId, tenantId, appt.id, totalAmount, `${summary} — ${d.patient_name}`, d.provider || 'auto']
            );
          }

          // AUTO-AGENT: triage — bemor shikoyat (notes) bo'lsa, urgency va ixtisos
          // tavsiyasini yozamiz. Fire-and-forget: bron javobini kutkuzmaymiz.
          if (d.notes && d.notes.length > 5) {
            (async () => {
              try {
                const { triageAgent } = await import('../../ai/agents/time-savers.js');
                const t = await triageAgent.handler({ complaint: d.notes });
                await pool.query(
                  `UPDATE appointments SET triage_severity = $1, triage_json = $2::jsonb WHERE id = $3`,
                  [t.severity, JSON.stringify(t), appt.id]
                );
              } catch (e) { console.warn('[TIME_SAVER triage]', e.message); }
            })();
          }

          await client.query('COMMIT');

          if (d.payment_method === 'online' && paymentId) {
            const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
            const payment = await createPayment({
              amount: totalAmount,
              description: `${summary} — ${d.patient_name}`,
              orderId: paymentId,
              returnUrl: `${baseUrl}/qr-pay.html?order=${paymentId}`,
              provider: d.provider || 'auto',
            }).catch((e) => ({ success: false, error: e.message }));
            if (payment?.success && payment?.paymentUrl) {
              paymentUrl = payment.paymentUrl;
              await q('UPDATE payment_transactions SET payment_url = $1, provider = $2 WHERE id = $3',
                [paymentUrl, payment.provider, paymentId]);
            }
          }

          if (d.telegram_id && req.app.locals.patientBot) {
            const dt = scheduledAt.toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' });
            const priceStr = (svc.price || 0).toLocaleString('uz-UZ') + " so'm";
            let msg = `✅ Yozildingiz!\n\n👨‍⚕️ ${doc.first_name} ${doc.last_name || ''}\n🩺 ${svc.name}\n📅 ${dt}\n💰 ${priceStr}\n`;
            const buttons = [];
            if (d.payment_method === 'online' && paymentUrl) {
              msg += `\n🔗 Onlayn to'lov havolasi ochilsin.`;
              buttons.push([{ text: '💳 To\'lash', url: paymentUrl }]);
            } else {
              msg += `\n🎫 Kassaga kod: *${accessCode}*\nKlinikaga kelib shu kodni ayting.`;
            }
            req.app.locals.patientBot.telegram
              .sendMessage(String(d.telegram_id), msg, {
                parse_mode: 'Markdown',
                reply_markup: buttons.length ? { inline_keyboard: buttons } : undefined,
              })
              .catch((e) => console.warn('[BOOKING] Telegram xabar xatosi:', e.message));
          }

          return res.status(201).json({
            success: true,
            appointment: {
              id: appt.id,
              appointment_id: appt.appointment_id,
              access_code: appt.access_code,
              doctor_name: `${doc.first_name} ${doc.last_name || ''}`.trim(),
              service_name: summary,
              services: services.map((s) => ({ id: s.id, name: s.name, price: s.price })),
              scheduled_at: scheduledAt.toISOString(),
              amount: totalAmount,
              payment_method: d.payment_method,
            },
            payment: d.payment_method === 'online'
              ? { payment_id: paymentId, payment_url: paymentUrl, status: 'pending' }
              : { access_code: appt.access_code, note: 'Kassaga shu kod bilan boring' },
          });
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          if (err.code === '23505' && String(err.constraint || '').includes('appointments_doctor_slot_unique')) {
            return res.status(409).json({ success: false, error: 'Bu vaqt endi band. Iltimos, boshqa vaqt tanlang.', code: 'SLOT_TAKEN' });
          }
          if (err.code === '23505' && String(err.constraint || '').includes('appointments_access_code_unique')) {
            continue; // access code takrorlandi — qayta urinamiz
          }
          throw err;
        } finally {
          client.release();
        }
      } catch (e) {
        return serverError(res, e);
      }
    }
    return res.status(500).json({ success: false, error: 'Access code yaratib bo\'lmadi, qayta urinib ko\'ring' });
  }

  // ============================================================
  // XODIM (staff) — autentifikatsiyalangan
  // ============================================================

  router.get('/slots', authMiddleware, async (req, res) => {
    try {
      const parsed = slotsQuery.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ success: false, error: 'Noto\'g\'ri parametrlar' });
      const { doctor_id, date, service_id, service_ids } = parsed.data;
      const ids = service_ids ? service_ids.split(',').map((x) => x.trim()).filter(Boolean)
                              : (service_id ? [service_id] : []);
      const r = await computeSlots(tid(req), doctor_id, date, ids);
      res.status(r.status).json(r.body);
    } catch (e) { serverError(res, e); }
  });

  // telegramOrJwtAuth() — factory, argumentsiz chaqiramiz (staff yoki xodim-Telegram)
  router.post('/create', telegramOrJwtAuth(), async (req, res) => {
    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Noto\'g\'ri ma\'lumot', details: parsed.error.flatten() });
    }
    await handleCreate(req, res, tid(req), parsed.data);
  });

  // GET /list?date=YYYY-MM-DD&status= — reception dashboard uchun kunlik bronlar
  router.get('/list', authMiddleware, async (req, res) => {
    try {
      const tenantId = tid(req);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || '')) ? req.query.date : null;
      const params = [tenantId];
      let where = 'a.tenant_id = $1';
      if (date) { params.push(date); where += ` AND a.scheduled_at::date = $${params.length}::date`; }
      if (req.query.status) { params.push(String(req.query.status)); where += ` AND a.status = $${params.length}`; }
      if (req.query.payment_status) { params.push(String(req.query.payment_status)); where += ` AND a.payment_status = $${params.length}`; }
      const rows = await q(
        `SELECT a.id, a.appointment_id, a.patient_name, a.phone, a.doctor_name,
                a.scheduled_at, a.amount::float8 AS amount, a.status, a.payment_status,
                a.payment_method, a.access_code, a.source, a.district, a.mahalla, s.name AS service_name,
                a.arrived_at, a.checked_in_source,
                (SELECT COUNT(*) FROM appointment_services x
                  WHERE x.tenant_id = a.tenant_id AND x.appointment_id = a.id)::int AS service_count
         FROM appointments a
         LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
         WHERE ${where}
         ORDER BY a.scheduled_at NULLS LAST, a.created_at DESC
         LIMIT 200`,
        params
      );
      res.json({ success: true, total: rows.length, appointments: rows });
    } catch (e) { serverError(res, e); }
  });

  // POST /checkin — qabulxona xodimi bemor kelganini bosib belgilaydi.
  // Kiosk (/api/kiosk/checkin) va Telegram (/public/checkin) bilan BITTA
  // xizmat funksiyasini chaqiradi — natija va xatolar bir xil.
  const staffCheckinSchema = z.object({ id: z.union([z.string(), z.number()]) });
  router.post('/checkin', authMiddleware, async (req, res) => {
    const parsed = staffCheckinSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, error: 'id kerak' });
    try {
      const r = await checkInAppointment(pool, {
        tenantId: tid(req),
        appointmentId: parsed.data.id,
        source: 'registratura',
        actorUserId: req.user?.id || null,
      });
      res.json({ success: true, already: r.already, appointment: r.appointment });
    } catch (e) {
      res.status(e.status || 500).json({ success: false, error: e.message, code: e.code });
    }
  });

  // POST /cancel — bronni bekor qilish (slot bo'shaydi, partial index tufayli)
  router.post('/cancel', authMiddleware, async (req, res) => {
    try {
      const id = req.body?.id;
      if (!id) return res.status(400).json({ success: false, error: 'id kerak' });
      const row = await qGet(
        "UPDATE appointments SET status = 'cancelled' WHERE tenant_id = $1 AND id = $2 AND status NOT IN ('cancelled') RETURNING id",
        [tid(req), id]
      );
      if (!row) return res.status(404).json({ success: false, error: 'Yozuv topilmadi yoki allaqachon bekor qilingan' });
      res.json({ success: true, cancelled: row.id });
    } catch (e) { serverError(res, e); }
  });

  // GET /mahallas?district=X — avval kiritilgan mahallalar (autocomplete).
  // Rasmiy respublika ro'yxati tizimda yo'q, shuning uchun takliflar klinikaning
  // o'z yozuvlaridan yig'iladi — vaqt o'tgani sari ro'yxat boyib boradi.
  router.get('/mahallas', authMiddleware, async (req, res) => {
    try {
      const params = [tid(req)];
      let where = "tenant_id = $1 AND mahalla IS NOT NULL AND mahalla <> ''";
      if (req.query.district) {
        params.push(String(req.query.district));
        where += ` AND district = $${params.length}`;
      }
      const rows = await q(
        `SELECT mahalla, COUNT(*)::int AS uses FROM appointments
         WHERE ${where} GROUP BY mahalla ORDER BY uses DESC, mahalla LIMIT 200`,
        params
      );
      res.json({ success: true, mahallas: rows.map((r) => r.mahalla) });
    } catch (e) { serverError(res, e); }
  });

  // GET /by-code/:code — kassir Telegramdan kelgan bemorni topadi
  router.get('/by-code/:code', authMiddleware, async (req, res) => {
    try {
      const code = String(req.params.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(code)) return res.status(400).json({ success: false, error: 'Kod noto\'g\'ri' });
      const row = await qGet(
        `SELECT a.id, a.appointment_id, a.patient_name, a.phone, a.scheduled_at, a.amount::float8 AS amount,
                a.status, a.payment_status, a.payment_method, a.access_code,
                a.doctor_name, s.name AS service_name
         FROM appointments a
         LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND a.access_code = $2`,
        [tid(req), code]
      );
      if (!row) return res.status(404).json({ success: false, error: 'Kod bo\'yicha yozuv topilmadi' });
      res.json({ success: true, appointment: row });
    } catch (e) { serverError(res, e); }
  });

  // ============================================================
  // BEMOR (public) — Telegram Mini App ochiq bron formasi
  // ============================================================

  // GET /public/doctors — klinika shifokorlari (bron uchun)
  router.get('/public/doctors', async (req, res) => {
    try {
      const tenantId = await resolvePublicTenant(req);
      const rows = await q(
        `SELECT id, first_name, last_name, specialty, specialization
         FROM doctors WHERE tenant_id = $1 AND (status IS NULL OR status = 'Faol') ORDER BY first_name`,
        [tenantId]
      );
      res.json({ success: true, doctors: rows });
    } catch (e) { serverError(res, e); }
  });

  // GET /public/services — faol xizmatlar (narx bilan), ixtiyoriy specialty filtri
  router.get('/public/services', async (req, res) => {
    try {
      const tenantId = await resolvePublicTenant(req);
      const params = [tenantId];
      let where = 'tenant_id = $1 AND active = TRUE';
      if (req.query.specialty) { params.push(String(req.query.specialty).trim().toLowerCase()); where += ` AND specialty = $${params.length}`; }
      const rows = await q(
        `SELECT id, name, category, specialty, icon, price::float8 AS price, duration_min
         FROM services_catalog WHERE ${where} ORDER BY category NULLS LAST, name`,
        params
      );
      res.json({ success: true, services: rows });
    } catch (e) { serverError(res, e); }
  });

  // GET /public/slots — bo'sh vaqtlar (bemor uchun)
  router.get('/public/slots', async (req, res) => {
    try {
      const parsed = slotsQuery.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ success: false, error: 'Noto\'g\'ri parametrlar' });
      const tenantId = await resolvePublicTenant(req);
      const { doctor_id, date, service_id, service_ids } = parsed.data;
      const ids = service_ids ? service_ids.split(',').map((x) => x.trim()).filter(Boolean)
                              : (service_id ? [service_id] : []);
      const r = await computeSlots(tenantId, doctor_id, date, ids);
      res.status(r.status).json(r.body);
    } catch (e) { serverError(res, e); }
  });

  // POST /public/create — bemor o'zi bron qiladi (autentifikatsiyasiz).
  // source majburan 'telegram' — reception bilan bir xil jadval, shuning uchun
  // to'qnashuv oldini olish avtomatik ishlaydi.
  router.post('/public/create', async (req, res) => {
    // Eslatma: .omit() zod v4'da refine'li schemada crash beradi (EAI —
    // "/public/create" 500 bilan yiqilib, req.app restart bo'lardi). source
    // requestdan qat'i nazar quyida keyingi satrda majburan o'zgartiriladi,
    // shuning uchun omit shart emas.
    const parsed = createSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Noto\'g\'ri ma\'lumot', details: parsed.error.flatten() });
    }
    const tenantId = await resolvePublicTenant(req);
    await handleCreate(req, res, tenantId, { ...parsed.data, source: 'telegram' });
  });

  // POST /public/checkin — bemor Telegram Mini App'da "Men keldim" bosadi.
  // Kiosk va registratura bilan BIR XIL xizmat funksiyasi chaqiriladi.
  const publicCheckinSchema = z.object({ access_code: z.string().trim().min(4).max(12) });
  router.post('/public/checkin', async (req, res) => {
    const ip = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    if (!checkinRateOk(`pub-checkin:${ip}`)) {
      return res.status(429).json({ success: false, error: 'Juda ko\'p urinish. Birozdan keyin qayta urinib ko\'ring.' });
    }
    const parsed = publicCheckinSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Kod noto\'g\'ri' });
    try {
      const tenantId = await resolvePublicTenant(req);
      const r = await checkInAppointment(pool, {
        tenantId,
        accessCode: parsed.data.access_code,
        source: 'telegram',
      });
      res.json({
        success: true,
        already: r.already,
        appointment: r.appointment,
        message: r.already ? 'Siz allaqachon kelganingizni belgilagansiz.' : 'Xush kelibsiz! Navbatga qo\'shildingiz.',
      });
    } catch (e) {
      res.status(e.status || 500).json({ success: false, error: e.message, code: e.code });
    }
  });

  return router;
}
