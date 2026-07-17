// ============================================================
// FALCON AI OS — Payment Gateway
// Payme / Click / Uzum / OpenCard API integratsiyasi
// Klinika kartasiga to'g'ridan-to'g'ri to'lov (karta raqamiga)
// ============================================================

const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Payme Merchant API ─────────────────────────────────
// Hujjat: https://developer.payme.uz/documentation/merchant-api
const PAYME_BASE = 'https://api.payme.uz/merchant';
const PAYME_KEY = process.env.PAYME_MERCHANT_KEY || ''; // Payme merchant kaliti

// ─── Click Merchant API ─────────────────────────────────
// Hujjat: https://docs.click.uz/merchant/
const CLICK_BASE = 'https://api.click.uz/merchant';
const CLICK_SERVICE_ID = process.env.CLICK_SERVICE_ID || '';
const CLICK_MERCHANT_ID = process.env.CLICK_MERCHANT_ID || '';
const CLICK_SECRET_KEY = process.env.CLICK_SECRET_KEY || '';

// ─── Uzum Bank API ──────────────────────────────────────
const UZUM_BASE = 'https://api.uzumbank.uz/merchant';
const UZUM_TERMINAL_ID = process.env.UZUM_TERMINAL_ID || '';
const UZUM_SECRET = process.env.UZUM_SECRET || '';

// ─── Klinika to'lov sozlamalari ─────────────────────────
// DB dan o'qiladi, lekin default'da env dan
const DEFAULT_CLINIC_CARD = process.env.CLINIC_CARD_NUMBER || '8600XXXXXXXXXX';
const DEFAULT_CLINIC_CARD_HOLDER = process.env.CLINIC_CARD_HOLDER || 'Klinika Egasi';

/**
 * To'lov platformasi komissiyalari (%)
 * Real ma'lumotlar — O'zbekiston bozoridagi haqiqiy stavkalar
 */
const COMMISSIONS = {
  payme: 1.5,
  click: 1.8,
  uzum: 1.2,
  opencard: 1.0,
  naqt: 0
};

/**
 * Eng arzon platformani topish
 */
function getCheapestPlatform() {
  return Object.entries(COMMISSIONS)
    .sort((a, b) => a[1] - b[1])[0][0];
}

/**
 * Payme orqali to'lov yaratish (karta raqamiga)
 * Payme: receipts.create → pul merchant account ga tushadi
 * Keyin merchant o'z kartasiga chiqarib oladi yoki Auto-withdraw yoqilgan
 *
 * @param {Object} params
 * @param {number} params.amount - so'mda (tiyinga aylantiriladi)
 * @param {string} params.description - to'lov tavsifi
 * @param {string} params.orderId - Falcon OS dagi buyurtma ID
 * @param {string} params.clinicCard - klinika kartasi (agar bo'lmasa env dan)
 * @param {string} params.returnUrl - to'lovdan keyin qaytish URL
 * @returns {Object} { success, paymentUrl, transactionId }
 */
async function createPaymePayment(params) {
  const { amount, description, orderId, clinicCard, returnUrl } = params;

  if (!PAYME_KEY) {
    // Agar Payme sozlanmagan bo'lsa — fallback rejim
    return createOfflinePayment(params);
  }

  try {
    // Payme receipts.create — bu orqali to'lov yaratiladi
    const body = JSON.stringify({
      method: 'receipts.create',
      params: {
        amount: Math.round(amount * 100), // so'm → tiyn
        description: description || `Falcon OS to'lov #${orderId}`,
        account: {
          // Klinika kartasi — Payme buni merchant account ga bog'laydi
          order_id: orderId,
          clinic_card: clinicCard || DEFAULT_CLINIC_CARD
        }
      }
    });

    const response = await fetch(`${PAYME_BASE}/receipts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth': PAYME_KEY
      },
      body
    });

    const data = await response.json();

    if (data.error) {
      console.error('[PAYME] Xatolik:', data.error);
      return { success: false, error: data.error.message || 'Payme xatoligi', raw: data };
    }

    // Payme receipt yaratildi — to'lov linki
    const receiptId = data.result?.receipt?._id || data.result?._id;
    const paymentUrl = `https://payme.uz/${receiptId}`;

    return {
      success: true,
      provider: 'payme',
      paymentUrl,
      transactionId: receiptId,
      amount,
      commission: COMMISSIONS.payme,
      commissionAmount: Math.round(amount * COMMISSIONS.payme / 100)
    };
  } catch (e) {
    console.error('[PAYME] So\'rov xatoligi:', e.message);
    return createOfflinePayment(params);
  }
}

/**
 * Click orqali to'lov yaratish
 * Click: merchant/pay → pul Click hisobiga → keyin kartaga
 *
 * @param {Object} params
 * @returns {Object} { success, paymentUrl, transactionId }
 */
async function createClickPayment(params) {
  const { amount, description, orderId, clinicCard, returnUrl } = params;

  if (!CLICK_SERVICE_ID || !CLICK_MERCHANT_ID) {
    return createOfflinePayment(params);
  }

  try {
    // Click to'lov URL
    const paymentUrl = `https://my.click.uz/services/pay?`
      + `service_id=${CLICK_SERVICE_ID}`
      + `&merchant_id=${CLICK_MERCHANT_ID}`
      + `&amount=${Math.round(amount)}`
      + `&transaction_parameter=${orderId}`
      + `&return_url=${encodeURIComponent(returnUrl || '')}`
      + `&card_number=${clinicCard || DEFAULT_CLINIC_CARD}`;

    return {
      success: true,
      provider: 'click',
      paymentUrl,
      transactionId: `click-${orderId}`,
      amount,
      commission: COMMISSIONS.click,
      commissionAmount: Math.round(amount * COMMISSIONS.click / 100)
    };
  } catch (e) {
    console.error('[CLICK] Xatolik:', e.message);
    return createOfflinePayment(params);
  }
}

/**
 * Uzum Bank orqali to'lov
 */
async function createUzumPayment(params) {
  const { amount, description, orderId } = params;

  if (!UZUM_TERMINAL_ID || !UZUM_SECRET) {
    return createOfflinePayment(params);
  }

  try {
    const body = JSON.stringify({
      terminalId: UZUM_TERMINAL_ID,
      amount: Math.round(amount),
      orderId,
      description: description || `Falcon OS #${orderId}`,
      callbackUrl: `${process.env.TUNNEL_URL || process.env.PUBLIC_URL || ''}/api/payments/webhook/uzum`
    });

    const response = await fetch(`${UZUM_BASE}/create-invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${UZUM_SECRET}`
      },
      body
    });

    const data = await response.json();

    if (!data.success) {
      return createOfflinePayment(params);
    }

    return {
      success: true,
      provider: 'uzum',
      paymentUrl: data.paymentUrl || data.link,
      transactionId: data.transactionId || data.invoiceId,
      amount,
      commission: COMMISSIONS.uzum,
      commissionAmount: Math.round(amount * COMMISSIONS.uzum / 100)
    };
  } catch (e) {
    console.error('[UZUM] Xatolik:', e.message);
    return createOfflinePayment(params);
  }
}

/**
 * Offline to'lov (Payme/Click sozlanmagan bo'lsa)
 * Bemor kassada naqt yoki terminal orqali to'laydi
 */
function createOfflinePayment(params) {
  const { amount, description, orderId } = params;

  return {
    success: true,
    provider: 'offline',
    paymentUrl: null,
    transactionId: `offline-${orderId}`,
    amount,
    commission: 0,
    commissionAmount: 0,
    message: '💳 Online to\'lov sozlanmagan. Iltimos, kassada naqt yoki karta orqali to\'lang.',
    offline: true
  };
}

/**
 * Avtomatik eng yaxshi platformani tanlab to'lov yaratish
 */
async function createPayment(params) {
  const preferred = params.provider || getCheapestPlatform();
  const startTime = Date.now();

  let result;

  switch (preferred) {
    case 'payme':
      result = await createPaymePayment(params);
      break;
    case 'click':
      result = await createClickPayment(params);
      break;
    case 'uzum':
      result = await createUzumPayment(params);
      break;
    default:
      // Client tanlagan platforma agar fail bo'lsa — eng arzoniga o'tadi
      result = await createPaymePayment(params);
      if (!result.success) result = await createClickPayment(params);
      if (!result.success) result = createOfflinePayment(params);
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

/**
 * Payme webhook ni qayta ishlash
 * Payme to'lov tugaganidan keyin bizga POST yuboradi
 */
function handlePaymeWebhook(reqBody) {
  const { result } = reqBody;

  // Payme webhook formati:
  // { method: "receipts.pay", params: { id: "...", amount: 120000, ... } }
  if (!result) return null;

  return {
    provider: 'payme',
    transactionId: result.id || result.receipt?._id,
    amount: result.amount ? result.amount / 100 : null, // tiyn → so'm
    orderId: result.account?.order_id,
    clinicCard: result.account?.clinic_card,
    status: result.status === 'paid' ? 'paid' : 'pending',
    raw: result
  };
}

/**
 * Click webhook ni qayta ishlash
 */
function handleClickWebhook(reqBody) {
  // Click webhook: { click_trans_id, merchant_trans_id, amount, status, ... }
  const { click_trans_id, merchant_trans_id, amount, status, error } = reqBody;

  if (!merchant_trans_id) return null;

  return {
    provider: 'click',
    transactionId: click_trans_id,
    amount: amount ? parseFloat(amount) : null,
    orderId: merchant_trans_id,
    status: status === '0' ? 'paid' : error === '0' ? 'paid' : 'failed',
    raw: reqBody
  };
}

/**
 * Uzum webhook ni qayta ishlash
 */
function handleUzumWebhook(reqBody) {
  const { transactionId, orderId, amount, status } = reqBody;
  if (!orderId) return null;

  return {
    provider: 'uzum',
    transactionId,
    amount: amount ? parseFloat(amount) : null,
    orderId,
    status: status === 'success' || status === 'paid' ? 'paid' : 'failed',
    raw: reqBody
  };
}

export {
  createPayment,
  createPaymePayment,
  createClickPayment,
  createUzumPayment,
  createOfflinePayment,
  handlePaymeWebhook,
  handleClickWebhook,
  handleUzumWebhook,
  getCheapestPlatform,
  COMMISSIONS,
  DEFAULT_CLINIC_CARD
};
