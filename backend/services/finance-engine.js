// Finance Engine — split calculation, atomic balance operations, KPI updates
import crypto from 'crypto';

const PLATFORM_FEE_PERCENT = 3.0;
const DEFAULT_REFERRER_BONUS = 10.0;

export function calcPlatformFee(amount) {
  return Math.round(amount * (PLATFORM_FEE_PERCENT / 100) * 100) / 100;
}

export function calcCommission(amount, percent) {
  return Math.round(amount * (percent / 100) * 100) / 100;
}

// Atomic doctor balance deduction — returns true if sufficient balance
export async function deductDoctorBalance(pool, q, doctorId, amount) {
  const result = await q(
    "UPDATE doctors SET balance = COALESCE(balance, 0) - $1 WHERE id = $2 AND COALESCE(balance, 0) >= $3",
    [amount, doctorId, amount]
  );
  return result.rowCount > 0;
}

// Atomic patient cashback accrual
export async function accruePatientCashback(q, patientId, amount) {
  await q("UPDATE patients SET cashback_balance = COALESCE(cashback_balance, 0) + $1 WHERE id = $2",
    [amount, patientId]);
}

// Atomic patient cashback redeem — returns true if sufficient balance
export async function redeemPatientCashback(q, patientId, amount) {
  const result = await q(
    "UPDATE patients SET cashback_balance = cashback_balance - $1 WHERE id = $2 AND cashback_balance >= $3 RETURNING id",
    [amount, patientId, amount]
  );
  return result.rows.length > 0;
}

// Atomic doctor balance topup
export async function topupDoctorBalance(q, doctorId, amount) {
  await q("UPDATE doctors SET balance = COALESCE(balance, 0) + $1 WHERE id = $2",
    [amount, doctorId]);
}

export async function updateDoctorKPI(q, qGet, doctorId, durationMinutes) {
  try {
    const period = new Date().toISOString().slice(0, 10);
    const doc = await qGet("SELECT id, first_name, last_name FROM doctors WHERE id = $1", [doctorId]);
    if (!doc) return;
    const name = `${doc.first_name} ${doc.last_name}`.trim();
    const dur = durationMinutes || 15;

    await q(
      `INSERT INTO doctor_analytics (doctor_id, doctor_name, patients_count, total_procedures, avg_minutes, period_start, period_end)
       VALUES ($1, $2, 1, 1, $3, $4, $5)
       ON CONFLICT (doctor_id, period_start) DO UPDATE SET
         patients_count = doctor_analytics.patients_count + 1,
         total_procedures = doctor_analytics.total_procedures + 1,
         avg_minutes = CAST((doctor_analytics.avg_minutes * (doctor_analytics.patients_count - 1) + $6) AS REAL) / doctor_analytics.patients_count`,
      [doctorId, name, dur, period, period, dur]);
  } catch (e) { console.error('[KPI] Doktor statistikasini yangilashda xatolik:', e.message); }
}

export async function recordPlatformLedger(q, data) {
  await q(
    `INSERT INTO platform_ledger (booking_id, referral_id, doctor_id, total_amount, platform_fee_percent, platform_amount, referrer_id, referrer_bonus_percent, referrer_amount, clinic_amount, remaining_balance, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'completed')`,
    [data.booking_id, data.referral_id || null, data.doctor_id || null, data.total_amount, PLATFORM_FEE_PERCENT,
     data.platform_amount, data.referrer_id || null, data.referrer_bonus_percent || 0, data.referrer_amount || 0,
     data.clinic_amount, data.doctor_balance]);
}

export async function upsertFinancialTransaction(q, qGet, referralId, total, referrerAmount, platformAmount) {
  const existingTx = await qGet("SELECT id FROM financial_transactions WHERE referral_id = $1", [referralId]);
  if (existingTx) {
    await q("UPDATE financial_transactions SET total_amount = $1, partner_commission = $2, doctor_share = $3, platform_fee = $4, status = 'paid' WHERE id = $5",
      [total, referrerAmount, referrerAmount, platformAmount, existingTx.id]);
  } else {
    const txId = crypto.randomUUID();
    await q("INSERT INTO financial_transactions (id, referral_id, total_amount, partner_commission, doctor_share, platform_fee, status) VALUES ($1, $2, $3, $4, $5, $6, 'paid')",
      [txId, referralId, total, referrerAmount, referrerAmount, platformAmount]);
  }
}

export { PLATFORM_FEE_PERCENT, DEFAULT_REFERRER_BONUS };
