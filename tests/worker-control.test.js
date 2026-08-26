// ============================================================
// Xodim nazorati qoidalari — unit testlar (DB'siz)
// Vaqtlar LOCAL Date bilan yasaladi, shu sababli TZ'dan mustaqil.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  parseTimeToMinutes,
  staffSubjectRef,
  evaluateShift,
  buildDailyReport,
  detectZoneAlerts,
} from '../backend/services/worker-control.js';

const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

const baseShift = {
  staff_name: 'Aliyev Vali',
  shift_date: '2026-08-26',
  start_time: '09:00',
  end_time: '18:00',
  grace_minutes: 15,
};

describe('yordamchi funksiyalar', () => {
  it('parseTimeToMinutes', () => {
    expect(parseTimeToMinutes('09:00')).toBe(540);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
    expect(parseTimeToMinutes('25:00')).toBeNull();
    expect(parseTimeToMinutes('abc')).toBeNull();
  });

  it('staffSubjectRef slug yasaydi', () => {
    expect(staffSubjectRef('Aliyev Vali')).toBe('staff:aliyev-vali');
    expect(staffSubjectRef('  Karimov  Olim ')).toBe('staff:karimov-olim');
    expect(staffSubjectRef('')).toBeNull();
  });
});

describe('evaluateShift — davomat bahosi', () => {
  it('o\'z vaqtida kelgan: present', () => {
    const r = evaluateShift({
      shift: baseShift,
      attendance: [
        { person_name: 'Aliyev Vali', direction: 'in', occurred_at: local(2026, 8, 26, 8, 55) },
        { person_name: 'Aliyev Vali', direction: 'out', occurred_at: local(2026, 8, 26, 18, 5) },
      ],
    });
    expect(r.status).toBe('present');
    expect(r.late_minutes).toBe(0);
    expect(r.early_leave_minutes).toBe(0);
  });

  it('grace doirasida kelish kechikish emas', () => {
    const r = evaluateShift({
      shift: baseShift,
      attendance: [
        { person_name: 'Aliyev Vali', direction: 'in', occurred_at: local(2026, 8, 26, 9, 14) },
      ],
    });
    expect(r.status).toBe('present');
    expect(r.late_minutes).toBe(0);
  });

  it('kech kelish: daqiqa hisobida', () => {
    const r = evaluateShift({
      shift: baseShift,
      attendance: [
        { person_name: 'Aliyev Vali', direction: 'in', occurred_at: local(2026, 8, 26, 9, 40) },
      ],
    });
    expect(r.status).toBe('late');
    expect(r.late_minutes).toBe(25); // 09:40 - (09:00 + 15 daqiqa grace)
  });

  it('kelmagan: absent', () => {
    const r = evaluateShift({
      shift: baseShift,
      attendance: [
        { person_name: 'Boshqa Odam', direction: 'in', occurred_at: local(2026, 8, 26, 9, 0) },
      ],
    });
    expect(r.status).toBe('absent');
    expect(r.first_in).toBeNull();
  });

  it('erta ketish', () => {
    const r = evaluateShift({
      shift: baseShift,
      attendance: [
        { person_name: 'Aliyev Vali', direction: 'in', occurred_at: local(2026, 8, 26, 8, 50) },
        { person_name: 'Aliyev Vali', direction: 'out', occurred_at: local(2026, 8, 26, 16, 0) },
      ],
    });
    expect(r.status).toBe('early_leave');
    expect(r.early_leave_minutes).toBe(120);
  });

  it('tungi smena: 22:00 dan ertasi kun 06:00 gacha', () => {
    const night = { ...baseShift, start_time: '22:00', end_time: '06:00' };
    const r = evaluateShift({
      shift: night,
      attendance: [
        { person_name: 'Aliyev Vali', direction: 'in', occurred_at: local(2026, 8, 26, 21, 55) },
        { person_name: 'Aliyev Vali', direction: 'out', occurred_at: local(2026, 8, 27, 6, 10) },
      ],
    });
    expect(r.status).toBe('present');
    expect(r.early_leave_minutes).toBe(0);
  });

  it('kamera dalili: subject_ref mos va vaqti yaqin bo\'lsa tasdiqlanadi', () => {
    const r = evaluateShift({
      shift: baseShift,
      attendance: [
        { person_name: 'Aliyev Vali', direction: 'in', occurred_at: local(2026, 8, 26, 8, 55) },
      ],
      vision: [
        { subject_ref: 'staff:aliyev-vali', occurred_at: local(2026, 8, 26, 8, 57) },
      ],
    });
    expect(r.camera_confirmed).toBe(true);
  });

  it('kamera dalili: vaqt oralig\'i 10 daqiqadan katta bo\'lsa tasdiqlanmaydi', () => {
    const r = evaluateShift({
      shift: baseShift,
      attendance: [
        { person_name: 'Aliyev Vali', direction: 'in', occurred_at: local(2026, 8, 26, 8, 55) },
      ],
      vision: [
        { subject_ref: 'staff:aliyev-vali', occurred_at: local(2026, 8, 26, 10, 30) },
      ],
    });
    expect(r.camera_confirmed).toBe(false);
  });

  it('noto\'g\'ri smena vaqti: invalid_shift', () => {
    const r = evaluateShift({ shift: { ...baseShift, start_time: '99:99' }, attendance: [] });
    expect(r.status).toBe('absent');
    expect(r.error).toBe('invalid_shift');
  });
});

describe('buildDailyReport — kunlik hisobot', () => {
  it('summary to\'g\'ri sanaladi', () => {
    const shifts = [
      baseShift,
      { ...baseShift, staff_name: 'Karimov Olim' },
      { ...baseShift, staff_name: 'Yo\'q Odam' },
    ];
    const attendance = [
      { person_name: 'Aliyev Vali', direction: 'in', occurred_at: local(2026, 8, 26, 8, 55) },
      { person_name: 'Karimov Olim', direction: 'in', occurred_at: local(2026, 8, 26, 9, 50) },
    ];
    const report = buildDailyReport(shifts, attendance, []);
    expect(report.summary.total).toBe(3);
    expect(report.summary.present).toBe(1);
    expect(report.summary.late).toBe(1);
    expect(report.summary.absent).toBe(1);
    expect(report.rows).toHaveLength(3);
  });
});

describe('detectZoneAlerts — zona signallari', () => {
  const rules = [
    { zone_id: 'ombor', rule_type: 'after_hours', allowed_start: '08:00', allowed_end: '20:00', severity: 'critical', enabled: true },
    { zone_id: 'server-xona', rule_type: 'restricted', severity: 'critical', enabled: true },
    { zone_id: 'arxiv', rule_type: 'restricted', severity: 'warning', enabled: false },
    { zone_id: 'tungi-bo\'lim', rule_type: 'after_hours', allowed_start: '22:00', allowed_end: '06:00', severity: 'info', enabled: true },
  ];

  it('ish vaqtidan tashqari omborga kirish — signal', () => {
    const alerts = detectZoneAlerts(
      [{ id: 'e1', zone_id: 'ombor', subject_ref: 'staff:aliyev-vali', occurred_at: local(2026, 8, 26, 23, 30) }],
      rules
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].rule_type).toBe('after_hours');
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].subject_ref).toBe('staff:aliyev-vali');
  });

  it('ruxsat etilgan vaqtda omborga kirish — signal yo\'q', () => {
    const alerts = detectZoneAlerts(
      [{ zone_id: 'ombor', occurred_at: local(2026, 8, 26, 10, 0) }],
      rules
    );
    expect(alerts).toHaveLength(0);
  });

  it('restricted zonaga har qanday kirish — signal', () => {
    const alerts = detectZoneAlerts(
      [{ zone_id: 'server-xona', occurred_at: local(2026, 8, 26, 12, 0) }],
      rules
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].rule_type).toBe('restricted');
  });

  it('o\'chirilgan qoida ishlamaydi', () => {
    const alerts = detectZoneAlerts(
      [{ zone_id: 'arxiv', occurred_at: local(2026, 8, 26, 12, 0) }],
      rules
    );
    expect(alerts).toHaveLength(0);
  });

  it('tungi oyna (22:00–06:00): tunda kirish normal, kunduzi signal', () => {
    const nightEvents = [
      { zone_id: 'tungi-bo\'lim', occurred_at: local(2026, 8, 26, 23, 0) },
      { zone_id: 'tungi-bo\'lim', occurred_at: local(2026, 8, 27, 5, 0) },
      { zone_id: 'tungi-bo\'lim', occurred_at: local(2026, 8, 26, 14, 0) },
    ];
    const alerts = detectZoneAlerts(nightEvents, rules);
    expect(alerts).toHaveLength(1);
    expect(new Date(alerts[0].occurred_at).getHours()).toBe(14);
  });

  it('signal: qoidasiz zona va bo\'sh ro\'yxatlar xavfsiz', () => {
    expect(detectZoneAlerts([], rules)).toEqual([]);
    expect(detectZoneAlerts([{ zone_id: 'boshqa', occurred_at: local(2026, 8, 26, 9, 0) }], [])).toEqual([]);
  });
});
