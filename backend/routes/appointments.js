// ============================================================
// BACKEND ROUTES — Qabul (Appointment) tizimi
// Telegram Mini App orqali bemorlarni shifokorga yozish
// ============================================================

import { Router } from 'express';
import { safeError } from '../services/safe-error.js';
import {
  calcPlatformFee, calcCommission, deductDoctorBalance, accruePatientCashback,
  updateDoctorKPI, recordPlatformLedger, upsertFinancialTransaction
} from '../services/finance-engine.js';

export default function appointmentRoutes(pool, authMiddleware) {
  const router = Router();
  router.use(authMiddleware);

  async function q(sql, params = []) {
    const result = await pool.query(sql, params);
    if (/^SELECT/i.test(sql.trim())) return result.rows;
    return result;
  }
  async function qGet(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
  }

  // Hafta kunlari nomlari
  const DAY_NAMES = { 1:'Dushanba', 2:'Seshanba', 3:'Chorshanba', 4:'Payshanba', 5:'Juma', 6:'Shanba', 7:'Yakshanba' };

  // === GET /api/appointments/doctors — barcha shifokorlar (Mini App uchun) ===
  router.get('/doctors', async (req, res) => {
    try {
      const tenantId = req.user.tenant_id;
      const docs = await q(
        "SELECT id, first_name, last_name, specialty, specialization FROM doctors WHERE tenant_id = $1 AND status = 'Faol' ORDER BY first_name",
        [tenantId]
      );
      res.json({ success: true, doctors: docs });
    } catch (e) { safeError(res, e); }
  });

  // === GET /api/appointments/slots?doctor_id=X&date=YYYY-MM-DD ===
  router.get('/slots', async (req, res) => {
    try {
      const { doctor_id, date } = req.query;
      const tenantId = req.user.tenant_id;
      if (!doctor_id || !date) {
        return res.status(400).json({ success: false, error: 'doctor_id va date talab qilinadi' });
      }

      const dateObj = new Date(date + 'T00:00:00');
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ success: false, error: 'Sana formati noto\'g\'ri. YYYY-MM-DD ishlating' });
      }

      const dayOfWeek = dateObj.getDay() || 7; // 1=Dush ... 7=Yak

      // Shifokorning shu kundagi ish grafigi
      const doctor = await qGet("SELECT id FROM doctors WHERE tenant_id = $1 AND id = $2", [tenantId, doctor_id]);
      if (!doctor) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const schedule = await qGet(
        "SELECT * FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3",
        [tenantId, doctor_id, dayOfWeek]
      );
      if (!schedule) {
        return res.json({ success: true, date, day_name: DAY_NAMES[dayOfWeek] || 'Noma\'lum', doctor_id, slots: [], message: 'Shifokor bu kuni ishlamaydi' });
      }

      // Band qilingan vaqtlar
      const bookedSlots = await q(
        "SELECT appointment_time FROM bookings WHERE tenant_id = $1 AND doctor_id = $2 AND appointment_date = $3 AND status != 'Bekor qilingan'",
        [tenantId, doctor_id, date]
      );
      const bookedSet = new Set(bookedSlots.map(b => b.appointment_time));

      // Slot generatsiya
      const slots = [];
      const [startH, startM] = schedule.start_time.split(':').map(Number);
      const [endH, endM] = schedule.end_time.split(':').map(Number);
      const duration = schedule.slot_duration || 30;

      let current = startH * 60 + startM;
      const end = endH * 60 + endM;

      while (current + duration <= end) {
        const hh = String(Math.floor(current / 60)).padStart(2, '0');
        const mm = String(current % 60).padStart(2, '0');
        const timeStr = `${hh}:${mm}`;
        slots.push({
          time: timeStr,
          available: !bookedSet.has(timeStr)
        });
        current += duration;
      }

      res.json({
        success: true,
        date,
        day_name: DAY_NAMES[dayOfWeek],
        doctor_id,
        schedule: { start_time: schedule.start_time, end_time: schedule.end_time, slot_duration: schedule.slot_duration },
        slots
      });
    } catch (e) { safeError(res, e); }
  });

  // === POST /api/appointments/book ===
  router.post('/book', async (req, res) => {
    try {
      const { doctor_id, patient_name, telegram_id, date, time } = req.body;
      const tenantId = req.user.tenant_id;
      if (!doctor_id || !patient_name || !date || !time) {
        return res.status(400).json({ success: false, error: 'doctor_id, patient_name, date va time talab qilinadi' });
      }

      // Sana va vaqtni validatsiya
      const dateObj = new Date(date + 'T' + time);
      if (isNaN(dateObj.getTime())) {
        return res.status(400).json({ success: false, error: 'Sana yoki vaqt formati noto\'g\'ri' });
      }

      // Double-booking tekshiruvi
      const existing = await qGet(
        "SELECT id FROM bookings WHERE tenant_id = $1 AND doctor_id = $2 AND appointment_date = $3 AND appointment_time = $4 AND status != 'Bekor qilingan'",
        [tenantId, doctor_id, date, time]
      );
      if (existing) {
        return res.status(409).json({ success: false, error: 'Bu vaqt allaqachon band qilingan' });
      }

      // Ish grafigini tekshirish
      const dayOfWeek = dateObj.getDay() || 7;
      const doctor = await qGet(
        "SELECT id, first_name, last_name, specialty FROM doctors WHERE tenant_id = $1 AND id = $2",
        [tenantId, doctor_id]
      );
      if (!doctor) return res.status(404).json({ success: false, error: 'Shifokor topilmadi' });
      const schedule = await qGet(
        "SELECT * FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3",
        [tenantId, doctor_id, dayOfWeek]
      );
      if (!schedule) {
        return res.status(400).json({ success: false, error: 'Shifokor bu kuni ishlamaydi' });
      }

      // Vaqtni ish soatlari oralig'ida ekanligini tekshirish
      const timeMinutes = time.split(':').reduce((h, m) => parseInt(h) * 60 + parseInt(m), 0);
      const startMinutes = schedule.start_time.split(':').reduce((h, m) => parseInt(h) * 60 + parseInt(m), 0);
      const endMinutes = schedule.end_time.split(':').reduce((h, m) => parseInt(h) * 60 + parseInt(m), 0);
      if (timeMinutes < startMinutes || timeMinutes + (schedule.slot_duration || 30) > endMinutes) {
        return res.status(400).json({ success: false, error: 'Bu vaqt ish soatlaridan tashqari' });
      }

      // Band qilish — RETURNING id bilan PostgreSQL auto-increment ID olish
      const result = await q(
        "INSERT INTO bookings (tenant_id, doctor_id, patient_name, telegram_id, appointment_date, appointment_time, status) VALUES ($1, $2, $3, $4, $5, $6, 'Kutilmoqda') RETURNING id",
        [tenantId, doctor_id, patient_name, telegram_id || null, date, time]
      );

      const bookingId = result.rows[0].id;

      // Telegram xabarnoma (agar telegram_id berilgan bo'lsa)
      if (telegram_id) {
        try {
          const doctorName = doctor ? `${doctor.first_name} ${doctor.last_name || ''}`.trim() : 'Shifokor';
          const dateFormatted = new Date(date + 'T00:00:00').toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' });
          const msg = `✅ *Navbat tasdiqlandi!*\n\n👤 *Bemor:* ${patient_name}\n👨‍⚕️ *Shifokor:* ${doctorName}\n📅 *Sana:* ${dateFormatted}\n⏰ *Vaqt:* ${time}\n\n🆔 *Navbat raqami:* #${bookingId}\n\nIltimos, belgilangan vaqtda klinikaga yetib keling.`;
          const internalSecret = process.env.INTERNAL_SECRET;
          if (internalSecret) {
            fetch(`${req.protocol}://${req.get('host')}/api/internal/send-telegram`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
              body: JSON.stringify({ chat_id: telegram_id, text: msg, parse_mode: 'Markdown' })
            }).catch(() => {});
          } else {
            console.warn('[BOOK] INTERNAL_SECRET sozlanmagan, Telegram xabari yuborilmadi');
          }
        } catch (botErr) { console.warn('[BOOK] Telegram xabarnoma xatosi:', botErr.message); }
      }

      res.status(201).json({
        success: true,
        booking: {
          id: bookingId,
          doctor_id,
          patient_name,
          appointment_date: date,
          appointment_time: time,
          status: 'Kutilmoqda'
        }
      });
    } catch (e) {
      if (e?.code === '23505' && e?.constraint === 'bookings_active_slot_unique') {
        return res.status(409).json({ success: false, error: 'Bu vaqt allaqachon band qilingan' });
      }
      safeError(res, e);
    }
  });

  // === GET /api/appointments/queue?doctor_id=X&date=YYYY-MM-DD — Doctor dashboard uchun ===
  router.get('/queue', authMiddleware, async (req, res) => {
    try {
      const { doctor_id, date } = req.query;
      const tenantId = req.user.tenant_id;
      const today = date || new Date().toISOString().slice(0, 10);
      let bookings;
      if (doctor_id) {
        bookings = await q(
          "SELECT * FROM bookings WHERE tenant_id = $1 AND doctor_id = $2 AND appointment_date = $3 ORDER BY appointment_time ASC",
          [tenantId, doctor_id, today]
        );
      } else {
        bookings = await q(
          "SELECT * FROM bookings WHERE tenant_id = $1 AND appointment_date = $2 ORDER BY appointment_time ASC",
          [tenantId, today]
        );
      }
      res.json({ success: true, date: today, total: bookings.length, bookings });
    } catch (e) { safeError(res, e); }
  });

  // === POST /api/appointments/cancel — Navbatdagi bemorni bekor qilish ===
  router.post('/cancel', authMiddleware, async (req, res) => {
    try {
      const { id, booking_id } = req.body;
      const tenantId = req.user.tenant_id;
      // patient_queue dan bekor qilish
      if (id) {
        const qItem = await qGet("SELECT id FROM patient_queue WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
        if (!qItem) return res.status(404).json({ success: false, error: 'Navbatdagi bemor topilmadi' });
        await q("UPDATE patient_queue SET status = 'cancelled' WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
        return res.json({ success: true, message: 'Navbat bekor qilindi' });
      }
      if (!booking_id) return res.status(400).json({ success: false, error: 'id yoki booking_id talab qilinadi' });
      const booking = await qGet("SELECT * FROM bookings WHERE id = $1 AND tenant_id = $2", [booking_id, tenantId]);
      if (!booking) return res.status(404).json({ success: false, error: 'Band topilmadi' });
      if (req.user.role !== 'admin' && booking.doctor_id !== req.user.doctor_id) {
        return res.status(403).json({ success: false, error: 'Siz faqat o\'z navbatingizni bekor qilishingiz mumkin' });
      }
      await q("UPDATE bookings SET status = 'Bekor qilingan' WHERE id = $1 AND tenant_id = $2", [booking_id, tenantId]);
      res.json({ success: true, message: 'Navbat bekor qilindi' });
    } catch (e) { safeError(res, e); }
  });

  // === POST /api/appointments/complete-status — Qabulni yakunlash + Balansdan yechish ===
  router.post('/complete-status', authMiddleware, async (req, res) => {
    try {
      const { id, booking_id, total_price, referral_id, idempotency_key } = req.body;
      const tenantId = req.user.tenant_id;
      // patient_queue dan yakunlash
      if (id) {
        await q("UPDATE patient_queue SET status = 'completed' WHERE id = $1 AND tenant_id = $2", [id, tenantId]);
        return res.json({ success: true, message: 'Qabul yakunlandi' });
      }
      if (!booking_id) return res.status(400).json({ success: false, error: 'id yoki booking_id talab qilinadi' });

      // Idempotency key tekshirish
      if (idempotency_key) {
        const existing = await qGet(
          "SELECT response FROM idempotency_keys WHERE tenant_id = $1 AND key = $2",
          [tenantId, idempotency_key]
        );
        if (existing) {
          return res.json({ ...JSON.parse(existing.response), idempotent: true });
        }
      }

      const booking = await qGet("SELECT * FROM bookings WHERE id = $1 AND tenant_id = $2", [booking_id, tenantId]);
      if (!booking) return res.status(404).json({ success: false, error: 'Band topilmadi' });
      if (booking.status === 'Yakunlangan') return res.status(400).json({ success: false, error: 'Qabul allaqachon yakunlangan' });

      // Ownership + role check: faqat booking egasi yoki admin yakunlashi mumkin
      if (req.user.role !== 'admin' && booking.doctor_id !== req.user.doctor_id) {
        return res.status(403).json({ success: false, error: 'Siz faqat o\'z bookinglaringizni yakunlashingiz mumkin' });
      }

      // ─── PostgreSQL transaction: BEGIN / COMMIT / ROLLBACK ─────────────
      const client = await pool.connect();
      let split = null;
      try {
        await client.query('BEGIN');

        // Transaction-scoped query helpers (use client, not pool)
        const tq = async (sql, params = []) => {
          const result = await client.query(sql, params);
          if (/^SELECT/i.test(sql.trim())) return result.rows;
          return result;
        };
        const tqGet = async (sql, params = []) => {
          const result = await client.query(sql, params);
          return result.rows[0] || null;
        };

        await tq(
          "UPDATE bookings SET status = 'Yakunlangan' WHERE id = $1 AND tenant_id = $2 AND status != 'Yakunlangan'",
          [booking_id, tenantId]
        );

        if (total_price && parseFloat(total_price) > 0) {
          const price = parseFloat(total_price);
          const platformAmount = calcPlatformFee(price);
          let referrerBonusPercent = 10.0;
          let referrerAmount = 0;
          let clinicAmount = price - platformAmount;
          const execDocId = booking.doctor_id;
          let oldBalance = 0;

          // Atomic balance deduction
          const doc = await tqGet("SELECT id, balance FROM doctors WHERE id = $1 AND tenant_id = $2", [execDocId, tenantId]);
          if (doc) {
            oldBalance = doc.balance || 0;
            const enough = await deductDoctorBalance(tq, tenantId, execDocId, platformAmount);
            if (!enough) {
              throw new Error('Shifokor balansida yetarli mablag\' mavjud emas');
            }
          }

          let patientCashback = 0;
          let refPatientId = null;
          if (referral_id) {
            const referral = await tqGet(
              "SELECT * FROM referrals WHERE tenant_id = $1 AND (id::text = $2 OR referral_id = $2)",
              [tenantId, referral_id]
            );
            if (referral) {
              const referringDoctor = referral.referring_doctor;
              let senderDoc = null;
              if (referringDoctor) {
                senderDoc = await tqGet(
                  "SELECT id, referrer_bonus_percent FROM doctors WHERE tenant_id = $1 AND (first_name || ' ' || last_name) LIKE $2",
                  [tenantId, `%${referringDoctor}%`]
                );
              }
              if (senderDoc) {
                referrerBonusPercent = senderDoc.referrer_bonus_percent || 10.0;
              }
              referrerAmount = calcCommission(price, referrerBonusPercent);
              clinicAmount = Math.round((price - platformAmount - referrerAmount) * 100) / 100;

              const newBalance = (doc ? (doc.balance || 0) - platformAmount : 0);
              await recordPlatformLedger(tq, tenantId, {
                booking_id, referral_id: referral.id, doctor_id: execDocId, total_amount: price,
                platform_amount: platformAmount, referrer_id: senderDoc?.id || null, referrer_bonus_percent: referrerBonusPercent,
                referrer_amount: referrerAmount, clinic_amount: clinicAmount, doctor_balance: newBalance
              });

              await upsertFinancialTransaction(tq, tqGet, tenantId, referral.id, price, referrerAmount, platformAmount);

              refPatientId = referral.patient_id;
              if (refPatientId) {
                const modeRow = await tqGet(
                  "SELECT value FROM clinic_settings WHERE tenant_id = $1 AND key = 'patient_campaign_mode'",
                  [tenantId]
                );
                const campaignMode = modeRow ? modeRow.value : 'always';
                let cashbackAllowed = campaignMode === 'always';
                if (campaignMode === 'scheduled') {
                  cashbackAllowed = true;
                }
                if (cashbackAllowed) {
                  const patRefPct = await tqGet(
                    "SELECT value FROM clinic_settings WHERE tenant_id = $1 AND key = 'patient_referral_percent'",
                    [tenantId]
                  );
                  const pct = patRefPct ? parseFloat(patRefPct.value) : 3.0;
                  patientCashback = calcCommission(price, pct);
                  await accruePatientCashback(tq, tenantId, refPatientId, patientCashback);
                }
              }
            } else {
              const newBalance = (doc ? (doc.balance || 0) - platformAmount : 0);
              await recordPlatformLedger(tq, tenantId, {
                booking_id, doctor_id: execDocId, total_amount: price,
                platform_amount: platformAmount, referrer_amount: 0, clinic_amount: clinicAmount, doctor_balance: newBalance
              });
            }
          } else {
            const newBalance = (doc ? (doc.balance || 0) - platformAmount : 0);
            await recordPlatformLedger(tq, tenantId, {
              booking_id, doctor_id: execDocId, total_amount: price,
              platform_amount: platformAmount, referrer_amount: 0, clinic_amount: clinicAmount, doctor_balance: newBalance
            });
          }

          split = {
            total: price,
            platform_fee_percent: 3.0,
            platform_amount: platformAmount,
            referrer_bonus_percent: referrerBonusPercent,
            referrer_amount: referrerAmount,
            clinic_amount: clinicAmount,
            doctor_balance_before: oldBalance,
            patient_cashback: patientCashback,
            referring_patient_id: refPatientId
          };
        }

        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      // KPI and idempotency key — outside the main transaction
      await updateDoctorKPI(q, qGet, tenantId, booking.doctor_id, 15);

      if (idempotency_key) {
        await q(
          "INSERT INTO idempotency_keys (tenant_id, key, response, created_at) VALUES ($1, $2, $3, NOW()) ON CONFLICT (tenant_id, key) DO NOTHING",
          [tenantId, idempotency_key, JSON.stringify({ success: true, message: 'Qabul yakunlandi', booking_id: parseInt(booking_id), split })]);
      }

      res.json({ success: true, message: 'Qabul yakunlandi', booking_id: parseInt(booking_id), split });
    } catch (e) { safeError(res, e); }
  });

  return router;
}
