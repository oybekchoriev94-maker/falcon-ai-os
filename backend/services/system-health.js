// ============================================================
// FALCON AI OS — Tizim salomatligi agregatori (PR #15)
//
// Sof funksiyalar: backup statusini talqin qilish va komponent
// tekshiruvlaridan umumiy xulosa chiqarish. Endpoint
// (/api/health/deep) va watchdog shu mantiqni ishlatadi.
// ============================================================

// Backup qancha vaqt eskirmagan bo'lsa "sog'lom" hisoblanadi.
// Kunlik backup rejasi uchun 26 soat zaxira bilan.
export const BACKUP_MAX_AGE_HOURS = 26;

/**
 * last-backup.json mazmunini xavfsiz talqin qiladi.
 * @param {string|null|undefined} jsonText
 * @returns {object|null} — yaroqsiz bo'lsa null
 */
export function parseBackupStatus(jsonText) {
  if (typeof jsonText !== 'string' || !jsonText.trim()) return null;
  try {
    const obj = JSON.parse(jsonText);
    if (!obj || typeof obj !== 'object') return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * Backup holatini baholaydi.
 * @param {object|null} status — parseBackupStatus natijasi
 * @param {number} maxAgeHours
 * @param {Date} [now]
 * @returns {{state:'ok'|'stale'|'failed'|'missing', ageHours:number|null,
 *            file?:string, timestamp?:string}}
 */
export function backupHealth(status, maxAgeHours = BACKUP_MAX_AGE_HOURS, now = new Date()) {
  if (!status) return { state: 'missing', ageHours: null };
  if (status.ok === false) {
    return { state: 'failed', ageHours: null, error: status.error || null };
  }
  const ts = new Date(status.timestamp);
  if (Number.isNaN(ts.getTime())) return { state: 'missing', ageHours: null };

  const ageHours = (now.getTime() - ts.getTime()) / 3_600_000;
  const rounded = Math.round(ageHours * 10) / 10;
  if (ageHours > maxAgeHours) {
    return { state: 'stale', ageHours: rounded, file: status.file || null, timestamp: status.timestamp };
  }
  return { state: 'ok', ageHours: rounded, file: status.file || null, timestamp: status.timestamp };
}

/**
 * Komponent tekshiruvlaridan umumiy xulosa.
 *
 * Har komponent: { name, ok, critical?, detail? }
 *  - critical (DB kabi) yiqilsa -> holat 'down'
 *  - qolganlar (STT/OCR/TTS) yiqilsa -> 'degraded' (asosiy oqim ishlaydi)
 *
 * @param {Array<{name:string, ok:boolean, critical?:boolean, detail?:string}>} checks
 * @returns {{overall:'ok'|'degraded'|'down', problems:string[]}}
 */
export function aggregateHealth(checks = []) {
  const problems = [];
  let down = false;
  let degraded = false;

  for (const c of checks) {
    if (!c || c.ok) continue;
    problems.push(c.name);
    if (c.critical) down = true;
    else degraded = true;
  }

  const overall = down ? 'down' : degraded ? 'degraded' : 'ok';
  return { overall, problems };
}
