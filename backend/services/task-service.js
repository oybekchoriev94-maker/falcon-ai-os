// ============================================================
// Falcon AI OS — Vazifalar tizimi (sof qoidalar)
//
// Xodimga vazifa belgilash va bajarilish nazorati. Qoida:
// kechikkan vazifa = DALIL (rahbar hisobotida ko'rinadi),
// avtomatik jazo YO'Q.
//
// Bu fayl DB'siz — faqat sof funksiyalar (unit-test qilinadi).
// ============================================================

/** Ruxsat etilgan status o'tishlari (done — yakuniy holat) */
export const TASK_TRANSITIONS = Object.freeze({
  pending: ['in_progress', 'done'],
  in_progress: ['done'],
  done: [],
});

/**
 * Status o'tishi mumkinmi?
 * @param {string} from hozirgi status
 * @param {string} to maqsad status
 */
export function canTransition(from, to) {
  return (TASK_TRANSITIONS[from] || []).includes(to);
}

/**
 * Vazifa kechikkanmi? (muddati o'tgan va hali bajarilmagan)
 * @param {Object} task { status, due_at }
 * @param {Date} now tekshiruv vaqti
 */
export function isOverdue(task, now = new Date()) {
  if (!task || task.status === 'done' || !task.due_at) return false;
  const due = new Date(task.due_at);
  return Number.isFinite(due.getTime()) && due.getTime() < now.getTime();
}

/**
 * Vazifalar ro'yxatini agregatlaydi (direktor dashboard uchun).
 * @param {Array} tasks vazifalar massivi
 * @param {Date} now tekshiruv vaqti
 * @returns {Object} { total, pending, in_progress, done, overdue, by_staff }
 */
export function summarizeTasks(tasks = [], now = new Date()) {
  const summary = { total: tasks.length, pending: 0, in_progress: 0, done: 0, overdue: 0 };
  const byStaff = new Map();
  for (const t of tasks) {
    summary[t.status] = (summary[t.status] || 0) + 1;
    const overdue = isOverdue(t, now);
    if (overdue) summary.overdue += 1;

    const key = t.staff_name || `#${t.staff_member_id}`;
    const slot = byStaff.get(key)
      || { staff_name: key, total: 0, done: 0, overdue: 0 };
    slot.total += 1;
    if (t.status === 'done') slot.done += 1;
    if (overdue) slot.overdue += 1;
    byStaff.set(key, slot);
  }
  return { ...summary, by_staff: [...byStaff.values()] };
}
