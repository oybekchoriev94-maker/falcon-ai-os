// ============================================================
// Vazifalar tizimi — unit testlar (DB'siz)
// ============================================================

import { describe, it, expect } from 'vitest';
import { canTransition, isOverdue, summarizeTasks, TASK_TRANSITIONS } from '../backend/services/task-service.js';

const NOW = new Date('2026-08-26T12:00:00Z');

describe('canTransition — status o\'tishlari', () => {
  it('pending → in_progress va done ruxsat', () => {
    expect(canTransition('pending', 'in_progress')).toBe(true);
    expect(canTransition('pending', 'done')).toBe(true);
  });

  it('in_progress → faqat done', () => {
    expect(canTransition('in_progress', 'done')).toBe(true);
    expect(canTransition('in_progress', 'pending')).toBe(false);
  });

  it('done — yakuniy holat, ortga qaytmaydi', () => {
    expect(canTransition('done', 'pending')).toBe(false);
    expect(canTransition('done', 'in_progress')).toBe(false);
    expect(TASK_TRANSITIONS.done).toEqual([]);
  });

  it('noma\'lum statusdan hech qayerga o\'tib bo\'lmaydi', () => {
    expect(canTransition('noma\'lum', 'done')).toBe(false);
  });
});

describe('isOverdue — kechikish mantiqi', () => {
  it('muddati o\'tgan va bajarilmagan = kechikkan', () => {
    expect(isOverdue({ status: 'pending', due_at: '2026-08-26T09:00:00Z' }, NOW)).toBe(true);
    expect(isOverdue({ status: 'in_progress', due_at: '2026-08-25T18:00:00Z' }, NOW)).toBe(true);
  });

  it('bajarilgan vazifa muddati o\'tsa ham kechikkan EMAS', () => {
    expect(isOverdue({ status: 'done', due_at: '2026-08-01T09:00:00Z' }, NOW)).toBe(false);
  });

  it('muddatsiz vazifa hech qachon kechikmaydi', () => {
    expect(isOverdue({ status: 'pending', due_at: null }, NOW)).toBe(false);
  });

  it('muddati hali kelmagan vazifa kechikkan emas', () => {
    expect(isOverdue({ status: 'pending', due_at: '2026-08-27T09:00:00Z' }, NOW)).toBe(false);
  });

  it('buzilgan sana bilan xato bermaydi (false)', () => {
    expect(isOverdue({ status: 'pending', due_at: 'not-a-date' }, NOW)).toBe(false);
  });
});

describe('summarizeTasks — direktor agregati', () => {
  const tasks = [
    { staff_member_id: 1, staff_name: 'Aliyev Vali', status: 'done', due_at: null },
    { staff_member_id: 1, staff_name: 'Aliyev Vali', status: 'pending', due_at: '2026-08-25T09:00:00Z' },
    { staff_member_id: 2, staff_name: 'Karimova Nilufar', status: 'in_progress', due_at: '2026-08-27T09:00:00Z' },
  ];

  it('umumiy va xodim-bo\'yicha hisoblar to\'g\'ri', () => {
    const s = summarizeTasks(tasks, NOW);
    expect(s.total).toBe(3);
    expect(s.done).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.in_progress).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.by_staff).toHaveLength(2);
    const aliyev = s.by_staff.find((x) => x.staff_name === 'Aliyev Vali');
    expect(aliyev).toEqual({ staff_name: 'Aliyev Vali', total: 2, done: 1, overdue: 1 });
  });

  it('bo\'sh ro\'yxat uchun nol hisobot', () => {
    const s = summarizeTasks([], NOW);
    expect(s).toMatchObject({ total: 0, pending: 0, done: 0, overdue: 0, by_staff: [] });
  });
});
