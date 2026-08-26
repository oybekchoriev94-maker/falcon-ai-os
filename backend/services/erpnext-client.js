// ============================================================
// Falcon AI OS — ERPNext klienti (roadmap PR #11)
//
// Ombor, dorixona va xarid ma'lumotlari ERPNext'ga push qilinadi:
//   inventory_items        -> Item
//   inventory_transactions -> Stock Entry
//
// ERPNext Frappe framework'da qurilgan — REST standarti frappe-client
// bilan bir xil (/api/resource/:DocType, token auth), lekin BU alohida
// server bo'lgani uchun o'z env o'zgaruvchilari va o'z fetch'i bor.
//
// Falsafa bir xil: ERPNEXT_URL bo'sh = O'CHIQ, tarmoq xatosi = null,
// sof konstruktorlar DB'siz test qilinadi.
// ============================================================

const ERPNEXT_URL = (process.env.ERPNEXT_URL || '').replace(/\/+$/, '');
const ERPNEXT_API_KEY = process.env.ERPNEXT_API_KEY || '';
const ERPNEXT_API_SECRET = process.env.ERPNEXT_API_SECRET || '';

export function isErpnextEnabled() {
  return !!ERPNEXT_URL;
}

// ─── Sof konstruktorlar ────────────────────────────────────────
/** Falcon o'lchov birligidan ERPNext UOM (eng keng tarqalganlari) */
const UOM_MAP = {
  dona: 'Unit',
  donа: 'Unit',
  quti: 'Box',
  litr: 'Litre',
  l: 'Litre',
  kg: 'Kg',
  gr: 'Gram',
  gramm: 'Gram',
  ampula: 'Unit',
  flakon: 'Unit',
  blister: 'Unit',
  upakovka: 'Pack',
};

/** @returns {string} ERPNext UOM; noma'lum birlik 'Unit' bo'ladi */
export function toErpnextUom(unit) {
  const key = String(unit || '').trim().toLowerCase();
  return UOM_MAP[key] || 'Unit';
}

/**
 * Falcon ombor elementini ERPNext Item hujjatiga aylantiradi (SOF).
 * item_code = SKU — tabiiy kalit, o'zgarmaydi.
 * @param {Object} item inventory_items satri
 * @returns {Object} ERPNext Item payload
 */
export function toErpnextItem(item) {
  const doc = {
    item_code: String(item.sku || '').trim(),
    item_name: String(item.name || '').trim(),
    stock_uom: toErpnextUom(item.unit),
    is_stock_item: 1,
  };
  if (item.category) doc.item_group = String(item.category);
  if (item.cost_price != null && Number(item.cost_price) >= 0) {
    doc.valuation_rate = Number(item.cost_price);
  }
  return doc;
}

/** Falcon tranzaksiya tipidan ERPNext Stock Entry maqsadi */
const STOCK_ENTRY_PURPOSE = {
  IN: 'Material Receipt',
  VOICE_RECEIPT: 'Material Receipt',
  CONSUMPTION: 'Material Issue',
  ADJUST: null, // miqdor ishorasiga qarab route'da aniqlanadi
};

/**
 * Falcon ombor tranzaksiyasini ERPNext Stock Entry'ga aylantiradi (SOF).
 * @param {Object} opts { tx (inventory_transactions satri), itemCode
 *   (ERPNext Item name), warehouse, company, postingDate? }
 * @returns {Object|null} payload; itemCode yo'q bo'lsa null
 */
export function toErpnextStockEntry({ tx, itemCode, warehouse, company, postingDate }) {
  if (!tx || !itemCode || !warehouse) return null;
  const qty = Number(tx.quantity);
  if (!Number.isFinite(qty) || qty === 0) return null;

  let purpose = STOCK_ENTRY_PURPOSE[tx.type];
  if (tx.type === 'ADJUST') purpose = qty >= 0 ? 'Material Receipt' : 'Material Issue';
  if (!purpose) return null;

  const line = { item_code: itemCode, qty: Math.abs(qty) };
  if (purpose === 'Material Receipt') line.t_warehouse = warehouse;
  else line.s_warehouse = warehouse;

  return {
    stock_entry_type: purpose,
    ...(company ? { company } : {}),
    ...(postingDate ? { posting_date: postingDate } : {}),
    ...(tx.reason ? { remarks: String(tx.reason).slice(0, 240) } : {}),
    items: [line],
  };
}

// ─── Tarmoq funksiyalari (gate + null-fallback) ────────────────
async function erpnextFetch(path, options = {}) {
  if (!isErpnextEnabled()) return null;
  try {
    const res = await fetch(`${ERPNEXT_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `token ${ERPNEXT_API_KEY}:${ERPNEXT_API_SECRET}`,
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[ERPNEXT] ${options.method || 'GET'} ${path}: HTTP ${res.status}`);
      return null;
    }
    return res.json();
  } catch (e) {
    console.warn('[ERPNEXT] Ulanish xatosi:', e.message);
    return null;
  }
}

/** @returns {Promise<string|null>} doc name yoki null */
export async function createErpnextDoc(doctype, doc) {
  const data = await erpnextFetch(`/api/resource/${encodeURIComponent(doctype)}`, {
    method: 'POST',
    body: JSON.stringify(doc),
  });
  return data?.data?.name || null;
}

/** @returns {Promise<string|null>} doc name yoki null */
export async function updateErpnextDoc(doctype, name, doc) {
  const data = await erpnextFetch(
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    { method: 'PUT', body: JSON.stringify(doc) }
  );
  return data?.data?.name || null;
}

/** @returns {Promise<Object|null>} birinchi mos hujjat yoki null */
export async function findErpnextDoc(doctype, filters) {
  const qs = new URLSearchParams({ filters: JSON.stringify(filters), limit_page_length: '1' });
  const data = await erpnextFetch(`/api/resource/${encodeURIComponent(doctype)}?${qs}`);
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows[0] || null;
}
