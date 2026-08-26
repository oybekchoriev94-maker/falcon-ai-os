/**
 * Yashash joyi ma'lumotnomasi.
 *
 * Tumanlar — rasmiy ma'muriy bo'linish. Mahallalar ATAYLAB yozilmagan:
 * Surxondaryoda 1500 dan ortiq mahalla bor va ishonchli to'liq ro'yxat
 * tizimda yo'q — taxminiy nomlar bemor kartasiga tushishi mumkin emas.
 * Mahalla erkin kiritiladi, takliflar klinikaning o'z yozuvlaridan yig'iladi
 * (GET /api/booking/mahallas).
 */

export const DEFAULT_REGION = "Surxondaryo";

export const SURXONDARYO_DISTRICTS = [
  "Termiz shahri",
  "Angor tumani",
  "Bandixon tumani",
  "Boysun tumani",
  "Denov tumani",
  "Jarqo'rg'on tumani",
  "Muzrabot tumani",
  "Oltinsoy tumani",
  "Qiziriq tumani",
  "Qumqo'rg'on tumani",
  "Sariosiyo tumani",
  "Sherobod tumani",
  "Sho'rchi tumani",
  "Termiz tumani",
  "Uzun tumani",
] as const;

/** Telefonni saqlash ko'rinishiga keltiradi: 901234567 -> +998901234567 */
export function toStoredPhone(local: string): string | null {
  const digits = (local || "").replace(/\D/g, "").slice(-9);
  return digits.length === 9 ? `+998${digits}` : null;
}

/** Saqlangan telefondan mahalliy qismni ajratadi: +998901234567 -> 901234567 */
export function toLocalPhone(stored?: string | null): string {
  return (stored || "").replace(/\D/g, "").slice(-9);
}

/** Ko'rsatish uchun: 901234567 -> 90 123 45 67 */
export function formatLocalPhone(local: string): string {
  const d = (local || "").replace(/\D/g, "").slice(0, 9);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return parts.join(" ");
}
