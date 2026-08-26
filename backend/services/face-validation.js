// ============================================================
// FALCON AI OS — Face ID v2 server tekshiruvi (PR #10)
//
// Tanish klinika kompyuterida qilinadi; serverga faqat hodisa
// keladi. Shunga qaramay server OXIRGI TO'SIQ bo'lib qoladi:
// agent xato yuborsa yoki soxtalansa (masalan liveness'siz eski
// agent ko'p kadrni 1 deb yozsa), bu yerda flag qo'yiladi.
//
// QOIDA: shubhali hodisa O'CHIRILMAYDI — dalil saqlanadi, flag
// bilan ko'rinadi. Kamera = dalil, jazo emas.
// ============================================================

// Papka nomi prefiksi orqali subyekt turini aniqlash.
// Agentda faces/ papka tuzilishi:
//   faces/Aliyev Vali/...        -> xodim
//   faces/bemor_Alisher Karim/...-> bemor
export const PATIENT_PREFIXES = ['bemor_', 'bemor:'];

/**
 * Yuz tanish hodisasining kimligini tahlil qiladi.
 * Eski agentlar prefikssiz yuboradi — ular xodim deb qabul qilinadi.
 *
 * @param {string} rawName
 * @returns {{subjectType: 'staff'|'patient', personName: string}}
 */
export function parseFaceSubject(rawName) {
  const name = String(rawName ?? '').trim();
  for (const pref of PATIENT_PREFIXES) {
    if (name.toLowerCase().startsWith(pref)) {
      const rest = name.slice(pref.length).trim();
      return { subjectType: 'patient', personName: rest || name };
    }
  }
  return { subjectType: 'staff', personName: name };
}

// Server minimal talablari. Agentdagi confirm_frames (standart 3)
// bilan mos — agent kamroq yuborsa shubhali hisoblanadi.
export const MIN_CONFIRM_FRAMES = 3;
// Yuz kadr ichida shunchalik siljigan bo'lishi kerak (o'rtacha
// kenglikka nisbatan). Foto/qog'ozda bu deyarli 0 bo'ladi.
export const MIN_LIVENESS_SCORE = 0.02;

/**
 * Agentdan kelgan hodisa metadata'sini qayta tekshiradi.
 *
 * @param {{frame_count?: number|null, liveness_score?: number|null,
 *          liveness_ok?: boolean|null}} ev
 * @returns {{ok: boolean, flag: string|null, legacy: boolean}}
 *   ok      — server talabidan o'tdi (yoki eski agent, hech narsa yubormagan)
 *   flag    — 'photo_suspect' | 'low_frames' | null
 *   legacy  — agent v2 maydonlarini umuman yubormagan
 */
export function validateFaceEvent(ev = {}) {
  const frames = Number.isFinite(ev.frame_count) ? ev.frame_count : null;
  const live = Number.isFinite(ev.liveness_score) ? ev.liveness_score : null;

  // Eski agent — metadata yo'q. Ishonchsiz, lekin to'smaymiz:
  // davomat buzilmasin, faqat legacy deb belgilanadi.
  if (frames === null && live === null) {
    return { ok: true, flag: null, legacy: true };
  }

  if (live !== null && live < MIN_LIVENESS_SCORE) {
    return { ok: false, flag: 'photo_suspect', legacy: false };
  }
  if (frames !== null && frames < MIN_CONFIRM_FRAMES) {
    return { ok: false, flag: 'low_frames', legacy: false };
  }
  return { ok: true, flag: null, legacy: false };
}
