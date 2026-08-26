// ============================================================
// Falcon AI OS — Xodim nazorati qoidalari (deterministik)
//
// Yo'l xarita qoidasi: kamera JAZO emas, DALIL. Barcha chiqishlar
// "report" va "alert" darajasida — yakuniy qaror rahbarda.
//
// Manbalar:
//   - attendance_events — Face ID agent (asosiy yozuv: keldi/ketdi)
//   - vision_events     — Edge kameralar (tasdiqlovchi dalil, zonalar)
//   - staff_shifts      — kutilayotgan smena
//
// Funksiyalar SOF — DB'dan mustaqil, shu sababli unit-test qilinadi.
// ============================================================

const CAMERA_CONFIRM_WINDOW_MIN = 10;

/** 'HH:MM' -> kun ichidagi daqiqalar */
export function parseTimeToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Date -> kun ichidagi daqiqalar (lokal vaqt) */
export function minutesOfDay(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.getHours() * 60 + d.getMinutes();
}

/** Xodim ismidan Edge subject_ref slug'ini yasaydi: 'Aliyev Vali' -> 'staff:aliyev-vali' */
export function staffSubjectRef(staffName) {
  const slug = String(staffName || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-яёўқғҳіў]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `staff:${slug}` : null;
}

/** 'YYYY-MM-DD' + 'HH:MM' -> Date */
function shiftMoment(shiftDate, timeStr) {
  const mins = parseTimeToMinutes(timeStr);
  if (mins === null) return null;
  const d = new Date(`${shiftDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + mins * 60000);
}

/**
 * Bitta smena bo'yicha davomat bahosi.
 *
 * @param {Object} opts
 * @param {Object} opts.shift      { staff_name, shift_date:'YYYY-MM-DD', start_time, end_time, grace_minutes }
 * @param {Array}  opts.attendance { person_name, direction:'in'|'out', occurred_at }
 * @param {Array}  opts.vision     { subject_ref, occurred_at } (ixtiyoriy, dalil uchun)
 * @returns {Object} { staff_name, status, first_in, last_out, late_minutes, early_leave_minutes, camera_confirmed, source }
 *   status: 'absent' | 'late' | 'early_leave' | 'present'
 */
export function evaluateShift({ shift, attendance = [], vision = [] }) {
  const start = shiftMoment(shift.shift_date, shift.start_time);
  const end = shiftMoment(shift.shift_date, shift.end_time);
  if (!start || !end) {
    return { staff_name: shift.staff_name, status: 'absent', error: 'invalid_shift' };
  }
  // Tungi smena: tugash boshlanishdan oldin bo'lsa — keyingi kunga o'tadi
  if (end <= start) end.setTime(end.getTime() + 24 * 3600 * 1000);

  const graceMs = Math.max(0, Number(shift.grace_minutes) || 0) * 60000;
  const windowFrom = new Date(start.getTime() - 2 * 3600 * 1000);
  const windowTo = new Date(end.getTime() + 6 * 3600 * 1000);

  const mine = attendance.filter((e) => {
    if (e.person_name !== shift.staff_name) return false;
    const t = new Date(e.occurred_at).getTime();
    return t >= windowFrom.getTime() && t <= windowTo.getTime();
  });

  const entries = mine.filter((e) => e.direction === 'in').sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
  const exits = mine.filter((e) => e.direction === 'out').sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
  const firstIn = entries[0] ? new Date(entries[0].occurred_at) : null;
  const lastOut = exits[0] ? new Date(exits[0].occurred_at) : null;

  const base = {
    staff_name: shift.staff_name,
    shift: { date: shift.shift_date, start: shift.start_time, end: shift.end_time },
    first_in: firstIn ? firstIn.toISOString() : null,
    last_out: lastOut ? lastOut.toISOString() : null,
    source: 'face_id',
  };

  if (!firstIn) {
    return { ...base, status: 'absent', late_minutes: 0, early_leave_minutes: 0, camera_confirmed: false };
  }

  const lateMinutes = Math.max(0, Math.round((firstIn - (start.getTime() + graceMs)) / 60000));
  const earlyLeaveMinutes = lastOut && lastOut.getTime() < end.getTime() - 15 * 60000
    ? Math.round((end - lastOut) / 60000)
    : 0;

  // Kamera dalili: subject_ref mos va kelish/ketish vaqtiga ±10 daqiqa yaqin
  const ref = staffSubjectRef(shift.staff_name);
  const confirmWindowMs = CAMERA_CONFIRM_WINDOW_MIN * 60000;
  const cameraConfirmed = Boolean(ref) && vision.some((v) => {
    if (v.subject_ref !== ref) return false;
    const t = new Date(v.occurred_at).getTime();
    return Math.abs(t - firstIn.getTime()) <= confirmWindowMs
      || (lastOut && Math.abs(t - lastOut.getTime()) <= confirmWindowMs);
  });

  let status = 'present';
  if (lateMinutes > 0) status = 'late';
  if (earlyLeaveMinutes > 0 && lateMinutes === 0) status = 'early_leave';

  return {
    ...base,
    status,
    late_minutes: lateMinutes,
    early_leave_minutes: earlyLeaveMinutes,
    camera_confirmed: cameraConfirmed,
  };
}

/**
 * Bir kun uchun barcha smenalar hisoboti.
 * @param {Array} shifts    kun smenalari
 * @param {Array} attendance kun davomat hodisalari
 * @param {Array} vision     kun kamera hodisalari
 */
export function buildDailyReport(shifts, attendance, vision) {
  const rows = shifts.map((shift) => evaluateShift({ shift, attendance, vision }));
  const summary = { total: rows.length, present: 0, late: 0, early_leave: 0, absent: 0 };
  for (const r of rows) summary[r.status] = (summary[r.status] || 0) + 1;
  return { summary, rows };
}

/**
 * Zona qoidalarini buzilishlarni aniqlaydi (faqat SIGNAL — jazo emas).
 *
 * @param {Array} events { id?, zone_id, subject_ref, occurred_at, camera_id? }
 * @param {Array} rules  { zone_id, rule_type:'after_hours'|'restricted', allowed_start?, allowed_end?, severity, enabled }
 * @returns {Array} alerts [{ zone_id, rule_type, severity, occurred_at, subject_ref, camera_id, event_id }]
 */
export function detectZoneAlerts(events, rules) {
  const active = (rules || []).filter((r) => r.enabled !== false);
  const alerts = [];

  for (const ev of events || []) {
    for (const rule of active) {
      if (rule.zone_id !== ev.zone_id) continue;

      if (rule.rule_type === 'restricted') {
        alerts.push(toAlert(ev, rule));
        continue;
      }

      if (rule.rule_type === 'after_hours') {
        const from = parseTimeToMinutes(rule.allowed_start ?? '00:00');
        const to = parseTimeToMinutes(rule.allowed_end ?? '23:59');
        if (from === null || to === null) continue;
        const t = minutesOfDay(ev.occurred_at);
        // Tungi oyna: 22:00–06:00 kabi (from > to)
        const inside = from <= to ? (t >= from && t <= to) : (t >= from || t <= to);
        if (!inside) alerts.push(toAlert(ev, rule));
      }
    }
  }

  return alerts.sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
}

function toAlert(ev, rule) {
  return {
    zone_id: ev.zone_id,
    rule_type: rule.rule_type,
    severity: rule.severity || 'warning',
    occurred_at: ev.occurred_at,
    subject_ref: ev.subject_ref || null,
    camera_id: ev.camera_id || null,
    event_id: ev.id || null,
  };
}

/**
 * Kamera hodisalaridan xodimlarning zona-faolligini hisoblaydi.
 * Faqat 'staff:...' bilan belgilangan hodisalar olinadi.
 *
 * DIQQAT: span = birinchi va oxirgi ko'rinish orasi (taxminiy).
 * Kamera ko'rmagan vaqt hisoblanmaydi — bu DALIL, aniq hisob emas.
 *
 * @param {Array} events { zone_id, subject_ref, occurred_at }
 * @returns {Array} [{ subject_ref, zone_id, first_seen, last_seen, count, span_minutes }]
 */
export function buildZonePresence(events = []) {
  const map = new Map();
  for (const ev of events) {
    const ref = ev.subject_ref;
    if (!ref || !String(ref).startsWith('staff:')) continue;
    const t = new Date(ev.occurred_at).getTime();
    if (!Number.isFinite(t)) continue;
    const key = `${ref}|${ev.zone_id}`;
    const slot = map.get(key) || {
      subject_ref: ref, zone_id: ev.zone_id,
      first: t, last: t, count: 0,
    };
    slot.first = Math.min(slot.first, t);
    slot.last = Math.max(slot.last, t);
    slot.count += 1;
    map.set(key, slot);
  }
  return [...map.values()].map((s) => ({
    subject_ref: s.subject_ref,
    zone_id: s.zone_id,
    first_seen: new Date(s.first).toISOString(),
    last_seen: new Date(s.last).toISOString(),
    count: s.count,
    span_minutes: Math.round((s.last - s.first) / 60000),
  })).sort((a, b) => a.subject_ref.localeCompare(b.subject_ref) || a.zone_id.localeCompare(b.zone_id));
}

/**
 * presence_required qoidalari bo'yicha signallar: smenasi bor xodim
 * o'sha kuni belgilangan zonada UMUMAN ko'rinmagan bo'lsa — signal.
 * (Ko'ringan bo'lsa — davomat hisoboti qancha turganini ko'rsatadi.)
 *
 * @param {Array} shifts   kun smenalari { staff_name, shift_date, start_time }
 * @param {Array} rules    zona qoidalari (rule_type='presence_required')
 * @param {Array} presence buildZonePresence() natijasi
 * @returns {Array} alerts [{ zone_id, rule_type, severity, occurred_at, subject_ref, staff_name }]
 */
export function detectPresenceAlerts(shifts = [], rules = [], presence = []) {
  const required = (rules || []).filter((r) => r.enabled !== false && r.rule_type === 'presence_required');
  if (!required.length) return [];
  const seen = new Set((presence || []).map((p) => `${p.subject_ref}|${p.zone_id}`));
  const alerts = [];
  for (const rule of required) {
    for (const shift of shifts) {
      const ref = staffSubjectRef(shift.staff_name);
      if (!ref || seen.has(`${ref}|${rule.zone_id}`)) continue;
      const start = shiftMoment(shift.shift_date, shift.start_time);
      alerts.push({
        zone_id: rule.zone_id,
        rule_type: 'presence_required',
        severity: rule.severity || 'warning',
        occurred_at: start ? start.toISOString() : `${shift.shift_date}T${shift.start_time || '00:00'}:00`,
        subject_ref: ref,
        staff_name: shift.staff_name,
        camera_id: null,
        event_id: null,
      });
    }
  }
  return alerts;
}
