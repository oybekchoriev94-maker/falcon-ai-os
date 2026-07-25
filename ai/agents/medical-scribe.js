// ============================================================
// Medical Scribe Agent — shifokor diktantidan tibbiy kartani ajratadi
// ============================================================

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { llmJson } from '../core/tools.js';
import { transcribe } from '../engines/stt.js';
import { MEDICAL_SKILLS } from '../protocols/medical-skills.js';

export const name = 'medical-scribe';
export const description = 'Shifokor diktantini tahlil qilib, tashxis, muolaja, dori va hayotiy ko\'rsatkichlarni ajratib beradi';
export const version = '3.0.0';
export const category = 'clinical';

export const schema = z.object({
  text: z.string().min(3).optional(),
  audio: z.any().optional(),
  language: z.enum(['uz', 'ru']).optional(),
  specialty: z.string().max(50).optional(),
  doctor_id: z.string().uuid().optional(),
  save: z.boolean().optional(),
}).refine((d) => d.text || d.audio, { message: 'text yoki audio talab qilinadi' });

const BASE_PROMPT = `Siz tibbiy diktantni tahlil qiluvchi yordamchisiz.
Diktant o'zbek yoki rus tilida bo'lishi mumkin — ikkalasini ham tushunasiz.
Faqat JSON qaytaring, boshqa matn qo'shmang:
{
  "patient_name": "string|null",
  "diagnosis": "string",
  "procedure": "string|null",
  "medicines": "string|null",
  "symptoms": "string|null",
  "vitals": { "bp": "string|null", "pulse": "string|null", "temp": "string|null", "spo2": "string|null" },
  "recommendations": "string|null",
  "referral_needed": "string|null",
  "confidence": 0.0
}
ICD-10 kodini aniq bilmasangiz, faqat tashxis nomini yozing.`;

export async function handler(input, ctx) {
  const { db, tenantId } = ctx;
  let text = input.text;

  // 1. Audio bo'lsa — transkripsiya
  if (input.audio && !text) {
    const stt = await transcribe(input.audio, 'scribe.webm', { language: input.language });
    if (stt.error) return { error: `Transkripsiya xatosi: ${stt.error}`, code: 'STT_ERROR' };
    text = stt.text;
  }
  if (!text || text.trim().length < 3) {
    return { error: 'Diktant matni juda qisqa', code: 'INPUT_TOO_SHORT' };
  }

  // 2. Mutaxassislik shabloni (bo'lsa) yoki umumiy shablon
  const skill = input.specialty ? MEDICAL_SKILLS[input.specialty] : null;
  const prompt = skill
    ? `${skill.systemPrompt}\n\nDiktant o'zbek yoki rus tilida bo'lishi mumkin — JSON kalitlarini o'zgartirmang.`
    : BASE_PROMPT;

  const analysis = await llmJson(prompt, text, { temperature: 0.05, maxTokens: 1500 });
  if (!analysis || analysis.error) {
    return { error: `AI tahlil xatosi: ${analysis?.error || 'javob olinmadi'}`, code: 'LLM_ERROR' };
  }
  if (typeof analysis !== 'object') {
    return { error: 'AI tuzilgan JSON qaytarmadi', code: 'LLM_BAD_FORMAT' };
  }

  // 3. Saqlash (ixtiyoriy) — har doim tenant chegarasida
  let consultationId = null;
  if (input.save !== false && input.doctor_id) {
    const doctor = await db.qGet(
      'SELECT id FROM doctors WHERE id = $1 AND tenant_id = $2',
      [input.doctor_id, tenantId]
    );
    if (!doctor) return { error: 'Shifokor topilmadi', code: 'DOCTOR_NOT_FOUND' };

    consultationId = uuidv4();
    await db.qExec(
      `INSERT INTO patient_consultations (id, tenant_id, doctor_id, patient_name, raw_text, data_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [consultationId, tenantId, input.doctor_id, analysis.patient_name || 'Noma\'lum', text, JSON.stringify(analysis)]
    );
  }

  return {
    raw_text: text,
    analysis,
    specialty: input.specialty || 'general',
    consultation_id: consultationId,
    saved: !!consultationId,
  };
}
