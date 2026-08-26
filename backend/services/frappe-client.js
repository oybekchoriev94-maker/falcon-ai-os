// ============================================================
// Falcon AI OS — Frappe HRMS klienti (roadmap PR #9)
//
// Xodim smenasi va davomat Frappe HRMS'ga push qilinadi:
//   staff_members  -> Employee
//   kunlik davomat -> Attendance (Present/Absent + remarks)
//
// Medplum/STT/TTS bilan bir xil falsafa:
//   - FRAPPE_URL bo'sh bo'lsa integratsiya O'CHIQ — endpoint
//     aniq FRAPPE_DISABLED kodini qaytaradi, qolgan ishlaydi
//   - Tarmoq xatosida null — Falcon o'z ishini davom ettiradi
//   - Sof konstruktorlar DB'siz unit-test qilinadi
//
// Autentifikatsiya: Frappe token auth —
//   Authorization: token <api_key>:<api_secret>
// Resource API: /api/resource/:DocType (POST = create,
//   PUT /:name = update, GET ?filters = qidiruv).
// ============================================================

const FRAPPE_URL = (process.env.FRAPPE_URL || '').replace(/\/+$/, '');
const FRAPPE_API_KEY = process.env.FRAPPE_API_KEY || '';
const FRAPPE_API_SECRET = process.env.FRAPPE_API_SECRET || '';

export function isFrappeEnabled() {
  return !!FRAPPE_URL;
}

// ─── Sof konstruktorlar ────────────────────────────────────────
/**
 * Falcon xodimini Frappe Employee hujjatiga aylantiradi (SOF).
 * @param {Object} s staff_members satri: { full_name, position, phone, role }
 * @returns {Object} Frappe Employee payload
 */
export function toFrappeEmployee(s) {
  const doc = {
    employee_name: String(s.full_name || '').trim(),
    status: 'Active',
  };
  if (s.position) doc.designation = String(s.position);
  if (s.phone) doc.cell_number = String(s.phone);
  // Frappe'da company MAJBURIY maydon — sozlamadan olinadi,
  // konstruktor uni bilmaydi (route qo'shadi)
  return doc;
}

/** Falcon davomat statusidan Frappe Attendance statusi */
const ATTENDANCE_STATUS = {
  present: 'Present',
  late: 'Present',         // kechikish = keldi, remarks bilan belgilanadi
  early_leave: 'Present',  // erta ketish = keldi, remarks bilan
  absent: 'Absent',
};

/**
 * Kunlik davomat natijasini Frappe Attendance hujjatiga aylantiradi (SOF).
 * Roadmap qoidasi: kamera/kechikish = DALIL — remarks'da ko'rinadi,
 * lekin status faqat "keldi/kelmadi" deb qo'yiladi (jazo emas).
 * @param {Object} opts { employeeName (Frappe doc name), date 'YYYY-MM-DD',
 *   status, lateMinutes?, earlyLeaveMinutes? }
 * @returns {Object|null} Frappe Attendance payload; status noma'lum bo'lsa null
 */
export function toFrappeAttendance({ employeeName, date, status, lateMinutes, earlyLeaveMinutes }) {
  const mapped = ATTENDANCE_STATUS[status];
  if (!mapped || !employeeName || !date) return null;
  const remarks = [];
  if (status === 'late' && lateMinutes != null) remarks.push(`Kechikish: ${lateMinutes} daqiqa`);
  if (status === 'early_leave' && earlyLeaveMinutes != null) {
    remarks.push(`Erta ketish: ${earlyLeaveMinutes} daqiqa`);
  }
  return {
    employee: employeeName,
    attendance_date: date,
    status: mapped,
    ...(remarks.length ? { remarks: remarks.join('; ') } : {}),
  };
}

// ─── Tarmoq funksiyalari (gate + null-fallback) ────────────────
async function frappeFetch(path, options = {}) {
  if (!isFrappeEnabled()) return null;
  try {
    const res = await fetch(`${FRAPPE_URL}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `token ${FRAPPE_API_KEY}:${FRAPPE_API_SECRET}`,
        ...(options.headers || {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.warn(`[FRAPPE] ${options.method || 'GET'} ${path}: HTTP ${res.status}`);
      return null;
    }
    return res.json();
  } catch (e) {
    console.warn('[FRAPPE] Ulanish xatosi:', e.message);
    return null;
  }
}

/**
 * Frappe hujjatini yaratadi.
 * @returns {Promise<string|null>} doc name yoki null
 */
export async function createFrappeDoc(doctype, doc) {
  const data = await frappeFetch(`/api/resource/${encodeURIComponent(doctype)}`, {
    method: 'POST',
    body: JSON.stringify(doc),
  });
  return data?.data?.name || null;
}

/**
 * Frappe hujjatini yangilaydi (name bo'yicha).
 * @returns {Promise<string|null>} doc name yoki null
 */
export async function updateFrappeDoc(doctype, name, doc) {
  const data = await frappeFetch(
    `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
    { method: 'PUT', body: JSON.stringify(doc) }
  );
  return data?.data?.name || null;
}

/**
 * Filtr bo'yicha birinchi mos hujjatni topadi (idempotent sync uchun).
 * @param {Array<[string,string,string]>} filters masalan [['employee','=',name]]
 * @returns {Promise<Object|null>} hujjat (name field bilan) yoki null
 */
export async function findFrappeDoc(doctype, filters) {
  const qs = new URLSearchParams({ filters: JSON.stringify(filters), limit_page_length: '1' });
  const data = await frappeFetch(`/api/resource/${encodeURIComponent(doctype)}?${qs}`);
  const rows = Array.isArray(data?.data) ? data.data : [];
  return rows[0] || null;
}
