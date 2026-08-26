// ============================================================
// FALCON AI OS — Kiosk API klienti
//
// Qurilma tokeni localStorage'da saqlanadi (`falcon_kiosk_token`).
// Har so'rovga `X-Kiosk-Token` sarlavhasi qo'shiladi.
// Token yo'q yoki yaroqsiz bo'lsa — sozlash ekraniga qaytariladi.
// ============================================================

const TOKEN_KEY = "falcon_kiosk_token";
const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function getKioskToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setKioskToken(token: string): void {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearKioskToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export class KioskAuthError extends Error {
  constructor(message = "Qurilma tokeni yaroqsiz") {
    super(message);
    this.name = "KioskAuthError";
  }
}

/** Server qaytargan xatolik + kodi (masalan SLOT_TAKEN) */
export class KioskApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "KioskApiError";
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getKioskToken();
  if (!token) throw new KioskAuthError("Qurilma sozlanmagan");

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Kiosk-Token": token,
      ...(init?.headers || {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    clearKioskToken();
    throw new KioskAuthError();
  }

  const data = await res.json().catch(() => ({ success: false, error: "Javob o'qib bo'lmadi" }));
  if (!res.ok || data.success === false) {
    throw new KioskApiError(data.error || `Xatolik (${res.status})`, data.code);
  }
  return data as T;
}

export const kioskApi = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  /** Binary javob (masalan, navbat ovozli chaqiruvi WAV'i). Xato bo'lsa null. */
  getAudio: async (path: string): Promise<Blob | null> => {
    const token = getKioskToken();
    if (!token) throw new KioskAuthError("Qurilma sozlanmagan");
    const res = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: { "X-Kiosk-Token": token },
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.startsWith("audio/")) return null;
    return res.blob();
  },
};

// ── Javob tiplari ────────────────────────────────────────────

export interface KioskConfig {
  success: true;
  clinic: {
    name: string;
    logo_url: string | null;
    /** Kassa to'lovi uchun QR rasm (clinic_settings.payment_qr_url) */
    payment_qr_url: string | null;
    address: string | null;
    phone: string | null;
  };
  device: { name: string; kind: "entry" | "queue_tv" | "result" };
}

export interface LookupFound {
  success: true;
  session_id: string;
  found: true;
  masked_name: string;
  mrn_tail: string | null;
  confirm_token: string;
  patient_ref: string;
}
export interface LookupNotFound {
  success: true;
  session_id: string;
  found: false;
}
export type LookupResult = LookupFound | LookupNotFound;

export interface ConfirmResult {
  success: true;
  patient: { id: string; full_name: string; medical_record_number: string | null };
}

export interface KioskDoctor {
  id: string;
  name: string;
  today_booked: number;
}
export interface KioskDepartment {
  name: string;
  doctors: KioskDoctor[];
}
export interface DepartmentsResult {
  success: true;
  departments: KioskDepartment[];
}

export interface KioskService {
  id: string;
  name: string;
  category: string | null;
  specialty: string | null;
  price: number;
  duration_min: number | null;
}
export interface ServicesResult {
  success: true;
  services: KioskService[];
}

export interface KioskSlot {
  time: string;
  iso: string;
}
export interface SlotsResult {
  success: true;
  date: string;
  slots: KioskSlot[];
}

export type KioskPayMethod = "cash" | "qr";

/** Bitta tashrif — bir shifokor, bir xizmat, bir vaqt */
export interface BookedVisit {
  access_code: string;
  amount: number;
  doctor_name: string;
  service_name: string;
  scheduled_at: string;
}

export interface BookResult {
  success: true;
  /** Bir tashrifda yaratilgan barcha bronlarni bog'lovchi id */
  booking_group_id: string;
  /** Birinchi tashrif kodi (moslik uchun) */
  access_code: string;
  /** Barcha tashriflar summasi */
  amount: number;
  doctor_name: string;
  service_name: string;
  scheduled_at: string;
  visits: BookedVisit[];
  payment_method: KioskPayMethod;
  /** QR to'lov tanlanganda — to'lov havolasining QR rasmi (data URL) */
  payment_qr: string | null;
  payment_url: string | null;
  message: string;
}

export interface QueueItem {
  code: string;
  display_name: string;
  time: string;
  doctor: string | null;
  department: string | null;
  /** scheduled | confirmed | in_progress */
  status: string;
  paid: boolean;
  /** Bron qilmagan, registraturada navbatga qo'yilgan bemor */
  walk_in?: boolean;
  /** Taxminiy kutish (daqiqa) — faqat jismonan kelganlar (check-in qilganlar) uchun */
  wait_minutes: number;
}
export interface QueueResult {
  success: true;
  queue: QueueItem[];
}

/** "Men keldim" — check-in natijasi */
export interface CheckinResult {
  success: true;
  already: boolean;
  queue_position: number | null;
  appointment: { patient_name: string; doctor_name: string; scheduled_at: string };
  message: string;
}

/** Statsionar bo'limi va undagi bo'sh joy soni */
export interface KioskWard {
  id: string;
  name: string;
  department: string | null;
  total: number;
  free: number;
}

export interface AdmissionRequestResult {
  success: true;
  /** true bo'lsa — so'rov allaqachon yuborilgan edi */
  already: boolean;
  message: string;
}

// ── Formatlash yordamchilari ─────────────────────────────────

export function fmtSum(n: number): string {
  // Reception (`fmtSum` in reception/page.tsx) va TMA (`sumFmt` in tma.html)
  // narxi yo'q/noto'g'ri bo'lsa 0 ga tushiradi — shu yerda YO'Q edi, shuning
  // uchun `price` undefined bo'lganda "NaN so'm" chiqib, narx "ko'rinmayapti"
  // deb tuyulardi. Uchala kanal bir xil ishlashi kerak (yagona manba talabi).
  return new Intl.NumberFormat("uz-UZ").format(Math.round(Number(n) || 0)) + " so'm";
}

/** 9 raqamli lokal telefonni ko'rinishga keltirish: "901234567" -> "90 123 45 67" */
export function fmtLocalPhone(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(0, 9);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return parts.join(" ");
}

export function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

// Sana nomlarini o'zimiz yozamiz: uz-UZ lokali brauzerlarda "M08 9" kabi
// ISO-ga o'xshash chiqadi (oy nomi o'rniga raqam) — bemor uchun o'qib
// bo'lmaydi.
const MONTHS_UZ = [
  "yanvar", "fevral", "mart", "aprel", "may", "iyun",
  "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr",
];
const WEEKDAYS_UZ = [
  "yakshanba", "dushanba", "seshanba", "chorshanba",
  "payshanba", "juma", "shanba",
];

/** "10 avgust" */
export function fmtDate(d: Date): string {
  return `${d.getDate()} ${MONTHS_UZ[d.getMonth()]}`;
}

/** "10 avgust 2026, dushanba" */
export function fmtDateFull(d: Date): string {
  return `${fmtDate(d)} ${d.getFullYear()}, ${WEEKDAYS_UZ[d.getDay()]}`;
}

/** "10 avgust, 14:20" */
export function fmtDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${fmtDate(d)}, ${d.toLocaleTimeString("uz-UZ", { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    return iso;
  }
}
