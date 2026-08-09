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
    throw new Error(data.error || `Xatolik (${res.status})`);
  }
  return data as T;
}

export const kioskApi = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
};

// ── Javob tiplari ────────────────────────────────────────────

export interface KioskConfig {
  success: true;
  clinic: { name: string; logo_url: string | null; address: string | null; phone: string | null };
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

export interface BookResult {
  success: true;
  access_code: string;
  amount: number;
  doctor_name: string;
  service_name: string;
  scheduled_at: string;
  message: string;
}

export interface QueueItem {
  code: string;
  display_name: string;
  time: string;
  doctor: string | null;
  department: string | null;
  status: string;
}
export interface QueueResult {
  success: true;
  queue: QueueItem[];
}

// ── Formatlash yordamchilari ─────────────────────────────────

export function fmtSum(n: number): string {
  return new Intl.NumberFormat("uz-UZ").format(Math.round(n)) + " so'm";
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
