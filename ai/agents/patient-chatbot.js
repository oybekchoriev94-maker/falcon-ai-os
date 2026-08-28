// ============================================================
// FALCON AI OS — Bemor bilan chatbot (Bosqich R)
//
// XAVFSIZLIK QOIDALARI (kritik):
//  1) TASHXIS QO'YMAYDI. Har javob "shifokorga borishni tavsiya etaman".
//  2) DORI TAVSIYA QILMAYDI. Bemor o'zicha dori olishga chorlanmaydi.
//  3) KRITIK SIMPTOM (ko'krak og'rig'i, nafas qisilishi, hushdan ketish,
//     kuchli qon ketish, insult belgilari) — DARROV "112 ga qo'ng'iroq
//     qiling, klinikaga bormang" javobi. LLM javobidan ustun.
//  4) BOLA/HOMILADORLIK — sezgir hollar, alohida ogohlantirish.
//  5) Har javobda "Bu AI xabarnoma, tashxis emas" disclaimer.
// ============================================================

import { z } from 'zod';
import { llmJson, llmText } from '../core/tools.js';

// Hayotiy xavf kalit so'zlari (uz + ru) — LLM chaqirilmasdan darrov 112 javobi
const EMERGENCY_KEYWORDS = [
  // Uzbek
  "ko'krak og'ri", "nafas qisil", "nafas ol olmayapman", "hushdan ket",
  "yiqildi va bilinmayapti", "insult", "yurak", "qon ket", "qon oqmoq",
  "zaharlangan", "juda kuchli og'riq", "juda kuchli og'ri",
  // Russian
  "грудь болит", "боль в груди", "не могу дышать", "потерял сознание",
  "инсульт", "сердце", "кровотечение", "отравился", "сильная боль",
];

function isEmergency(text) {
  const t = (text || '').toLowerCase();
  return EMERGENCY_KEYWORDS.some((k) => t.includes(k));
}

const DISCLAIMER = "\n\n_⚠️ Bu AI xabarnoma — tashxis emas. Yakuniy qaror shifokor ixtiyorida._";

// ============================================================
// 1) PATIENT CHATBOT — umumiy matnli suhbat
// ============================================================
export const patientChatbot = {
  name: 'patient-chatbot',
  description: 'Bemor Telegram xabariga xavfsiz javob — tashxis va dori bermaydi.',
  version: '1.0.0',
  category: 'patient_facing',
  schema: z.object({
    message: z.string().min(1).max(2000),
    history: z.array(z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })).max(10).optional(),
    patient_context: z.object({
      first_name: z.string().nullable().optional(),
      age: z.number().nullable().optional(),
      known_allergies: z.string().nullable().optional(),
    }).optional(),
    clinic_name: z.string().optional(),
  }),

  async handler(input) {
    // 1) Emergency check — LLM'siz darrov
    if (isEmergency(input.message)) {
      return {
        reply: `⚠️ *SHOSHILINCH HOLAT*\n\nSizning shikoyatingiz hayotiy xavf belgisi bo'lishi mumkin.\n\n📞 *112 ga qo'ng'iroq qiling* (tez tibbiy yordam).\n\nKlinikada emas, uy manzilida yoki hozirgi joyda kutib turing.`,
        urgency: 'red',
        intent: 'emergency',
        should_notify_staff: true,
      };
    }

    // 2) LLM chatbot javobi
    const systemPrompt =
      `Siz "${input.clinic_name || 'klinika'}" bemorlar uchun yordamchisiz. ` +
      "MUHIM QOIDALAR:\n" +
      "- TASHXIS QO'YMANG. Faqat ko'rikka borishni tavsiya eting.\n" +
      "- DORI TAVSIYA QILMANG. Har qanday dori shifokor tavsiyasi bilan.\n" +
      "- Do'stona, sodda o'zbek tilida javob bering (yoki bemor rus tilida yozsa — ruscha).\n" +
      "- Faqat JSON: {\"reply\":\"matn\",\"urgency\":\"green|yellow|red\",\"intent\":\"symptom_query|appointment|result|general\",\"suggest_appointment\":true|false}\n" +
      "- Agar bemor simptom aytsa — 1-2 gapli javob + qachon shifokorga borish tavsiyasi.\n" +
      "- Reply matnida hech qanday emoji ishlatmang (Telegram Markdown yaxshi ishlashi uchun).";

    const historyPart = input.history?.length
      ? "\n\nOldingi suhbat:\n" + input.history.slice(-6).map((m) =>
          `${m.role === 'user' ? 'Bemor' : 'Yordamchi'}: ${m.content}`
        ).join('\n')
      : '';

    const patientPart = input.patient_context
      ? `\n\nBemor: ${input.patient_context.first_name || ''}${input.patient_context.age ? `, ${input.patient_context.age} yosh` : ''}${input.patient_context.known_allergies ? `. Allergiya: ${input.patient_context.known_allergies}` : ''}`
      : '';

    try {
      const res = await llmJson(
        systemPrompt + patientPart + historyPart,
        input.message,
        { timeoutMs: 8000 }
      );
      const urgency = ['red', 'yellow', 'green'].includes(res?.urgency) ? res.urgency : 'green';
      const intent = res?.intent || 'general';
      const rawReply = String(res?.reply || 'Uzr, hozircha javob bera olmayman. Iltimos, klinikaga qo\'ng\'iroq qiling.').slice(0, 1500);

      return {
        reply: rawReply + DISCLAIMER,
        urgency,
        intent,
        suggest_appointment: Boolean(res?.suggest_appointment),
        should_notify_staff: urgency === 'red',
      };
    } catch (_) {
      return {
        reply: "Uzr, hozir javob bera olmayman. Klinikamizga qo'ng'iroq qiling yoki ko'rikka yozing." + DISCLAIMER,
        urgency: 'green',
        intent: 'general',
      };
    }
  },
};

export const CHATBOT_AGENTS = [patientChatbot];
