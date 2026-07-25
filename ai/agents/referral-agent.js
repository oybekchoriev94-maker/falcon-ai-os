// ============================================================
// Referral Agent — hamkorlar (QR referral) va ularning balansi
// ============================================================

import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

export const name = 'referral-agent';
export const description = 'QR referral agenti — hamkorlar uchun kod yaratadi, konvertatsiya va balansni boshqaradi';
export const version = '3.0.0';
export const category = 'referral';

export const schema = z.object({
  action: z.enum(['generate_qr', 'convert', 'adjust_balance', 'get_partner', 'get_stats']),
  partner_name: z.string().max(255).optional(),
  partner_phone: z.string().max(50).optional(),
  partner_id: z.string().optional(),
  partner_code: z.string().max(64).optional(),
  referral_code: z.string().max(64).optional(),
  patient_id: z.string().uuid().optional(),
  total_amount: z.number().nonnegative().optional(),
  amount: z.number().positive().optional(),
  type: z.enum(['topup', 'payout']).optional(),
  note: z.string().max(500).optional(),
});

const PARTNER_RATE = 0.40;
const DOCTOR_RATE = 0.20;
const PLATFORM_FEE = 2000;

export async function handler(input, ctx) {
  const { db, tenantId } = ctx;
  const { action } = input;

  // ─── Yangi hamkor + QR kod ────────────────────────────────
  if (action === 'generate_qr') {
    if (!input.partner_name) return { error: 'partner_name talab qilinadi', code: 'MISSING_FIELDS' };
    const id = uuidv4();
    const referralCode = 'PRT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const qrToken = 'QR-' + uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();

    await db.qExec(
      `INSERT INTO referral_partners (id, tenant_id, name, phone, referral_code, qr_code_base64, balance)
       VALUES ($1, $2, $3, $4, $5, $6, 0)`,
      [id, tenantId, input.partner_name, input.partner_phone || '', referralCode, qrToken]
    );

    return {
      action, partner: { id, name: input.partner_name, referral_code: referralCode },
      qr_code_token: qrToken,
      qr_endpoint: `/api/referral/qr/${qrToken}`,
    };
  }

  // ─── Bemorni hamkor bo'yicha konvertatsiya qilish ─────────
  if (action === 'convert') {
    if (!input.referral_code && !input.partner_id) {
      return { error: 'referral_code yoki partner_id talab qilinadi', code: 'MISSING_FIELDS' };
    }
    if (!input.patient_id) return { error: 'patient_id talab qilinadi', code: 'MISSING_FIELDS' };

    return db.transaction(async (tx) => {
      const partner = await tx.qGet(
        `SELECT id, name, balance FROM referral_partners
         WHERE tenant_id = $1 AND (referral_code = $2 OR id::text = $3)`,
        [tenantId, input.referral_code || '', input.partner_id || '']
      );
      if (!partner) return { error: 'Hamkor topilmadi', code: 'PARTNER_NOT_FOUND' };

      const patient = await tx.qGet(
        'SELECT id, first_name, last_name FROM patients WHERE id = $1 AND tenant_id = $2',
        [input.patient_id, tenantId]
      );
      if (!patient) return { error: 'Bemor topilmadi', code: 'PATIENT_NOT_FOUND' };

      const total = Number(input.total_amount || 0);
      const partnerCommission = Math.round(total * PARTNER_RATE);
      const doctorShare = Math.round(total * DOCTOR_RATE);
      const patientName = `${patient.first_name} ${patient.last_name || ''}`.trim();

      const refId = 'REF-' + Date.now().toString(36).toUpperCase();
      const qrToken = 'QR-' + uuidv4().replace(/-/g, '').slice(0, 16).toUpperCase();
      const id = uuidv4();

      await tx.qExec(
        `INSERT INTO referrals (id, tenant_id, referral_id, patient_name, service_required, status,
                                qr_code_token, referring_doctor, partner_id, patient_id)
         VALUES ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9)`,
        [id, tenantId, refId, patientName, 'Hamkor yo\'llanmasi', qrToken, partner.name, partner.id, patient.id]
      );
      await tx.qExec(
        `INSERT INTO financial_transactions (id, tenant_id, referral_id, total_amount, partner_commission,
                                             doctor_share, platform_fee, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'unpaid')`,
        [uuidv4(), tenantId, id, total, partnerCommission, doctorShare, PLATFORM_FEE]
      );
      await tx.qExec(
        'UPDATE referral_partners SET balance = COALESCE(balance,0) + $1 WHERE id = $2 AND tenant_id = $3',
        [partnerCommission, partner.id, tenantId]
      );

      return {
        action,
        referral: { id: refId, patient_name: patientName, total, status: 'completed' },
        commission: { partner_commission: partnerCommission, doctor_share: doctorShare, platform_fee: PLATFORM_FEE },
        partner_balance: Number(partner.balance || 0) + partnerCommission,
      };
    });
  }

  // ─── Hamkor balansini to'ldirish/yechish ──────────────────
  if (action === 'adjust_balance') {
    if (!input.partner_id) return { error: 'partner_id talab qilinadi', code: 'MISSING_FIELDS' };
    if (!input.note) return { error: 'Izoh (note) majburiy', code: 'MISSING_FIELDS' };
    if (!input.type) return { error: 'type: topup yoki payout', code: 'MISSING_FIELDS' };
    const amount = Math.abs(Number(input.amount || 0));
    if (!amount) return { error: 'amount musbat son bo\'lishi kerak', code: 'INVALID_AMOUNT' };

    return db.transaction(async (tx) => {
      const partner = await tx.qGet(
        'SELECT id, balance FROM referral_partners WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [input.partner_id, tenantId]
      );
      if (!partner) return { error: 'Hamkor topilmadi', code: 'PARTNER_NOT_FOUND' };

      const balance = Number(partner.balance || 0);
      if (input.type === 'payout' && balance < amount) {
        return { error: `Balans yetarli emas. Mavjud: ${balance}, so'ralgan: ${amount}`, code: 'INSUFFICIENT_BALANCE' };
      }

      const delta = input.type === 'topup' ? amount : -amount;
      await tx.qExec(
        'UPDATE referral_partners SET balance = COALESCE(balance,0) + $1 WHERE id = $2 AND tenant_id = $3',
        [delta, partner.id, tenantId]
      );
      await tx.qExec(
        'INSERT INTO partner_transactions (tenant_id, partner_id, type, amount, note) VALUES ($1, $2, $3, $4, $5)',
        [tenantId, partner.id, input.type, amount, input.note]
      );

      return {
        action, partner_id: partner.id, type: input.type, amount, note: input.note,
        previous_balance: balance, new_balance: balance + delta,
      };
    });
  }

  // ─── Bitta hamkor ma'lumoti ───────────────────────────────
  if (action === 'get_partner') {
    const partner = await db.qGet(
      `SELECT id, name, phone, referral_code, balance, created_at FROM referral_partners
       WHERE tenant_id = $1 AND (id::text = $2 OR referral_code = $3)`,
      [tenantId, input.partner_id || '', input.partner_code || '']
    );
    if (!partner) return { error: 'Hamkor topilmadi', code: 'PARTNER_NOT_FOUND' };

    const [transactions, referrals] = await Promise.all([
      db.q(
        'SELECT type, amount, note, created_at FROM partner_transactions WHERE tenant_id = $1 AND partner_id = $2 ORDER BY created_at DESC LIMIT 20',
        [tenantId, partner.id]
      ),
      db.q(
        'SELECT referral_id, patient_name, status, created_at FROM referrals WHERE tenant_id = $1 AND partner_id = $2 ORDER BY created_at DESC LIMIT 20',
        [tenantId, partner.id]
      ),
    ]);
    return { action, partner, transactions, referrals };
  }

  // ─── Umumiy statistika ────────────────────────────────────
  if (action === 'get_stats') {
    const [totals, refStats, partners] = await Promise.all([
      db.qGet(
        'SELECT COUNT(*)::int AS total_partners, COALESCE(SUM(balance),0) AS total_balance FROM referral_partners WHERE tenant_id = $1',
        [tenantId]
      ),
      db.qGet(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending
         FROM referrals WHERE tenant_id = $1 AND partner_id IS NOT NULL`,
        [tenantId]
      ),
      db.q(
        'SELECT id, name, referral_code, balance FROM referral_partners WHERE tenant_id = $1 ORDER BY balance DESC LIMIT 50',
        [tenantId]
      ),
    ]);
    return {
      action,
      total_partners: totals?.total_partners || 0,
      total_balance: Number(totals?.total_balance || 0),
      total_referrals: refStats?.total || 0,
      completed_referrals: refStats?.completed || 0,
      pending_referrals: refStats?.pending || 0,
      partners,
    };
  }

  return { error: `Noma'lum amal: ${action}`, code: 'UNKNOWN_ACTION' };
}
