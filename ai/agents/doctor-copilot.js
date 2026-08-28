// ============================================================
// FALCON AI OS — Shifokor Copilot agentlari (Bosqich Q)
//
// XAVFSIZLIK ASOSIY QOIDA:
// AI HECH QANDAY klinik harakat BAJARMAYDI. Faqat TAKLIF beradi.
// Har taklif ai_action_proposals ga yoziladi (status='pending').
// Shifokor UI'da ko'radi, tahrirlaydi, "Bajar" tugmasi bilan tasdiqlaydi.
// Faqat shundan so'ng haqiqiy INSERT/UPDATE bajariladi.
//
// COPILOT — shifokor yordamchisi, hech qachon shifokorning o'zi emas.
// LLM hallucinatsiyasi klinik xavfli — shu tufayli barcha chiqishlar
// PROPOSE (taklif) darajada qoladi.
// ============================================================

import { z } from 'zod';
import { llmJson, llmText } from '../core/tools.js';
import { transcribe } from '../engines/stt.js';

// ============================================================
// 1) VOICE COMMAND AGENT
//    Shifokor gapiradi: "Aliyevga ertaga UZI buyur va parhez stoli 5"
//    Chiqish: bir yoki bir necha action_proposal (pending).
//    LLM structured JSON qaytaradi — biz uni takliflarga o'giramiz.
// ============================================================
export const voiceCommand = {
  name: 'voice-command',
  description: 'Shifokor ovoz buyrug\'idan bajariladigan harakatlar taklifi (propose only).',
  version: '1.0.0',
  category: 'copilot',
  schema: z.object({
    text: z.string().min(2).optional(),
    audio: z.any().optional(),
    language: z.enum(['uz', 'ru']).optional(),
    patient_context: z.object({
      name: z.string().optional(),
      allergies: z.string().nullable().optional(),
    }).optional(),
  }).refine((d) => d.text || d.audio, { message: 'text yoki audio kerak' }),

  async handler(input) {
    let text = input.text;
    if (!text && input.audio) {
      const stt = await transcribe(input.audio, 'command.webm', { language: input.language });
      if (stt.error) return { error: stt.error, code: 'STT_ERROR', proposals: [] };
      text = stt.text;
    }
    if (!text || text.length < 3) return { error: 'Bo\'sh matn', proposals: [] };

    const prompt =
      "Siz shifokor ovoz buyrug'ini tuzilgan harakat takliflari (proposals) ga aylantirasiz. " +
      "HECH QANDAY tashxis qo'ymang. Faqat aniq aytilgan HARAKATni ajrating. " +
      "Har taklif JSON: {kind, payload, confidence:0-1, note}. " +
      "kind: 'prescription'|'lab_order'|'admission'|'referral'|'daily_note'|'appointment_note'. " +
      "Faqat JSON: {proposals: [{kind, payload, confidence, note}]}. " +
      "Misollar:\n" +
      "- 'Aliyevga UZI buyur' -> {kind:'lab_order', payload:{test_type:'ultrasound', reason:''}, confidence:0.9}\n" +
      "- 'Parhez 5' -> {kind:'admission', payload:{diet_number:'5'}, confidence:0.85}\n" +
      "- 'Amoksitsillin 500 kunda 3 mahal 7 kun' -> {kind:'prescription', payload:{medicine_name:'Amoksitsillin', dosage:'500 mg', frequency:'kunda 3 mahal', duration_days:7}, confidence:0.9}";

    try {
      const res = await llmJson(prompt, text, { timeoutMs: 6000 });
      const proposals = Array.isArray(res?.proposals) ? res.proposals : [];
      return {
        transcript: text,
        proposals: proposals.slice(0, 10).map((p) => ({
          kind: String(p.kind || '').toLowerCase(),
          payload: p.payload || {},
          confidence: Math.max(0, Math.min(1, Number(p.confidence) || 0.5)),
          note: String(p.note || '').slice(0, 300),
        })).filter((p) => ['prescription', 'lab_order', 'admission', 'referral', 'daily_note', 'appointment_note'].includes(p.kind)),
      };
    } catch (_) {
      return { transcript: text, proposals: [], error: 'LLM ishlamadi' };
    }
  },
};

// ============================================================
// 2) DOCTOR COPILOT CHAT
//    Shifokor savol beradi (matn), LLM ma'lumot beradi.
//    TASHXIS QO'YMAYDI, RETSEPT BERMAYDI. Faqat protokol/tavsiya.
// ============================================================
export const doctorCopilot = {
  name: 'doctor-copilot',
  description: 'Shifokor savoliga klinik protokol asosida tavsiya (tashxis va retsept emas).',
  version: '1.0.0',
  category: 'copilot',
  schema: z.object({
    question: z.string().min(3).max(2000),
    history: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })).max(20).optional(),
    patient_context: z.object({
      age: z.number().nullable().optional(),
      gender: z.string().nullable().optional(),
      allergies: z.string().nullable().optional(),
      active_diagnoses: z.array(z.string()).optional(),
    }).optional(),
  }),

  async handler(input) {
    const systemPrompt =
      "Siz tibbiy protokol yordamchisiz. Sizning ROLI: shifokor savoliga " +
      "TEZ va QISQA javob berish. Standart klinik protokollar, tekshiruv tavsiyalari, " +
      "diferensial ehtimolliklar. LEKIN: TASHXIS QO'YMANG, RETSEPT BERMANG, " +
      "aniq dori dozasini tavsiya qilmang. Barcha javoblar 'ehtimolli', 'ko'rib chiqing', " +
      "'shifokor ixtiyorida' formatida. O'zbek yoki rus tilida javob bering. " +
      "Muhim: bemor xavfli holatda bo'lsa (kritik simptomlar), birinchi navbatda " +
      "shoshilinch yordam chaqirishni tavsiya qiling.";

    const contextPart = input.patient_context
      ? `\n\nBemor konteksti: ${JSON.stringify(input.patient_context)}`
      : '';

    // Suhbat tarixini prompt'ga qo'shamiz (kontekst uchun)
    let convoContext = '';
    if (input.history?.length) {
      convoContext = '\n\nOldingi suhbat:\n' + input.history.slice(-10).map((m) =>
        `${m.role === 'user' ? 'Shifokor' : 'Copilot'}: ${m.content}`
      ).join('\n');
    }

    try {
      const answer = await llmText(
        systemPrompt + contextPart + convoContext,
        input.question,
        { timeoutMs: 10000, maxTokens: 600 }
      );
      // Bo'sh javobni "muvaffaqiyat" deb qaytarmaymiz: shifokor bo'sh
      // oynani ko'rib, savol yetib bormadimi yoki AI javob bermadimi —
      // farqini bilmasdi.
      const clean = String(answer || '').trim();
      if (!clean) {
        return { error: 'AI javob bermadi. Qayta urinib ko\'ring.', code: 'EMPTY_LLM_RESULT', answer: null };
      }
      return {
        answer: clean.slice(0, 2000),
        disclaimer: 'AI tavsiya — yakuniy qaror shifokor ixtiyorida',
      };
    } catch (e) {
      return { error: e.message, answer: null };
    }
  },
};

// ============================================================
// 3) SMART AUTOFILL
//    Erkin matn: "Migren, ibuprofen 400 kunda 3 mahal 5 kun, ovqatdan keyin"
//    Chiqish: barcha maydonlar to'ldirilgan {diagnosis, procedure, medicines[]}.
// ============================================================
export const smartAutofill = {
  name: 'smart-autofill',
  description: 'Shifokor erkin matnidan tuzilgan xulosa maydonlariga ajratish.',
  version: '1.0.0',
  category: 'copilot',
  schema: z.object({
    text: z.string().min(3).max(5000),
    context: z.enum(['visit_complete', 'daily_note', 'discharge']).optional(),
  }),

  async handler(input) {
    const prompt =
      "Shifokor erkin yozgan matndan tuzilgan JSON qaytaring. TASHXIS QO'YMANG — " +
      "faqat matnda BOR narsani ajrating. Faqat JSON: " +
      `{"diagnosis":"","procedure":"","medicines":[{"name":"","dosage":"","frequency":"","duration_days":null}],"notes":""}. ` +
      "Sonlarni raqamlarda yozing.";

    try {
      const res = await llmJson(prompt, input.text, { timeoutMs: 5000 });
      return {
        diagnosis: String(res?.diagnosis || '').slice(0, 500),
        procedure: String(res?.procedure || '').slice(0, 500),
        medicines: Array.isArray(res?.medicines) ? res.medicines.slice(0, 10).map((m) => ({
          name: String(m.name || '').slice(0, 200),
          dosage: String(m.dosage || '').slice(0, 100),
          frequency: String(m.frequency || '').slice(0, 100),
          duration_days: Number(m.duration_days) || null,
        })) : [],
        notes: String(res?.notes || '').slice(0, 1000),
      };
    } catch (_) {
      return { diagnosis: '', procedure: '', medicines: [], notes: '' };
    }
  },
};

export const COPILOT_AGENTS = [voiceCommand, doctorCopilot, smartAutofill];
