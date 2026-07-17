import { llm } from '../engines/llm.js';
import { v4 as uuidv4 } from 'uuid';

export const name = 'b2b-referral';
export const description = 'B2B yo\'llanma agenti — bemorni eng mos hamkor klinikaga yo\'naltiradi va split-kassa hisoblaydi';
export const version = '2.1.0';

const SYSTEM_PROMPT = `Siz "Falcon AI OS" ning B2B Referral agentsiz — klinikalararo yo'llanma tizimining sun'iy intellekti.
Vazifangiz: bemorning muolaja turiga qarab eng mos hamkor klinikani tavsiya qilish va moliyaviy hisob-kitob qilish.

Split-kassa formulasi:
- Hamkor klinika ulushi (partner_commission): 40%
- Shifokor ulushi (doctor_share): 20%
- Platforma to'lovi (platform_fee): 2000 so'm (fixed)
- Yuboruvchi klinika ulushi: qolgan qismi

JSON formatda qaytaring:
{
  "recommended_clinic": "string|null",
  "confidence": 0.0,
  "service_category": "string",
  "estimated_cost": 0,
  "split": {
    "partner_commission": 0,
    "doctor_share": 0,
    "platform_fee": 2000,
    "sender_share": 0
  },
  "reasoning": "string",
  "urgency": "low|normal|high"
}`;

export const inputSchema = {
  patient_name: { type: 'string', required: true, description: 'Bemor ismi' },
  service_required: { type: 'string', required: true, description: 'Kerakli xizmat yoki muolaja' },
  sender_clinic: { type: 'string', required: false, description: 'Yuboruvchi klinika' },
  preferred_clinic: { type: 'string', required: false, description: 'Bemor tanlagan klinika' },
  estimated_amount: { type: 'number', required: false, description: 'Taxminiy summa' },
  referring_doctor: { type: 'string', required: false, description: 'Yuboruvchi shifokor ismi' },
  auto_save: { type: 'boolean', required: false, description: 'Avtomatik DB ga saqlash' }
};

export async function handler(input, context = {}) {
  const db = context.db;
  const prompt = SYSTEM_PROMPT + `\n\nBemor: ${input.patient_name}\nKerakli xizmat: ${input.service_required}\nYuboruvchi klinika: ${input.sender_clinic || 'Noma\'lum'}\nTaxminiy summa: ${input.estimated_amount || 0}`;

  const result = await llm(prompt, 'Yo\'llanma tahlil qil', { temperature: 0.1, maxTokens: 1000 });
  if (result.error) return { error: `AI tahlil xatosi: ${result.error}` };

  const total = input.estimated_amount || result.estimated_cost || 0;
  const split = {
    partner_commission: Math.round(total * 0.4),
    doctor_share: Math.round(total * 0.2),
    platform_fee: 2000,
    sender_share: Math.round(total * 0.4) - 2000
  };

  let savedReferral = null;
  if (db?.isReady() && input.auto_save && input.patient_name) {
    try {
      const id = uuidv4();
      const referralId = 'REF-' + Date.now().toString(36).toUpperCase();
      const token = uuidv4().replace(/-/g, '').slice(0, 16);
      db.qExec('INSERT INTO referrals (id, referral_id, sender_clinic_id, patient_name, service_required, status, qr_code_token, referring_doctor, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, referralId, input.sender_clinic || null, input.patient_name, input.service_required, 'pending', token, input.referring_doctor || null, JSON.stringify(result)]);
      db.qExec('INSERT INTO financial_transactions (id, referral_id, total_amount, partner_commission, doctor_share, platform_fee, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uuidv4(), id, total, split.partner_commission, split.doctor_share, 2000, 'unpaid']);
      savedReferral = { id, referral_id: referralId, qr_token: token, split };
    } catch (e) {
      savedReferral = { error: e.message };
    }
  }

  return {
    referral: {
      patient_name: input.patient_name,
      service_required: input.service_required,
      recommended_clinic: result.recommended_clinic || null,
      confidence: result.confidence || 0.5,
      urgency: result.urgency || 'normal'
    },
    financial_split: split,
    saved: !!savedReferral,
    saved_referral: savedReferral,
    ai_analysis: result
  };
}
