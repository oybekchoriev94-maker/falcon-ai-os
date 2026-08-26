/**
 * Kassa — naqd/karta to'lovni qabul qilish va chek chiqarish.
 *
 * Ikki kirish nuqtasi:
 *  1. Telegramdan bron qilgan bemor kod bilan keladi -> GET /lookup?code=XXX
 *  2. Reception yozgan appointment -> to'g'ridan-to'g'ri appointment_id bilan
 *
 * POST /pay — tranzaksiya ichida:
 *  - appointmentni topadi (tenant ichida), band summani oladi
 *  - payment_transactions yozuvini 'paid' qiladi (yoki cashier uchun yangi yaratadi)
 *  - appointments.payment_status = 'paid'
 *  - receipt_number tayinlaydi (tenant ichida ketma-ket, 23505 -> retry)
 *  - qaytimni hisoblaydi
 *
 * GET /receipt/:paymentId — chek ma'lumoti (JSON) yoki ?format=html bo'lsa
 * 80mm termal printerga mos, brauzerdan bosiladigan HTML.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const paySchema = z.object({
  appointment_id: z.union([z.string(), z.number()]).optional(),
  access_code: z.string().trim().max(12).optional(),
  payment_id: z.string().uuid().optional(),
  cash_received: z.coerce.number().min(0).optional(),
  method: z.enum(['cash', 'card']).default('cash'),
}).refine((d) => d.appointment_id || d.access_code || d.payment_id, {
  message: 'appointment_id, access_code yoki payment_id kerak',
});

export default function cashierRoutes(pool, authMiddleware, checkRole, serverError) {
  const router = Router();

  async function qGet(sql, params = []) {
    const r = await pool.query(sql, params);
    return r.rows[0] || null;
  }
  const tid = (req) => req.user?.tenant_id || req.tenant_id;
  const CASHIER_ROLES = ['cashier', 'admin', 'ceo', 'receptionist'];

  // Chek obyektini yig'ish (pay javobida ham, GET /receipt da ham ishlatiladi)
  async function buildReceiptObj(tenantId, paymentId, cashierName) {
    const p = await qGet(
      // DIQQAT: pt.appointment_id (bigint FK) va a.appointment_id (matn kod, "A1B2C3")
      // nomi bir xil — aniq alias berilmasa ikkinchisi birinchisini bosib ketadi.
      `SELECT pt.*, pt.appointment_id AS appt_ref, pt.amount::float8 AS amount_f,
              pt.cash_received::float8 AS cash_f, pt.change_given::float8 AS change_f,
              a.appointment_id AS appt_code, a.patient_name AS a_patient, a.doctor_name,
              a.scheduled_at, a.access_code, s.name AS service_name
       FROM payment_transactions pt
       LEFT JOIN appointments a ON a.id = pt.appointment_id AND a.tenant_id = pt.tenant_id
       LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
       WHERE pt.tenant_id = $1 AND pt.id = $2`,
      [tenantId, paymentId]);
    if (!p) return null;
    // Tashrifdagi barcha xizmatlar (snapshot nomi/narxi bilan)
    const items = p.appt_ref
      ? (await pool.query(
          'SELECT name, price::float8 AS price FROM appointment_services WHERE tenant_id = $1 AND appointment_id = $2 ORDER BY id',
          [tenantId, p.appt_ref]
        )).rows
      : [];
    const clinic = await qGet('SELECT name, address, phone FROM tenants WHERE id = $1', [tenantId]);
    const innRow = await qGet("SELECT value FROM clinic_settings WHERE tenant_id = $1 AND key = 'inn'", [tenantId]);
    const logoRow = await qGet("SELECT value FROM clinic_settings WHERE tenant_id = $1 AND key = 'logo_url'", [tenantId]);
    return {
      receipt_number: p.receipt_number,
      payment_id: p.id,
      clinic_name: clinic?.name || 'Klinika',
      clinic_address: clinic?.address || '',
      clinic_phone: clinic?.phone || '',
      clinic_inn: innRow?.value || '',
      clinic_logo: logoRow?.value || '',
      patient_name: p.a_patient || p.patient_name || 'Bemor',
      doctor_name: p.doctor_name || '',
      service_name: p.service_name || p.description || 'Xizmat',
      // Bir tashrifda bir nechta xizmat bo'lishi mumkin — chekda har biri alohida qator
      items: items.length ? items : [{ name: p.service_name || p.description || 'Xizmat', price: p.amount_f || 0 }],
      amount: p.amount_f || 0,
      cash_received: p.cash_f,
      change: p.change_f,
      method: p.provider === 'card' ? 'Karta' : (p.provider === 'cash' ? 'Naqd' : p.provider),
      paid_at: p.paid_at,
      scheduled_at: p.scheduled_at,
      cashier_name: cashierName || '',
    };
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // cashier_id uuid — superadmin/soxta id UUID bo'lmasa null yozamiz
  const cashierId = (req) => (UUID_RE.test(String(req.user?.id || '')) ? req.user.id : null);

  // GET /lookup?code=XXX yoki ?appointment_id=NN — to'lovdan oldin ko'rish
  router.get('/lookup', authMiddleware, checkRole(...CASHIER_ROLES), async (req, res) => {
    try {
      const tenantId = tid(req);
      let appt;
      if (req.query.code) {
        const code = String(req.query.code).trim().toUpperCase();
        appt = await qGet(
          `SELECT a.*, s.name AS service_name FROM appointments a
           LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
           WHERE a.tenant_id = $1 AND a.access_code = $2`, [tenantId, code]);
      } else if (req.query.appointment_id) {
        appt = await qGet(
          `SELECT a.*, s.name AS service_name FROM appointments a
           LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
           WHERE a.tenant_id = $1 AND a.id = $2`, [tenantId, req.query.appointment_id]);
      } else {
        return res.status(400).json({ success: false, error: 'code yoki appointment_id kerak' });
      }
      if (!appt) return res.status(404).json({ success: false, error: 'Yozuv topilmadi' });
      res.json({
        success: true,
        appointment: {
          id: appt.id, appointment_id: appt.appointment_id,
          patient_name: appt.patient_name, phone: appt.phone,
          doctor_name: appt.doctor_name, service_name: appt.service_name,
          scheduled_at: appt.scheduled_at, amount: Number(appt.amount),
          payment_status: appt.payment_status, payment_method: appt.payment_method,
          access_code: appt.access_code,
        },
      });
    } catch (e) { serverError(res, e); }
  });

  // POST /pay — to'lovni qabul qilish + chek raqami
  router.post('/pay', authMiddleware, checkRole(...CASHIER_ROLES), async (req, res) => {
    const parsed = paySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message || 'Noto\'g\'ri ma\'lumot' });
    }
    const d = parsed.data;
    const tenantId = tid(req);
    if (!tenantId) return res.status(400).json({ success: false, error: 'Tenant aniqlanmadi' });

    let attempts = 0;
    while (attempts < 4) {
      attempts++;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Appointmentni topamiz va qulflaymiz (bir vaqtda ikki kassir to'lamasin)
        let appt;
        if (d.payment_id) {
          const pr = await client.query('SELECT appointment_id FROM payment_transactions WHERE tenant_id = $1 AND id = $2', [tenantId, d.payment_id]);
          const aid = pr.rows[0]?.appointment_id;
          if (aid) {
            const ar = await client.query('SELECT * FROM appointments WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, aid]);
            appt = ar.rows[0];
          }
        } else if (d.access_code) {
          const ar = await client.query('SELECT * FROM appointments WHERE tenant_id = $1 AND access_code = $2 FOR UPDATE', [tenantId, String(d.access_code).trim().toUpperCase()]);
          appt = ar.rows[0];
        } else if (d.appointment_id) {
          const ar = await client.query('SELECT * FROM appointments WHERE tenant_id = $1 AND id = $2 FOR UPDATE', [tenantId, d.appointment_id]);
          appt = ar.rows[0];
        }
        if (!appt) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Yozuv topilmadi' }); }
        if (appt.payment_status === 'paid') {
          await client.query('ROLLBACK');
          return res.status(409).json({ success: false, error: 'Bu yozuv allaqachon to\'langan', code: 'ALREADY_PAID' });
        }

        const amount = Number(appt.amount) || 0;
        const cashReceived = d.method === 'cash' ? (d.cash_received ?? amount) : amount;
        if (d.method === 'cash' && cashReceived < amount) {
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, error: `Yetarli emas. Kerak: ${amount}, berildi: ${cashReceived}` });
        }
        const change = Math.max(0, cashReceived - amount);

        // Chek raqami — tenant ichida ketma-ket
        const rn = await client.query('SELECT COALESCE(MAX(receipt_number), 0) + 1 AS next FROM payment_transactions WHERE tenant_id = $1', [tenantId]);
        const receiptNumber = rn.rows[0].next;

        // To'lov yozuvi — mavjud (online uchun yaratilgan) bo'lsa yangilaymiz, aks holda yaratamiz
        let paymentId;
        const existing = await client.query(
          "SELECT id FROM payment_transactions WHERE tenant_id = $1 AND appointment_id = $2 AND status = 'pending' LIMIT 1",
          [tenantId, appt.id]);
        if (existing.rows[0]) {
          paymentId = existing.rows[0].id;
          await client.query(
            `UPDATE payment_transactions SET status = 'paid', paid_at = NOW(), provider = $1, type = 'payment',
                    receipt_number = $2, cash_received = $3, change_given = $4, cashier_id = $5
             WHERE id = $6`,
            [d.method === 'card' ? 'card' : 'cash', receiptNumber, cashReceived, change, cashierId(req), paymentId]);
        } else {
          paymentId = uuidv4();
          await client.query(
            `INSERT INTO payment_transactions
               (id, tenant_id, appointment_id, patient_name, amount, description, provider, type, status, paid_at,
                receipt_number, cash_received, change_given, cashier_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'payment','paid',NOW(),$8,$9,$10,$11,NOW())`,
            [paymentId, tenantId, appt.id, appt.patient_name, amount,
             `${appt.doctor_name || 'Qabul'} — ${appt.patient_name}`,
             d.method === 'card' ? 'card' : 'cash', receiptNumber, cashReceived, change, cashierId(req)]);
        }

        await client.query("UPDATE appointments SET payment_status = 'paid', status = 'confirmed' WHERE id = $1", [appt.id]);
        await client.query('COMMIT');

        // Chek HTML'ini darhol qaytaramiz — mijoz yangi oynaga yozib chop etadi
        // (yangi tab GET so'rovi Authorization header yubora olmaydi, shuning uchun
        // authli receipt_url o'rniga to'g'ridan-to'g'ri HTML).
        const receiptObj = await buildReceiptObj(tenantId, paymentId, req.user?.name || req.user?.username || '');
        return res.status(200).json({
          success: true,
          payment: {
            payment_id: paymentId, receipt_number: receiptNumber,
            amount, cash_received: cashReceived, change, method: d.method,
          },
          receipt_url: `/api/cashier/receipt/${paymentId}?format=html`,
          receipt_html: receiptObj ? renderReceiptHtml(receiptObj) : null,
        });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505' && String(err.constraint || '').includes('receipt_number')) {
          continue; // chek raqami to'qnashdi — qayta urinamiz
        }
        return serverError(res, err);
      } finally {
        client.release();
      }
    }
    return res.status(500).json({ success: false, error: 'Chek raqami tayinlanmadi, qayta urinib ko\'ring' });
  });

  // ============================================================
  // YANGI: BEMOR SAVATI (Bosqich J)
  // Bemor kirsa — kutayotgan barcha to'lovlar (appointment + lab_orders)
  // bir joyda ko'rinadi. Kassir kod bo'yicha yoki telefon bo'yicha topadi.
  // ============================================================

  // GET /api/cashier/patient-cart?code=XY7K42  (yoki ?patient_id=UUID yoki ?phone=+998...)
  router.get('/patient-cart', authMiddleware, checkRole(...CASHIER_ROLES), async (req, res) => {
    try {
      const tenantId = tid(req);
      const code = String(req.query.code || '').trim().toUpperCase();
      const patientIdArg = String(req.query.patient_id || '').trim();
      const phone = String(req.query.phone || '').trim();

      let patientId = patientIdArg || null;
      if (!patientId && code) {
        // access_code bo'yicha bir appointmentni topib, uning patient_id sini olamiz
        const row = await qGet(
          `SELECT patient_id FROM appointments WHERE tenant_id = $1 AND access_code = $2 AND patient_id IS NOT NULL LIMIT 1`,
          [tenantId, code]
        );
        patientId = row?.patient_id || null;
      }
      if (!patientId && phone) {
        const norm = (String(phone).replace(/\D/g, '').replace(/^998?/, '+998'));
        const row = await qGet(
          `SELECT id FROM patients WHERE tenant_id = $1 AND phone = $2 LIMIT 1`,
          [tenantId, norm]
        );
        patientId = row?.id || null;
      }
      if (!patientId) {
        return res.status(404).json({ success: false, error: 'Bemor topilmadi (kod, telefon yoki patient_id kerak)' });
      }

      const patient = await qGet(
        `SELECT id, first_name, last_name, middle_name, phone, medical_record_number
         FROM patients WHERE tenant_id = $1 AND id = $2`,
        [tenantId, patientId]
      );

      // Kutayotgan appointmentlar
      const appts = (await pool.query(
        `SELECT a.id, a.appointment_id AS code, a.access_code, a.scheduled_at, a.status,
                a.amount::float8 AS amount, s.name AS service_name, a.doctor_name,
                a.source, a.forwarded_from_doctor_id
         FROM appointments a
         LEFT JOIN services_catalog s ON s.id = a.service_id AND s.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1 AND a.patient_id = $2 AND a.payment_status = 'pending'
           AND a.status NOT IN ('cancelled', 'no_show')
         ORDER BY a.scheduled_at ASC`,
        [tenantId, patientId]
      )).rows;

      // Kutayotgan lab_orders (paid_at IS NULL)
      const labs = (await pool.query(
        `SELECT id, test_type, reason, status, price::float8 AS price, created_at
         FROM lab_orders
         WHERE tenant_id = $1 AND patient_id = $2
           AND paid_at IS NULL AND status = 'ordered'
         ORDER BY created_at ASC`,
        [tenantId, patientId]
      )).rows;

      // Rozilik va shartnoma imzolanganmi (statsionar uchun kerak)
      const consent = await qGet(
        `SELECT 1 FROM patient_consents WHERE tenant_id = $1 AND patient_id = $2 LIMIT 1`,
        [tenantId, patientId]
      );
      const contract = await qGet(
        `SELECT 1 FROM service_contracts WHERE tenant_id = $1 AND patient_id = $2 LIMIT 1`,
        [tenantId, patientId]
      );

      const items = [
        ...appts.map((a) => ({
          type: 'appointment', id: a.id, code: a.code, access_code: a.access_code,
          scheduled_at: a.scheduled_at, doctor_name: a.doctor_name,
          service_name: a.service_name || 'Ko\'rik',
          amount: a.amount || 0,
          forwarded: !!a.forwarded_from_doctor_id,
          source: a.source,
        })),
        ...labs.map((l) => ({
          type: 'lab', id: l.id, test_type: l.test_type,
          service_name: labTypeLabel(l.test_type),
          reason: l.reason, amount: l.price || 0,
          created_at: l.created_at,
        })),
      ];
      const total = items.reduce((s, it) => s + Number(it.amount || 0), 0);

      res.json({
        success: true,
        patient,
        items,
        total,
        consent_signed: !!consent,
        contract_signed: !!contract,
      });
    } catch (e) { serverError(res, e); }
  });

  // POST /api/cashier/pay-cart — bir savatdagi hamma narsani birdaniga to'lash
  const payCartSchema = z.object({
    patient_id: z.string().uuid(),
    appointment_ids: z.array(z.union([z.string(), z.number()])).optional(),
    lab_order_ids: z.array(z.string().uuid()).optional(),
    cash_received: z.coerce.number().min(0).optional(),
    method: z.enum(['cash', 'card', 'online']).default('cash'),
  }).refine(
    (d) => (d.appointment_ids && d.appointment_ids.length) || (d.lab_order_ids && d.lab_order_ids.length),
    { message: 'Kamida 1 ta item tanlanishi kerak' }
  );

  router.post('/pay-cart', authMiddleware, checkRole(...CASHIER_ROLES), async (req, res) => {
    const parsed = payCartSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Validatsiya xatosi', details: parsed.error.flatten().fieldErrors });
    }
    const b = parsed.data;
    const client = await pool.connect();
    try {
      const tenantId = tid(req);
      await client.query('BEGIN');

      const patient = (await client.query(
        `SELECT id, first_name, last_name FROM patients WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, b.patient_id]
      )).rows[0];
      if (!patient) {
        await client.query('ROLLBACK');
        return res.status(404).json({ success: false, error: 'Bemor topilmadi' });
      }

      // Appointmentlar summasi + to'lov uchun tayyorlash
      let total = 0;
      const itemsAudit = [];
      if (b.appointment_ids && b.appointment_ids.length) {
        const r = await client.query(
          `SELECT id, amount::float8 AS amount FROM appointments
           WHERE tenant_id = $1 AND patient_id = $2 AND id = ANY($3::bigint[])
             AND payment_status = 'pending'
           FOR UPDATE`,
          [tenantId, b.patient_id, b.appointment_ids]
        );
        for (const row of r.rows) {
          total += Number(row.amount || 0);
          itemsAudit.push({ type: 'appointment', id: row.id, amount: row.amount });
        }
      }
      if (b.lab_order_ids && b.lab_order_ids.length) {
        const r = await client.query(
          `SELECT id, price::float8 AS price FROM lab_orders
           WHERE tenant_id = $1 AND patient_id = $2 AND id = ANY($3::uuid[])
             AND paid_at IS NULL
           FOR UPDATE`,
          [tenantId, b.patient_id, b.lab_order_ids]
        );
        for (const row of r.rows) {
          total += Number(row.price || 0);
          itemsAudit.push({ type: 'lab', id: row.id, amount: row.price });
        }
      }
      if (total <= 0 || itemsAudit.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'To\'lash uchun narsa topilmadi' });
      }

      const cashReceived = Number(b.cash_received || total);
      const change = Math.max(0, cashReceived - total);

      // Savat yozuvi (audit uchun — kim, qachon, nima to'ladi)
      const cartId = uuidv4();
      await client.query(
        `INSERT INTO payment_carts
           (id, tenant_id, patient_id, created_by, status, items_json, total,
            paid_at, cash_received, cash_change, method)
         VALUES ($1, $2, $3, $4, 'paid', $5::jsonb, $6, NOW(), $7, $8, $9)`,
        [cartId, tenantId, b.patient_id, req.user?.id || null,
         JSON.stringify(itemsAudit), total,
         cashReceived, change, b.method]
      );

      // Har appointmentga alohida payment_transactions yozib, appointments'ni paid qilamiz
      // (mavjud /pay endpointi bilan bir xil format — chek ham xuddi shundan chiqadi).
      const appointmentPaymentIds = [];
      if (b.appointment_ids && b.appointment_ids.length) {
        for (const apptId of b.appointment_ids) {
          const paymentId = uuidv4();
          // Chek raqami — tenant ichida ketma-ket, to'qnashuvda retry
          let receiptNumber = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const next = (await client.query(
                `SELECT COALESCE(MAX(receipt_number), 0) + 1 AS n FROM payment_transactions WHERE tenant_id = $1`,
                [tenantId]
              )).rows[0].n;
              const amt = (await client.query(`SELECT amount FROM appointments WHERE id = $1`, [apptId])).rows[0]?.amount || 0;
              await client.query(
                `INSERT INTO payment_transactions
                   (id, tenant_id, appointment_id, amount, method, status, cash_received, change_given, receipt_number, cashier_id, paid_at)
                 VALUES ($1, $2, $3, $4, $5, 'paid', $6, $7, $8, $9, NOW())`,
                [paymentId, tenantId, apptId, amt, b.method,
                 cashReceived >= total ? Number(amt) : null,
                 null, next, req.user?.id || null]
              );
              receiptNumber = next;
              break;
            } catch (e) {
              if (e.code === '23505' && attempt < 2) continue;
              throw e;
            }
          }
          await client.query(
            `UPDATE appointments SET payment_status = 'paid', payment_method = $1 WHERE id = $2 AND tenant_id = $3`,
            [b.method, apptId, tenantId]
          );
          appointmentPaymentIds.push({ appointment_id: apptId, payment_id: paymentId, receipt_number: receiptNumber });
        }
      }

      // lab_orders larni "to'landi" qilamiz
      if (b.lab_order_ids && b.lab_order_ids.length) {
        await client.query(
          `UPDATE lab_orders SET paid_at = NOW() WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, b.lab_order_ids]
        );
      }

      await client.query('COMMIT');
      res.json({
        success: true,
        cart_id: cartId,
        total,
        cash_received: cashReceived,
        change,
        paid_appointments: appointmentPaymentIds,
        paid_lab_orders: b.lab_order_ids || [],
      });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      serverError(res, e);
    } finally {
      client.release();
    }
  });

  // GET /receipt/:paymentId — JSON yoki ?format=html (keyinchalik qayta chop etish uchun)
  router.get('/receipt/:paymentId', authMiddleware, checkRole(...CASHIER_ROLES), async (req, res) => {
    try {
      const tenantId = tid(req);
      const receipt = await buildReceiptObj(tenantId, req.params.paymentId, req.user?.name || req.user?.username || '');
      if (!receipt) return res.status(404).json({ success: false, error: 'Chek topilmadi' });

      if (String(req.query.format) === 'html') {
        await pool.query('UPDATE payment_transactions SET printed_at = NOW() WHERE id = $1 AND printed_at IS NULL', [receipt.payment_id]).catch(() => {});
        res.set('Content-Type', 'text/html; charset=utf-8');
        return res.send(renderReceiptHtml(receipt));
      }
      res.json({ success: true, receipt });
    } catch (e) { serverError(res, e); }
  });

  return router;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function fmtSum(n) { return (Number(n) || 0).toLocaleString('uz-UZ'); }

// Lab tekshiruv nomi — labs.js dagi rejestrga mos, foydalanuvchiga tushunarli
function labTypeLabel(t) {
  const m = {
    blood_general: 'Umumiy qon tahlili',
    urine_general: 'Umumiy peshob tahlili',
    biochemistry:  'Bioximik tahlil',
    coagulogram:   'Koagulogramma',
    ekg:           'EKG',
    xray:          'Rentgen',
    ultrasound:    'UZI',
    egds:          'EFGDS',
    ct_mri:        'MSKT/MRT',
    consult:       'Mutaxasis konsultatsiyasi',
    other:         'Boshqa tekshiruv',
  };
  return m[t] || t || 'Tekshiruv';
}
function fmtDate(d) {
  if (!d) return '';
  try { return new Date(d).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent', dateStyle: 'short', timeStyle: 'short' }); }
  catch { return String(d); }
}

/** 80mm termal printerga mojlangan chek. Brauzerdan Ctrl+P yoki auto-print. */
function renderReceiptHtml(r) {
  const line = '<div class="line"></div>';
  return `<!DOCTYPE html>
<html lang="uz"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Chek #${r.receipt_number || ''}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Courier New',monospace; background:#eee; padding:10px; }
  .receipt { width:80mm; max-width:80mm; margin:0 auto; background:#fff; padding:6mm 4mm; color:#000; }
  .center { text-align:center; }
  .bold { font-weight:bold; }
  .big { font-size:15px; }
  .sm { font-size:11px; }
  .row { display:flex; justify-content:space-between; font-size:12px; margin:2px 0; }
  .line { border-top:1px dashed #000; margin:6px 0; }
  .total { font-size:16px; font-weight:bold; }
  h1 { font-size:16px; margin-bottom:2px; }
  .muted { color:#333; }
  @media print {
    body { background:#fff; padding:0; }
    .receipt { width:auto; box-shadow:none; }
    .noprint { display:none !important; }
    @page { margin:0; size:80mm auto; }
  }
  .btn { display:block; width:80mm; max-width:80mm; margin:10px auto; padding:12px; text-align:center;
         background:#2563eb; color:#fff; border:none; border-radius:8px; font-size:15px; cursor:pointer; }
</style></head>
<body>
<div class="receipt">
  <div class="center">
    ${r.clinic_logo ? `<img src="${esc(r.clinic_logo)}" alt="" style="max-width:34mm;max-height:20mm;margin:0 auto 4px;display:block">` : ''}
    <h1 class="bold">${esc(r.clinic_name)}</h1>
    ${r.clinic_address ? `<div class="sm muted">${esc(r.clinic_address)}</div>` : ''}
    ${r.clinic_phone ? `<div class="sm muted">Tel: ${esc(r.clinic_phone)}</div>` : ''}
    ${r.clinic_inn ? `<div class="sm muted">INN: ${esc(r.clinic_inn)}</div>` : ''}
  </div>
  ${line}
  <div class="center big bold">CHEK #${esc(r.receipt_number)}</div>
  <div class="center sm muted">${fmtDate(r.paid_at)}</div>
  ${line}
  <div class="row"><span>Bemor:</span><span class="bold">${esc(r.patient_name)}</span></div>
  ${r.doctor_name ? `<div class="row"><span>Shifokor:</span><span>${esc(r.doctor_name)}</span></div>` : ''}
  ${r.scheduled_at ? `<div class="row"><span>Qabul vaqti:</span><span>${fmtDate(r.scheduled_at)}</span></div>` : ''}
  ${line}
  ${(r.items || []).map((it) =>
    `<div class="row"><span>${esc(it.name)}</span><span class="bold">${fmtSum(it.price)}</span></div>`
  ).join('')}
  ${line}
  <div class="row total"><span>JAMI:</span><span>${fmtSum(r.amount)} so'm</span></div>
  <div class="row"><span>To'lov turi:</span><span>${esc(r.method)}</span></div>
  ${r.cash_received != null ? `<div class="row"><span>Berildi:</span><span>${fmtSum(r.cash_received)} so'm</span></div>` : ''}
  ${r.change != null && r.change > 0 ? `<div class="row bold"><span>Qaytim:</span><span>${fmtSum(r.change)} so'm</span></div>` : ''}
  ${line}
  ${r.cashier_name ? `<div class="sm muted">Kassir: ${esc(r.cashier_name)}</div>` : ''}
  <div class="center sm muted" style="margin-top:6px">Xaridingiz uchun rahmat!</div>
  <div class="center sm muted">Falcon AI OS</div>
</div>
<button class="btn noprint" onclick="window.print()">🖨️ Chekni chop etish</button>
<script>
  // Avtomatik chop etish oynasi (kiosk/kassa rejimi uchun)
  if (new URLSearchParams(location.search).get('autoprint') === '1') {
    window.addEventListener('load', () => setTimeout(() => window.print(), 300));
  }
</script>
</body></html>`;
}
