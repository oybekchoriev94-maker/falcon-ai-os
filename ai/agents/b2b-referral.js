// ============================================================
// B2B Referral Agent — hamkor klinikaga yo'llanma + split-kassa
// ============================================================

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { llmJson } from '../core/tools.js';

export const name = 'b2b-referral';
export const description = 'B2B yo\'llanma agenti — mos hamkor klinikani tavsiya qiladi va split-kassani hisoblaydi';
export const version = '3.0.0';
export const category = 'referral';

export const schema = z.object({
  patient_name: z.string().min(2).max(255),
  service_required: z.string().min(2).max(255),
  sender_clinic: z.string().max(255).optional(),
  preferred_clinic: z.string().max(255).optional(),
  estimated_amount: z.number().nonnegative().optional(),
  referring_doctor: z.string().max(255).optional(),
  save: z.boolean().optional(),
});

// Split-kassa qoidalari (biznes qoidasi — AI o'ylab topmaydi)
const PARTNER_RATE = 0.40;
const DOCTOR_RATE = 0.20;
const PLATFORM_FEE = 2000;

const SYSTEM_PROMPT = `Siz klinikalararo yo'llanma bo'yicha yordamchisiz.
Bemorning kerakli xizmatiga qarab tavsiya bering. Faqat JSON qaytaring:
{
  "recommended_clinic": "string|null",
  "confidence": 0.0,
  "service_category": "string",
  "estimated_cost": 0,
  "reasoning": "string",
  "urgency": "low|normal|high"
}
Javobni o'zbek tilida yozing. Narxni bilmasangiz estimated_cost ni 0 qoldiring.`;

function computeSplit(total) {
  const partner = Math.round(total * PARTNER_RATE);
  const doctor = Math.round(total * DOCTOR_RATE);
  const sender = Math.max(0, total - partner - doctor - PLATFORM_FEE);
  return { total, partner_commission: partner, doctor_share: doctor, platform_fee: PLATFORM_FEE, sender_share: sender };
}

export async function handler(input, ctx) {
  const { db, tenantId } = ctx;

  const context = [
    `Bemor: ${input.patient_name}`,
    `Kerakli xizmat: ${input.service_required}`,
    input.sender_clinic ? `Yuboruvchi klinika: ${input.sender_clinic}` : null,
    input.preferred_clinic ? `Bemor tanlagan klinika: ${input.preferred_clinic}` : null,
    input.estimated_amount ? `Taxminiy summa: ${input.estimated_amount}` : null,
  ].filter(Boolean).join('\n');

  const ai = await llmJson(SYSTEM_PROMPT, context, { temperature: 0.1, maxTokens: 900 });
  const analysis = (ai && typeof ai === 'object') ? ai : { reasoning: String(ai || ''), confidence: 0 };

  const total = Number(input.estimated_amount ?? analysis.estimated_cost ?? 0) || 0;
  const split = computeSplit(total);

  let saved = null;
  if (input.save) {
    saved = await db.transaction(async (tx) => {
      const id = uuidv4();
      const referralId = 'REF-' + Date.now().toString(36).toUpperCase();
      const qrToken = 'QR-' + uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();

      await tx.qExec(
        `INSERT INTO referrals (id, tenant_id, referral_id, sender_clinic_id, receiver_clinic_id, patient_name,
                                service_required, qr_code_token, referring_doctor, notes, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')`,
        [id, tenantId, referralId, input.sender_clinic || null, analysis.recommended_clinic || input.preferred_clinic || null,
         input.patient_name, input.service_required, qrToken, input.referring_doctor || null, JSON.stringify(analysis)]
      );
      await tx.qExec(
        `INSERT INTO financial_transactions (id, tenant_id, referral_id, total_amount, partner_commission,
                                             doctor_share, platform_fee, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'unpaid')`,
        [uuidv4(), tenantId, id, total, split.partner_commission, split.doctor_share, split.platform_fee]
      );
      return { id, referral_id: referralId, qr_token: qrToken };
    });
  }

  return {
    referral: {
      patient_name: input.patient_name,
      service_required: input.service_required,
      recommended_clinic: analysis.recommended_clinic || null,
      confidence: analysis.confidence ?? 0,
      urgency: analysis.urgency || 'normal',
      reasoning: analysis.reasoning || null,
    },
    financial_split: split,
    saved: !!saved,
    saved_referral: saved,
  };
}
