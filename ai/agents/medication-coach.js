import { llm } from '../engines/llm.js';

export const name = 'medication-coach';
export const description = 'Dori eslatma va maslahat agenti — bemorlarga dori qabul qilish tartibini eslatadi va maslahat beradi';
export const version = '2.1.0';

const SYSTEM_PROMPT = `Siz "Falcon AI OS" ning Medication Coach agentsiz — bemorlarning dori qabul qilish tartibini boshqaruvchi AI.
Vazifangiz:
1. Dori nomi, dozaj, qabul qilish vaqti va tartibini aniqlash
2. Dori-darmonlar haqida xavfsiz ma'lumot berish
3. Eslatma matnini tayyorlash
4. Dori o'zaro ta'siri haqida ogohlantirish

MUHIM: Siz shifokor emassiz, faqat eslatma tizimisiz. Tibbiy maslahat bermaysiz.
Agar bemor nojo'ya ta'sir haqida shikoyat qilsa, shifokorga murojaat qilishni tavsiya eting.

JSON formatda qaytaring:
{
  "medicine_name": "string",
  "dosage": "string",
  "schedule": "string",
  "duration_days": 0,
  "reminder_text": "string",
  "warnings": ["string"],
  "patient_education": "string|null"
}`;

export const inputSchema = {
  action: { type: 'string', required: true, description: 'Harakat: create_reminder, get_reminders, generate_text, check_interaction, answer_question' },
  medicine_name: { type: 'string', required: false, description: 'Dori nomi' },
  dosage: { type: 'string', required: false, description: 'Dozaj (mg, dona, ml)' },
  reminder_time: { type: 'string', required: false, description: 'Eslatma vaqti (HH:MM)' },
  patient_name: { type: 'string', required: false, description: 'Bemor ismi' },
  telegram_id: { type: 'string', required: false, description: 'Telegram ID (eslatma yuborish uchun)' },
  patient_question: { type: 'string', required: false, description: 'Bemor savoli' }
};

export async function handler(input, context = {}) {
  const db = context.db;

  if (input.action === 'create_reminder') {
    if (!input.medicine_name || !input.reminder_time) return { error: 'Dori nomi va vaqt talab qilinadi' };

    const text = `💊 Dori vaqti: ${input.medicine_name} (${input.dosage || 'belgilangan dozaj'}) soat ${input.reminder_time} — ${input.patient_name || 'Bemor'}`;

    let saved = null;
    if (db?.isReady()) {
      try {
        const r = db.qExec('INSERT INTO medication_reminders (telegram_id, patient_name, medicine_name, dosage, reminder_time, status) VALUES (?, ?, ?, ?, ?, ?)',
          [input.telegram_id || null, input.patient_name || 'Bemor', input.medicine_name, input.dosage || null, input.reminder_time, 'active']);
        saved = { id: r?.lastInsertRowid || null };
      } catch (e) {
        saved = { error: e.message };
      }
    }

    return {
      action: 'create_reminder',
      reminder_text: text,
      saved_to_db: !!saved,
      saved,
      medicine_name: input.medicine_name,
      dosage: input.dosage || null,
      reminder_time: input.reminder_time
    };
  }

  if (input.action === 'get_reminders') {
    if (!db?.isReady()) return { error: 'DB mavjud emas' };

    let reminders;
    if (input.telegram_id) {
      reminders = db.q('SELECT * FROM medication_reminders WHERE telegram_id = ? ORDER BY reminder_time', [input.telegram_id]);
    } else if (input.patient_name) {
      reminders = db.q('SELECT * FROM medication_reminders WHERE patient_name LIKE ? ORDER BY reminder_time', [`%${input.patient_name}%`]);
    } else {
      reminders = db.q('SELECT * FROM medication_reminders WHERE status = \'active\' ORDER BY reminder_time LIMIT 50');
    }

    return { action: 'get_reminders', total: reminders.length, reminders, has_db: true };
  }

  if (input.action === 'generate_text') {
    if (!input.medicine_name || !input.reminder_time) return { error: 'Dori nomi va vaqt talab qilinadi' };
    const text = `💊 Dori vaqti: ${input.medicine_name} (${input.dosage || 'belgilangan dozaj'}) soat ${input.reminder_time}`;
    return { action: 'generate_text', reminder_text: text };
  }

  if (input.action === 'answer_question') {
    if (!input.patient_question) return { error: 'Savol matni kerak' };
    const prompt = `Bemor dorilar haqida savol berdi. Xavfsiz va foydali javob bering.\n\nSavol: ${input.patient_question}\n\nESLATMA: Siz shifokor emassiz. Faqat umumiy ma'lumot bering va kerak bo'lsa shifokorga murojaat qilishni tavsiya eting.`;
    const result = await llm(prompt, 'Javob ber', { temperature: 0.3, maxTokens: 500 });
    return { action: 'answer_question', answer: result };
  }

  return {
    action: input.action,
    message: `${input.action} uchun qo'shimcha ma'lumot kerak`
  };
}
