/**
 * Yagona booking API — reception, Telegram Mini App va agentlar bir xil eshikdan kiradi.
 *
 * Muhim: to'qnashuv oldini olish DB darajasida (partial unique index) — ilova
 * qatlamidagi tekshiruv race'ni to'liq oldini olmaydi. Ikki mijoz bir vaqtda bir
 * shifokorga bir slotga urinsa, ikkinchisi HTTP 409 oladi.
 *
 * To'lov turlari:
 *  - online   — Payme/Click link, veb-hook to'lovni tasdiqlaydi
 *  - cashier  — klinikada. Bemorga qisqa access_code beriladi (Telegram bo'lsa xabarga chiqadi),
 *               kassir shu kod bo'yicha topib olib to'lov qabul qiladi.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { createPayment } from '../services/payment-gateway.js';

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
});

const createSchema = z.object({
  patient_name: z.string().trim().min(1).max(255),
  phone: z.string().trim().max(50).optional().nullable(),
  doctor_id: z.string().uuid(),
  service_id: z.string().uuid(),
  scheduled_at: z.string().datetime(),
  payment_method: z.enum(['online', 'cashier']),
  source: z.enum(['reception', 'telegram', 'call', 'walk_in']).default('reception'),
  telegram_id: z.union([z.string(), z.number()]).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  provider: z.enum(['payme', 'click', 'uzum', 'auto']).optional(),
});

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

  // GET /slots — shifokor uchun kunlik bo'sh vaqtlar
  router.get('/slots', authMiddleware, async (req, res) => {
    try {
      const parsed = slotsQuery.safeParse(req.query);
      if (!parsed.success) return res.status(400).json({ success: false, error: 'Noto\'g\'ri parametrlar' });
      const { doctor_id, date, service_id } = parsed.data;
      const tenantId = tid(req);

      // Shifokor mavjudmi va shu tenantniki mi
      const doctor = await qGet(
        'SELECT id, first_name, last_name, specialization FROM doctors WHERE tenant_id = $1 AND id = $2',
        [tenantId, doctor_id]
      );
      if (!doctor) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });

      // Xizmatning davomiyligi (agar ko'rsatilgan bo'lsa)
      let stepMin = 30;
      let serviceAmount = 0;
      if (service_id) {
        const svc = await qGet(
          'SELECT price::float8 AS price, duration_min FROM services_catalog WHERE tenant_id = $1 AND id = $2 AND active = TRUE',
          [tenantId, service_id]
        );
        if (!svc) return res.status(404).json({ success: false, error: 'Xizmat topilmadi' });
        stepMin = svc.duration_min || 30;
        serviceAmount = svc.price;
      }

      // day_of_week — Postgres 0=Yakshanba .. 6=Shanba (ISO emas)
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      const sched = await qGet(
        'SELECT start_time, end_time, slot_duration FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3',
        [tenantId, doctor_id, dow]
      );
      if (!sched) return res.json({ success: true, doctor_id, date, slots: [], reason: 'Bu kunga jadval yo\'q' });

      const step = Math.max(5, service_id ? stepMin : (sched.slot_duration || 30));
      const [sh, sm] = sched.start_time.split(':').map(Number);
      const [eh, em] = sched.end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;

      // Shu kunga band slotlar (cancelled/no_show hisobga olinmaydi)
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
        // Klinika mahalliy vaqti (server TZ) — production da TZ=Asia/Tashkent
        const dt = new Date(`${date}T${hh}:${mm}:00`);
        const iso = dt.toISOString();
        const inPast = dt.getTime() < now;
        slots.push({
          time: `${hh}:${mm}`,
          scheduled_at: iso,
          available: !busySet.has(iso) && !inPast,
        });
      }

      res.json({
        success: true,
        doctor: { id: doctor.id, name: `${doctor.first_name} ${doctor.last_name || ''}`.trim(), specialization: doctor.specialization },
        date,
        step_min: step,
        amount: serviceAmount,
        slots,
      });
    } catch (e) { serverError(res, e); }
  });

  // POST /create — atomik yozilish
  router.post('/create', telegramOrJwtAuth, async (req, res) => {
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      try {
        const parsed = createSchema.safeParse(req.body || {});
        if (!parsed.success) {
          return res.status(400).json({ success: false, error: 'Noto\'g\'ri ma\'lumot', details: parsed.error.flatten() });
        }
        const d = parsed.data;
        const tenantId = tid(req);
        if (!tenantId) return res.status(400).json({ success: false, error: 'Tenant aniqlanmadi' });

        // Xizmat + shifokor (bir tenant ichida) — narx serverdan olinadi, mijoz yubormaydi
        const [svc, doc] = await Promise.all([
          qGet('SELECT id, name, price::float8 AS price, duration_min, specialty FROM services_catalog WHERE tenant_id = $1 AND id = $2 AND active = TRUE', [tenantId, d.service_id]),
          qGet('SELECT id, first_name, last_name, specialization FROM doctors WHERE tenant_id = $1 AND id = $2', [tenantId, d.doctor_id]),
        ]);
        if (!svc) return res.status(404).json({ success: false, error: 'Xizmat topilmadi yoki faol emas' });
        if (!doc) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });

        const scheduledAt = new Date(d.scheduled_at);
        if (scheduledAt.getTime() < Date.now() - 60_000) {
          return res.status(400).json({ success: false, error: 'O\'tgan vaqtga yozib bo\'lmaydi' });
        }

        const appointmentId = 'A' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();
        const accessCode = generateAccessCode(6);

        // Tranzaksiya: appointment + (agar cashier bo'lmasa) payment_transactions
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const apptRow = await client.query(
            `INSERT INTO appointments
               (tenant_id, appointment_id, patient_name, phone, doctor_id, doctor_name,
                service_id, scheduled_at, amount, department, source, status, payment_status,
                payment_method, access_code, notes)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'scheduled','pending',$12,$13,$14)
             RETURNING id, appointment_id, access_code`,
            [
              tenantId, appointmentId, d.patient_name, d.phone || null,
              d.doctor_id, `${doc.first_name} ${doc.last_name || ''}`.trim(),
              d.service_id, scheduledAt, svc.price, doc.specialization || 'therapy',
              d.source, d.payment_method, accessCode, d.notes || null,
            ]
          );
          const appt = apptRow.rows[0];

          let paymentUrl = null;
          let paymentId = null;
          if (d.payment_method === 'online') {
            paymentId = uuidv4();
            await client.query(
              `INSERT INTO payment_transactions
                 (id, tenant_id, appointment_id, amount, description, provider, status, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW())`,
              [paymentId, tenantId, appt.id, svc.price, `${svc.name} — ${d.patient_name}`, d.provider || 'auto']
            );
          }

          await client.query('COMMIT');

          // Payme/Click link — tranzaksiyadan tashqarida (tashqi API chaqiruvi)
          if (d.payment_method === 'online' && paymentId) {
            const baseUrl = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
            const payment = await createPayment({
              amount: svc.price,
              description: `${svc.name} — ${d.patient_name}`,
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

          // Telegram xabar (agar mavjud)
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
              service_name: svc.name,
              scheduled_at: scheduledAt.toISOString(),
              amount: svc.price,
              payment_method: d.payment_method,
            },
            payment: d.payment_method === 'online'
              ? { payment_id: paymentId, payment_url: paymentUrl, status: 'pending' }
              : { access_code: appt.access_code, note: 'Kassaga shu kod bilan boring' },
          });
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {});
          // Slot allaqachon band — 409, ikkinchi kishi ko'radi
          if (err.code === '23505' && String(err.constraint || '').includes('appointments_doctor_slot_unique')) {
            return res.status(409).json({ success: false, error: 'Bu vaqt endi band. Iltimos, boshqa vaqt tanlang.', code: 'SLOT_TAKEN' });
          }
          // Access code takrorlansa — retry (juda kam ehtimol)
          if (err.code === '23505' && String(err.constraint || '').includes('appointments_access_code_unique')) {
            continue;
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

  return router;
}
