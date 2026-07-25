// ============================================================
// Medication Coach Agent — dori eslatmalari va bemor savollariga javob
//
// MUHIM: bu agent shifokor emas. Tibbiy tashxis yoki davolash tayinlamaydi.
// ============================================================

import { z } from 'zod';
import { llmJson } from '../core/tools.js';

export const name = 'medication-coach';
export const description = 'Dori eslatma agenti — qabul tartibini eslatadi va umumiy ma\'lumot beradi';
export const version = '3.0.0';
export const category = 'patient';

export const schema = z.object({
  action: z.enum(['create_reminder', 'get_reminders', 'delete_reminder', 'answer_question']),
  medicine_name: z.string().max(255).optional(),
  dosage: z.string().max(100).optional(),
  reminder_time: z.string().regex(/^\d{2}:\d{2}$/, 'Vaqt HH:MM formatida bo\'lishi kerak').optional(),
  patient_name: z.string().max(255).optional(),
  telegram_id: z.string().max(100).optional(),
  reminder_id: z.union([z.string(), z.number()]).optional(),
  patient_question: z.string().max(1000).optional(),
});

const QA_PROMPT = `Siz klinikaning dori eslatma yordamchisisiz — SHIFOKOR EMASSIZ.
Bemor savoliga xavfsiz, umumiy ma'lumot bering (o'zbek yoki rus tilida, savol qaysi tilda bo'lsa).
QAT'IY QOIDALAR:
- Tashxis qo'ymang, dori tayinlamang, dozani o'zgartirishni maslahat bermang.
- Nojo'ya ta'sir yoki xavotir bo'lsa — shifokorga murojaat qilishni ayting.
Faqat JSON qaytaring:
{"answer": "string", "see_doctor": true, "disclaimer": "Bu tibbiy maslahat emas"}`;

export async function handler(input, ctx) {
  const { db, tenantId } = ctx;

  if (input.action === 'create_reminder') {
    if (!input.medicine_name || !input.reminder_time) {
      return { error: 'Dori nomi va eslatma vaqti talab qilinadi', code: 'MISSING_FIELDS' };
    }
    const rows = await db.q(
      `INSERT INTO medication_reminders (tenant_id, telegram_id, patient_name, medicine_name, dosage, reminder_time, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING id`,
      [tenantId, input.telegram_id || null, input.patient_name || 'Bemor',
       input.medicine_name, input.dosage || null, input.reminder_time]
    );
    return {
      action: 'create_reminder',
      reminder_id: rows[0]?.id,
      reminder_text: `Dori vaqti: ${input.medicine_name} (${input.dosage || 'belgilangan doza'}) — soat ${input.reminder_time}`,
      saved: true,
    };
  }

  if (input.action === 'get_reminders') {
    let reminders;
    if (input.telegram_id) {
      reminders = await db.q(
        `SELECT id, medicine_name, dosage, reminder_time, status, patient_name FROM medication_reminders
         WHERE tenant_id = $1 AND telegram_id = $2 AND status = 'active' ORDER BY reminder_time`,
        [tenantId, input.telegram_id]
      );
    } else if (input.patient_name) {
      reminders = await db.q(
        `SELECT id, medicine_name, dosage, reminder_time, status, patient_name FROM medication_reminders
         WHERE tenant_id = $1 AND patient_name ILIKE $2 AND status = 'active' ORDER BY reminder_time`,
        [tenantId, `%${input.patient_name}%`]
      );
    } else {
      reminders = await db.q(
        `SELECT id, medicine_name, dosage, reminder_time, status, patient_name FROM medication_reminders
         WHERE tenant_id = $1 AND status = 'active' ORDER BY reminder_time LIMIT 100`,
        [tenantId]
      );
    }
    return { action: 'get_reminders', total: reminders.length, reminders };
  }

  if (input.action === 'delete_reminder') {
    if (!input.reminder_id) return { error: 'reminder_id talab qilinadi', code: 'MISSING_FIELDS' };
    const res = await db.qExec(
      `UPDATE medication_reminders SET status = 'deleted' WHERE id = $1 AND tenant_id = $2`,
      [input.reminder_id, tenantId]
    );
    if (!res.rowCount) return { error: 'Eslatma topilmadi', code: 'NOT_FOUND' };
    return { action: 'delete_reminder', deleted: true };
  }

  if (input.action === 'answer_question') {
    if (!input.patient_question) return { error: 'Savol matni kerak', code: 'MISSING_FIELDS' };
    const result = await llmJson(QA_PROMPT, input.patient_question, { temperature: 0.3, maxTokens: 600 });
    const answer = (result && typeof result === 'object') ? result : { answer: String(result || ''), see_doctor: true };
    return {
      action: 'answer_question',
      ...answer,
      disclaimer: 'Bu tibbiy maslahat emas. Aniq savollar uchun shifokorga murojaat qiling.',
    };
  }

  return { error: `Noma'lum amal: ${input.action}`, code: 'UNKNOWN_ACTION' };
}
