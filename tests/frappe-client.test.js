// ============================================================
// Frappe HRMS klient — unit testlar (DB'siz, tarmoqsiz)
//
// CI'da FRAPPE_URL YO'Q — integratsiya o'chirilgan holatda
// testlanadi: sof konstruktorlar to'g'ri ishlashi kerak, tarmoq
// funksiyalari null qaytarishi (hech narsa buzilmaydi).
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  isFrappeEnabled,
  toFrappeEmployee,
  toFrappeAttendance,
  createFrappeDoc,
  updateFrappeDoc,
  findFrappeDoc,
} from '../backend/services/frappe-client.js';

describe('Frappe gate', () => {
  it('FRAPPE_URL bo\'sh bo\'lsa integratsiya o\'chiq', () => {
    expect(isFrappeEnabled()).toBe(false);
  });

  it('o\'chiq holda create/update/find null qaytaradi (tarmoqqa chiqmaydi)', async () => {
    expect(await createFrappeDoc('Employee', {})).toBeNull();
    expect(await updateFrappeDoc('Employee', 'HR-EMP-0001', {})).toBeNull();
    expect(await findFrappeDoc('Attendance', [['employee', '=', 'x']])).toBeNull();
  });
});

describe('toFrappeEmployee', () => {
  it('to\'liq xodimni Frappe Employee payload\'iga aylantiradi', () => {
    const doc = toFrappeEmployee({
      full_name: '  Aliyev Vali  ',
      position: 'Terapevt',
      phone: '+998901234567',
    });
    expect(doc).toEqual({
      employee_name: 'Aliyev Vali',
      status: 'Active',
      designation: 'Terapevt',
      cell_number: '+998901234567',
    });
  });

  it('position/phone bo\'lmasa chiqmaydi', () => {
    const doc = toFrappeEmployee({ full_name: 'Bemor B' });
    expect(doc.designation).toBeUndefined();
    expect(doc.cell_number).toBeUndefined();
    expect(doc.employee_name).toBe('Bemor B');
  });
});

describe('toFrappeAttendance — kamera dalil, jazo emas', () => {
  it('present → Present (remarks yo\'q)', () => {
    const doc = toFrappeAttendance({ employeeName: 'HR-1', date: '2026-08-26', status: 'present' });
    expect(doc).toEqual({ employee: 'HR-1', attendance_date: '2026-08-26', status: 'Present' });
  });

  it('late → Present + kechikish remarks\'da (status o\'zgarmaydi)', () => {
    const doc = toFrappeAttendance({ employeeName: 'HR-1', date: '2026-08-26', status: 'late', lateMinutes: 23 });
    expect(doc.status).toBe('Present');
    expect(doc.remarks).toBe('Kechikish: 23 daqiqa');
  });

  it('early_leave → Present + erta ketish remarks\'da', () => {
    const doc = toFrappeAttendance({ employeeName: 'HR-1', date: '2026-08-26', status: 'early_leave', earlyLeaveMinutes: 40 });
    expect(doc.status).toBe('Present');
    expect(doc.remarks).toBe('Erta ketish: 40 daqiqa');
  });

  it('absent → Absent', () => {
    const doc = toFrappeAttendance({ employeeName: 'HR-1', date: '2026-08-26', status: 'absent' });
    expect(doc.status).toBe('Absent');
    expect(doc.remarks).toBeUndefined();
  });

  it('ma\'lumot yetishmasa null qaytadi', () => {
    expect(toFrappeAttendance({ employeeName: null, date: '2026-08-26', status: 'present' })).toBeNull();
    expect(toFrappeAttendance({ employeeName: 'HR-1', date: '', status: 'present' })).toBeNull();
    expect(toFrappeAttendance({ employeeName: 'HR-1', date: '2026-08-26', status: 'noma\'lum' })).toBeNull();
  });
});
