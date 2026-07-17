export const name = 'referral-agent';
export const description = 'QR referral agenti — hamkorlar uchun QR kod yaratadi, referral tranzaksiyalarini boshqaradi va split-kassa balansini yangilaydi';
export const version = '1.0.0';

export const inputSchema = {
  action: { type: 'string', required: true, description: 'Amal turi: generate_qr, convert, adjust_balance, get_stats, get_partner' },
  partner_name: { type: 'string', required: false, description: 'Hamkor ismi' },
  partner_phone: { type: 'string', required: false, description: 'Hamkor telefoni' },
  partner_id: { type: 'string', required: false, description: 'Hamkor ID si' },
  patient_id: { type: 'string', required: false, description: 'Bemor ID si (convert uchun)' },
  referral_id: { type: 'string', required: false, description: 'Referral ID si' },
  amount: { type: 'number', required: false, description: 'Summa' },
  note: { type: 'string', required: false, description: 'Izoh (adjust_balance uchun majburiy)' }
};

export async function handler(input, context = {}) {
  const db = context.db;
  const { action } = input;

  if (!db?.isReady()) return { error: 'Database mavjud emas' };

  if (action === 'generate_qr') {
    const { partner_name, partner_phone } = input;
    if (!partner_name) return { error: 'partner_name talab qilinadi' };

    const id = require('uuid').v4();
    const referralCode = 'PRT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const qrToken = 'QR-' + require('uuid').v4().replace(/-/g, '').substring(0, 16).toUpperCase();

    db.qExec(
      'INSERT INTO referral_partners (id, name, phone, referral_code, qr_code_base64, balance) VALUES (?, ?, ?, ?, ?, 0)',
      [id, partner_name, partner_phone || '', referralCode, qrToken]
    );

    const qrData = JSON.stringify({ type: 'referral', code: referralCode, token: qrToken, partner: partner_name });

    return {
      success: true, partner: { id, name: partner_name, referral_code: referralCode },
      qr_code_token: qrToken, qr_data: qrData,
      qr_endpoint: `/api/referral/qr/${qrToken}`
    };
  }

  if (action === 'convert') {
    const { referral_code, patient_id, total_amount } = input;
    if (!referral_code && !input.referral_id) return { error: 'referral_code yoki referral_id talab qilinadi' };
    if (!patient_id) return { error: 'patient_id talab qilinadi' };

    const partner = db.qGet('SELECT * FROM referral_partners WHERE referral_code = ? OR id = ?', [referral_code || '', input.referral_id || '']);
    if (!partner) return { error: 'Hamkor topilmadi' };

    const refId = 'REF-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    const qrToken = 'QR-' + require('uuid').v4().replace(/-/g, '').substring(0, 16).toUpperCase();
    const id = require('uuid').v4();
    const total = parseFloat(total_amount) || 0;
    const partnerCommission = Math.round(total * 0.4);
    const doctorShare = Math.round(total * 0.2);
    const platformFee = 2000;

    const patient = db.qGet('SELECT id, first_name, last_name FROM patients WHERE id = ?', [patient_id]);
    const patientName = patient ? `${patient.first_name} ${patient.last_name || ''}` : 'Noma\'lum';

    db.qExec(
      'INSERT INTO referrals (id, referral_id, sender_clinic_id, patient_name, service_required, status, qr_code_token, referring_doctor, notes, partner_id, patient_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, refId, null, patientName, 'Face ID orqali', 'completed', qrToken, partner.name, null, partner.id, patient_id]
    );

    const txId = require('uuid').v4();
    db.qExec(
      'INSERT INTO financial_transactions (id, referral_id, total_amount, partner_commission, doctor_share, platform_fee, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [txId, id, total, partnerCommission, doctorShare, platformFee, 'paid']
    );

    db.qExec('UPDATE referral_partners SET balance = balance + ? WHERE id = ?', [partnerCommission, partner.id]);

    db.qExec(
      'INSERT INTO partner_transactions (partner_id, type, amount, note) VALUES (?, ?, ?, ?)',
      [partner.id, 'referral_commission', partnerCommission, `Referal: ${patientName}`]
    );

    return {
      success: true, referral: { id: refId, patient_name: patientName, total, status: 'completed' },
      commission: { partner_commission: partnerCommission, doctor_share: doctorShare, platform_fee: platformFee },
      partner_balance: partner.balance + partnerCommission
    };
  }

  if (action === 'adjust_balance') {
    const { partner_id, amount, note, type } = input;
    if (!partner_id) return { error: 'partner_id talab qilinadi' };
    if (!note) return { error: 'Izoh (note) majburiy' };
    if (!type || !['topup', 'payout'].includes(type)) return { error: 'type topup yoki payout bo\'lishi kerak' };

    const partner = db.qGet('SELECT * FROM referral_partners WHERE id = ?', [partner_id]);
    if (!partner) return { error: 'Hamkor topilmadi' };

    const adjAmount = Math.abs(parseFloat(amount) || 0);
    if (adjAmount <= 0) return { error: 'amount musbat son bo\'lishi kerak' };

    if (type === 'payout' && partner.balance < adjAmount) {
      return { error: `Balans yetarli emas. Mavjud: ${partner.balance}, so'ralgan: ${adjAmount}` };
    }

    const delta = type === 'topup' ? adjAmount : -adjAmount;
    db.qExec('UPDATE referral_partners SET balance = balance + ? WHERE id = ?', [delta, partner.id]);

    db.qExec(
      'INSERT INTO partner_transactions (partner_id, type, amount, note) VALUES (?, ?, ?, ?)',
      [partner_id, type, adjAmount, note]
    );

    const updated = db.qGet('SELECT * FROM referral_partners WHERE id = ?', [partner_id]);
    return {
      success: true, partner_id, type, amount: adjAmount, note,
      previous_balance: partner.balance, new_balance: updated.balance
    };
  }

  if (action === 'get_partner') {
    const partner = db.qGet(
      'SELECT * FROM referral_partners WHERE id = ? OR referral_code = ?',
      [input.partner_id || '', input.partner_code || '']
    );
    if (!partner) return { error: 'Hamkor topilmadi' };
    const txs = db.q('SELECT * FROM partner_transactions WHERE partner_id = ? ORDER BY created_at DESC LIMIT 20', [partner.id]);
    const refs = db.q(
      "SELECT referral_id, patient_name, status, created_at FROM referrals WHERE partner_id = ? ORDER BY created_at DESC LIMIT 20",
      [partner.id]
    );
    return { partner, transactions: txs, referrals: refs };
  }

  if (action === 'get_stats') {
    const partners = db.q('SELECT COUNT(*) as total, COALESCE(SUM(balance), 0) as total_balance FROM referral_partners');
    const referrals = db.qGet("SELECT COUNT(*) as total FROM referrals WHERE partner_id IS NOT NULL");
    const conversions = db.qGet("SELECT COUNT(*) as total FROM referrals WHERE partner_id IS NOT NULL AND status = 'completed'");
    const pending = db.qGet("SELECT COUNT(*) as total FROM referrals WHERE partner_id IS NOT NULL AND status = 'pending'");
    const allPartners = db.q('SELECT id, name, referral_code, balance FROM referral_partners ORDER BY balance DESC');
    return {
      total_partners: partners[0]?.total || 0,
      total_balance: partners[0]?.total_balance || 0,
      total_referrals: referrals?.total || 0,
      completed_referrals: conversions?.total || 0,
      pending_referrals: pending?.total || 0,
      partners: allPartners
    };
  }

  return { error: `Noma'lum action: ${action}` };
}
