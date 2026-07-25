// ============================================================
// Receptionist Agent — ovozli AI qabulxona (tool-calling bilan)
//
// LLM shifokor grafigini tekshiradi va bemorni navbatga yozadi —
// barcha DB amallari tenant chegarasida.
// ============================================================

import { z } from 'zod';
import { runToolLoop } from '../core/tools.js';
import { transcribe } from '../engines/stt.js';

export const name = 'receptionist';
export const description = '24/7 AI qabulxona — shifokor grafigini tekshirib, bemorni jonli band qiladi';
export const version = '3.0.0';
export const category = 'clinical';

export const schema = z.object({
  text: z.string().max(2000).optional(),
  audio: z.any().optional(),
  language: z.enum(['uz', 'ru']).optional(),
  history: z.array(z.object({ role: z.string(), content: z.string().nullable().optional() }).passthrough()).optional(),
}).refine((d) => d.text || d.audio || (d.history && d.history.length), {
  message: 'text, audio yoki history talab qilinadi',
});

// ─── Vositalar (tool) ta'riflari ────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: "Shifokorning ismi yoki mutaxassisligi va sana bo'yicha bo'sh qabul vaqtlarini tekshiradi.",
      parameters: {
        type: 'object',
        properties: {
          doctor_name: { type: 'string', description: 'Shifokor ismi yoki mutaxassisligi (masalan: Kardiolog, Umarov)' },
          date: { type: 'string', description: 'Sana, format: YYYY-MM-DD' },
        },
        required: ['doctor_name', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_booking',
      description: 'Bemor roziligidan keyin qabulni rasman band qiladi.',
      parameters: {
        type: 'object',
        properties: {
          doctor_id: { type: 'string', description: 'check_availability qaytargan doctor_id' },
          patient_name: { type: 'string', description: 'Bemor ismi va familiyasi' },
          phone: { type: 'string', description: 'Telefon raqami' },
          date: { type: 'string', description: 'Sana YYYY-MM-DD' },
          time: { type: 'string', description: 'Vaqt HH:MM' },
        },
        required: ['doctor_id', 'patient_name', 'date', 'time'],
      },
    },
  },
];

// ─── Vosita bajaruvchilari (tenant chegarasida) ─────────────
function makeHandlers(db, tenantId) {
  return {
    async check_availability({ doctor_name, date }) {
      if (!doctor_name || !date) return { success: false, error: 'doctor_name va date majburiy' };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { success: false, error: 'Sana formati YYYY-MM-DD bo\'lishi kerak' };

      const doctor = await db.qGet(
        `SELECT id, first_name, last_name, specialty FROM doctors
         WHERE tenant_id = $1 AND status = 'Faol'
           AND (LOWER(first_name || ' ' || COALESCE(last_name,'')) LIKE LOWER($2)
                OR LOWER(COALESCE(specialty,'')) LIKE LOWER($2))
         ORDER BY created_at LIMIT 1`,
        [tenantId, `%${doctor_name}%`]
      );
      if (!doctor) return { success: false, error: `"${doctor_name}" bo'yicha shifokor topilmadi` };

      const dayOfWeek = new Date(date + 'T12:00:00').getDay() || 7;
      const schedule = await db.qGet(
        'SELECT * FROM doctor_schedules WHERE tenant_id = $1 AND doctor_id = $2 AND day_of_week = $3',
        [tenantId, doctor.id, dayOfWeek]
      );
      const doctorLabel = `${doctor.first_name} ${doctor.last_name || ''}`.trim();
      if (!schedule) return { success: false, error: `${doctorLabel} bu kuni qabul qilmaydi` };

      const booked = await db.q(
        `SELECT appointment_time FROM bookings
         WHERE tenant_id = $1 AND doctor_id = $2 AND appointment_date = $3 AND status != 'Bekor qilingan'`,
        [tenantId, doctor.id, date]
      );
      const busy = new Set(booked.map((b) => b.appointment_time));

      const [sh, sm] = schedule.start_time.split(':').map(Number);
      const [eh, em] = schedule.end_time.split(':').map(Number);
      const dur = schedule.slot_duration || 30;
      const slots = [];
      for (let cur = sh * 60 + sm; cur + dur <= eh * 60 + em; cur += dur) {
        const t = `${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`;
        if (!busy.has(t)) slots.push(t);
      }
      return {
        success: true,
        doctor_id: doctor.id,
        doctor_name: doctorLabel,
        specialty: doctor.specialty,
        date,
        available_slots: slots,
      };
    },

    async confirm_booking({ doctor_id, patient_name, phone, date, time }) {
      if (!doctor_id || !patient_name || !date || !time) {
        return { success: false, error: 'doctor_id, patient_name, date va time majburiy' };
      }
      const doctor = await db.qGet(
        'SELECT id, first_name, last_name FROM doctors WHERE id = $1 AND tenant_id = $2',
        [doctor_id, tenantId]
      );
      if (!doctor) return { success: false, error: 'Shifokor topilmadi' };

      return db.transaction(async (tx) => {
        const taken = await tx.qGet(
          `SELECT id FROM bookings WHERE tenant_id = $1 AND doctor_id = $2
             AND appointment_date = $3 AND appointment_time = $4 AND status != 'Bekor qilingan'`,
          [tenantId, doctor_id, date, time]
        );
        if (taken) return { success: false, error: 'Bu vaqt hozirgina band qilindi, boshqa vaqt tanlang' };

        const booking = await tx.q(
          `INSERT INTO bookings (tenant_id, doctor_id, patient_name, phone, appointment_date, appointment_time, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'Kutilmoqda') RETURNING id`,
          [tenantId, doctor_id, patient_name, phone || '', date, time]
        );

        const aptId = 'APT-' + Date.now().toString(36).toUpperCase();
        await tx.qExec(
          `INSERT INTO appointments (tenant_id, appointment_id, patient_name, phone, doctor_name, status, source)
           VALUES ($1, $2, $3, $4, $5, 'pending', 'voice_ai')`,
          [tenantId, aptId, patient_name, phone || '', `${doctor.first_name} ${doctor.last_name || ''}`.trim()]
        );

        return {
          success: true,
          booking_id: booking[0]?.id,
          appointment_id: aptId,
          message: `${patient_name} — ${date} ${time} ga band qilindi`,
        };
      });
    },
  };
}

export async function handler(input, ctx) {
  const { db, tenantId } = ctx;
  let text = input.text;

  if (input.audio && !text) {
    const stt = await transcribe(input.audio, 'reception.webm', { language: input.language });
    if (stt.error) return { error: `Transkripsiya xatosi: ${stt.error}`, code: 'STT_ERROR' };
    text = stt.text;
  }

  const today = new Date().toISOString().slice(0, 10);
  const messages = [
    {
      role: 'system',
      content: `Siz klinikaning professional ovozli AI qabulxonasisiz. Bugungi sana: ${today}.
Qoidalar:
1. Ovozli muloqot — javoblar qisqa bo'lsin (maksimal 2-3 gap).
2. Shifokor grafigini bilish uchun FAQAT check_availability vositasidan foydalaning, vaqtni o'zingizdan o'ylab topmang.
3. Bemor vaqtni tanlagach, ism va telefonini so'rab confirm_booking ni chaqiring.
4. Bemor qaysi tilda gapirsa (o'zbek yoki rus), shu tilda javob bering.`,
    },
    ...(input.history || []),
  ];
  if (text) messages.push({ role: 'user', content: text });

  try {
    const result = await runToolLoop({
      messages,
      tools: TOOLS,
      handlers: makeHandlers(db, tenantId),
      maxRounds: 3,
      temperature: 0.1,
      maxTokens: 1200,
    });
    return {
      text: result.text,
      transcript: input.audio ? text : undefined,
      tools_used: result.toolCalls,
      history: result.messages,
    };
  } catch (e) {
    return { error: `Qabulxona agenti xatosi: ${e.message}`, code: 'AGENT_ERROR' };
  }
}
