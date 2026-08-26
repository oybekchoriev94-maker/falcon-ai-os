// ============================================================
// Ombor-kamera korrelyatsiyasi — unit testlar (DB'siz, PR #12)
// ============================================================

import { describe, it, expect } from 'vitest';
import { correlateWarehouseEvents, summarizeWarehouse, DEFAULT_WINDOW_MINUTES } from '../backend/services/warehouse-service.js';

const local = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).toISOString();

const tx = (over = {}) => ({
  id: 1, type: 'IN', quantity: 10, performed_by: 'user-1',
  reason: 'Kirim', created_at: local(2026, 8, 26, 10, 0), item_name: 'Bint',
  ...over,
});

describe('correlateWarehouseEvents — kamera bilan bog\'lash', () => {
  it('oyna ichidagi kamera hodisasi dalil bo\'ladi', () => {
    const rows = correlateWarehouseEvents(
      [tx()],
      [{ subject_ref: 'staff:aliyev-vali', occurred_at: local(2026, 8, 26, 10, 2) }]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      camera_evidence: true, matched_events: 1,
      nearest_subject_ref: 'staff:aliyev-vali', flags: [],
    });
    expect(rows[0].nearest_event_at).toBe(local(2026, 8, 26, 10, 2));
  });

  it('oyna tashqarisidagi hodisa dalil emas', () => {
    const rows = correlateWarehouseEvents(
      [tx()],
      [{ occurred_at: local(2026, 8, 26, 10, 30) }]
    );
    expect(rows[0].camera_evidence).toBe(false);
    expect(rows[0].matched_events).toBe(0);
    expect(rows[0].nearest_event_at).toBeNull();
    expect(rows[0].flags).toEqual(['no_camera']);
  });

  it('oyna chegarasi (+/-5 daqiqa) chegara sifatida ishlaydi', () => {
    const events = [
      { occurred_at: local(2026, 8, 26, 10, 5) },   // aynan +5 — ichida
      { occurred_at: local(2026, 8, 26, 9, 55) },   // aynan -5 — ichida
    ];
    const rows = correlateWarehouseEvents([tx()], events);
    expect(rows[0].matched_events).toBe(2);
  });

  it('eng yaqin hodisa tanlanadi', () => {
    const rows = correlateWarehouseEvents(
      [tx()],
      [
        { subject_ref: 'staff:birinchi', occurred_at: local(2026, 8, 26, 9, 57) },
        { subject_ref: 'staff:yaqin', occurred_at: local(2026, 8, 26, 10, 1) },
        { subject_ref: 'staff:uzoq', occurred_at: local(2026, 8, 26, 10, 4) },
      ]
    );
    expect(rows[0].nearest_subject_ref).toBe('staff:yaqin');
  });

  it('oyna parametri hurmat qilinadi', () => {
    const rows = correlateWarehouseEvents(
      [tx()],
      [{ occurred_at: local(2026, 8, 26, 10, 8) }],
      10
    );
    expect(rows[0].camera_evidence).toBe(true);
  });

  it('buzuq window defaultga qaytadi', () => {
    const rows = correlateWarehouseEvents(
      [tx()],
      [{ occurred_at: local(2026, 8, 26, 10, DEFAULT_WINDOW_MINUTES) }],
      'abc'
    );
    expect(rows[0].camera_evidence).toBe(true);
  });

  it('manfiy ADJUST kamomad belgisini oladi', () => {
    const rows = correlateWarehouseEvents(
      [tx({ id: 2, type: 'ADJUST', quantity: -3, reason: 'Yo\'qotish' })],
      [{ occurred_at: local(2026, 8, 26, 10, 1) }]
    );
    expect(rows[0].flags).toEqual(['kamomad']);
  });

  it('kamerasiz manfiy ADJUST ikkala belgini ham oladi', () => {
    const rows = correlateWarehouseEvents([tx({ type: 'ADJUST', quantity: -1 })], []);
    expect(rows[0].flags).toEqual(['no_camera', 'kamomad']);
  });

  it('buzuq sanalar xato bermaydi (kamera yo\'q deb hisoblanadi)', () => {
    const rows = correlateWarehouseEvents(
      [tx({ created_at: 'not-a-date' }), tx({ id: 2 })],
      [{ occurred_at: 'not-a-date' }]
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.camera_evidence)).toBe(true);
  });

  it('yangi tranzaksiyalar tepada saralanadi', () => {
    const rows = correlateWarehouseEvents([
      tx({ id: 1, created_at: local(2026, 8, 26, 9, 0) }),
      tx({ id: 2, created_at: local(2026, 8, 26, 11, 0) }),
    ]);
    expect(rows.map((r) => r.tx_id)).toEqual([2, 1]);
  });

  it('bo\'sh ro\'yxatlar xavfsiz', () => {
    expect(correlateWarehouseEvents()).toEqual([]);
    expect(correlateWarehouseEvents([], [])).toEqual([]);
  });
});

describe('summarizeWarehouse — direktor agregati', () => {
  it('to\'g\'ri hisoblaydi', () => {
    const rows = correlateWarehouseEvents([
      tx({ id: 1 }),
      tx({ id: 2, created_at: local(2026, 8, 26, 12, 0) }),
      tx({ id: 3, type: 'ADJUST', quantity: -2, created_at: local(2026, 8, 26, 13, 0) }),
    ], [{ occurred_at: local(2026, 8, 26, 10, 1) }]);
    expect(summarizeWarehouse(rows)).toEqual({
      total: 3, with_camera: 1, without_camera: 2, kamomad: 1,
    });
  });

  it('bo\'sh natija nol hisobot', () => {
    expect(summarizeWarehouse()).toEqual({ total: 0, with_camera: 0, without_camera: 0, kamomad: 0 });
  });
});
