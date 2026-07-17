import { llm } from '../engines/llm.js';
import { transcribe } from '../engines/stt.js';
import { v4 as uuidv4 } from 'uuid';

export const name = 'medical-scribe';
export const description = 'Shifokor diktantini tahlil qilib, tashxis, muolaja, dori va vital signallarni ajratib beradi';
export const version = '2.1.0';

const SYSTEM_PROMPT = `Siz "Falcon AI OS" ning Medical Scribe agentsiz — dunyodagi eng ilg'or tibbiy AI asistentsiz.
Vazifangiz: shifokorning ovozli diktantidan quyidagi ma'lumotlarni aniq ajratib olish:

1. **patient_name** — bemor ismi (aniqlanmasa null)
2. **diagnosis** — asosiy tashxis (iloji boricha ICD-10 kod bilan, masalan "I10 — Gipertoniya")
3. **procedure** — bajarilgan yoki tavsiya etilgan muolaja
4. **medicines** — buyurilgan dorilar ro'yxati (nom, dozaj)
5. **symptoms** — bemorning shikoyatlari
6. **vitals** — hayotiy ko'rsatkichlar (bosim, puls, temp, saturatsiya)
7. **recommendations** — shifokor tavsiyalari
8. **referral_needed** — agar boshqa klinikaga yo'llanma kerak bo'lsa, qaysi xizmat
9. **confidence** — 0-1 oralig'ida ishonchlilik bahosi

DIQQAT: Agar ICD-10 kodini aniq bilmasangiz, faqat tashxis nomini yozing.
O'zbek va Rus tillarida gapirilgan diktantlarni tushunasiz.
JSON formatda faqat quyidagi strukturani qaytaring:
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
}`;

export const inputSchema = {
  text: { type: 'string', required: true, description: 'Diktant matni yoki transkripsiya' },
  audio: { type: 'buffer', required: false, description: 'Audio buffer (agar to\'g\'ridan-to\'g\'ri audio yuborilsa)' },
  specialty: { type: 'string', required: false, description: 'Shifokor mutaxassisligi (therapy, ultrasound, surgery, etc.)' },
  doctor_id: { type: 'string', required: false, description: 'Doktor ID (konsultatsiyani saqlash uchun)' }
};

export async function handler(input, context = {}) {
  const db = context.db;
  let text = input.text;

  if (input.audio && !text) {
    const result = await transcribe(input.audio, 'audio.webm');
    if (result.error) return { error: `Transkripsiya xatosi: ${result.error}` };
    text = result.text;
  }

  if (!text || text.trim().length < 3) return { error: 'Diktant matni juda qisqa' };

  let prompt = SYSTEM_PROMPT;
  if (input.specialty) {
    prompt += `\nShifokor mutaxassisligi: ${input.specialty}. Shu yo'nalishga mos tahlil qiling.`;
  }

  const analysis = await llm(prompt, text, { temperature: 0.05, maxTokens: 1500 });
  if (analysis.error) return { error: `AI tahlil xatosi: ${analysis.error}` };

  let savedConsultation = null;
  if (db?.isReady() && input.doctor_id) {
    try {
      const id = uuidv4();
      const patientName = analysis?.patient_name || 'Noma\'lum';
      const dataJson = JSON.stringify(analysis);
      db.qExec('INSERT INTO patient_consultations (id, doctor_id, patient_name, raw_text, data_json) VALUES (?, ?, ?, ?, ?)',
        [id, input.doctor_id, patientName, text, dataJson]);
      savedConsultation = { id, patient_name: patientName };
    } catch (e) {
      savedConsultation = { error: e.message };
    }
  }

  return {
    raw_text: text,
    analysis,
    saved: !!savedConsultation,
    consultation_id: savedConsultation?.id || null,
    specialty_used: input.specialty || 'general'
  };
}
