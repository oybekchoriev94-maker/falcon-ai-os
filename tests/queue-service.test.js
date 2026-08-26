// ============================================================
// Jonli navbat va dublikat tekshiruvi — unit testlar (DB'siz)
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildLiveQueue, matchReasons, buildCallAnnouncement } from '../backend/services/queue-service.js';

const NOW = new Date(2026, 7, 26, 12, 0); // 2026-08-26 12:00 lokal
const minAgo = (m) => new Date(NOW.getTime() - m * 60000);

describe('buildLiveQueue — jonli navbat', () => {
  it('bo\'sh manbalar bo\'sh navbat qaytaradi', () => {
    const r = buildLiveQueue([], [], NOW);
    expect(r.queue).toEqual([]);
    expect(r.counts).toEqual({ in_progress: 0, waiting: 0 });
  });

  it('kelish tartibi bo\'yicha saralaydi va kutish vaqtini hisoblaydi', () => {
    const r = buildLiveQueue([
      { id: 1, patient_name: 'Bemor B', phone: '+998901111111', doctor_name: 'Dr X', status: 'confirmed', arrived_at: minAgo(5).toISOString() },
      { id: 2, patient_name: 'Bemor A', phone: '+998902222222', doctor_name: 'Dr X', status: 'confirmed', arrived_at: minAgo(30).toISOString() },
    ], [], NOW);
    expect(r.queue[0].patient_name).toBe('Bemor A');
    expect(r.queue[0].wait_minutes).toBe(30);
    expect(r.queue[0].position).toBe(1);
    expect(r.queue[1].position).toBe(2);
  });

  it('in_progress har doim birinchi', () => {
    const r = buildLiveQueue([
      { id: 1, patient_name: 'Kutyapti', phone: '', status: 'confirmed', arrived_at: minAgo(60).toISOString() },
      { id: 2, patient_name: 'Qabulda', phone: '', status: 'in_progress', arrived_at: minAgo(10).toISOString() },
    ], [], NOW);
    expect(r.queue[0].patient_name).toBe('Qabulda');
    expect(r.counts).toEqual({ in_progress: 1, waiting: 1 });
  });

  it('appointment va queue dublikatini tozalaydi (telefon+ism)', () => {
    const r = buildLiveQueue(
      [{ id: 1, patient_name: 'Aliyev Vali', phone: '901234567', status: 'confirmed', arrived_at: minAgo(20).toISOString() }],
      [{ id: 10, patient_name: 'aliyev  vali', phone: '+998901234567', doctor: 'Dr X', status: 'waiting', created_at: minAgo(20).toISOString() }],
      NOW
    );
    expect(r.queue).toHaveLength(1);
    expect(r.queue[0].source).toBe('appointment');
  });

  it('queue in_progress bo\'lsa dublikatda statusni ko\'taradi', () => {
    const r = buildLiveQueue(
      [{ id: 1, patient_name: 'Aliyev Vali', phone: '+998901234567', status: 'confirmed', arrived_at: minAgo(20).toISOString() }],
      [{ id: 10, patient_name: 'Aliyev Vali', phone: '+998901234567', status: 'in_progress', created_at: minAgo(20).toISOString() }],
      NOW
    );
    expect(r.queue).toHaveLength(1);
    expect(r.queue[0].status).toBe('in_progress');
  });

  it('faqat queue manbaidagi bemorlar ham ko\'rinadi', () => {
    const r = buildLiveQueue([], [
      { id: 5, patient_name: 'Karimov', phone: '', doctor: 'Dr Y', status: 'waiting', created_at: minAgo(3).toISOString() },
    ], NOW);
    expect(r.queue).toHaveLength(1);
    expect(r.queue[0].source).toBe('queue');
    expect(r.queue[0].doctor_name).toBe('Dr Y');
    expect(r.queue[0].wait_minutes).toBe(3);
  });
});

describe('matchReasons — dublikat sabablari', () => {
  const patient = {
    phone: '+998901234567',
    passport_number: 'AA1234567',
    first_name: 'Vali',
    last_name: 'Aliyev',
  };

  it('telefon formatidan qat\'i nazar moslaydi', () => {
    expect(matchReasons(patient, { phone: '901234567' })).toContain('phone');
    expect(matchReasons(patient, { phone: '+998 90 123-45-67' })).toContain('phone');
    expect(matchReasons(patient, { phone: '+998909999999' })).toEqual([]);
  });

  it('pasport registr va probelga chidamli', () => {
    expect(matchReasons(patient, { passport_number: ' aa1234567 ' })).toContain('passport');
    expect(matchReasons(patient, { passport_number: 'BB7654321' })).toEqual([]);
  });

  it('ism qisman mos kelsa ham signal beradi', () => {
    expect(matchReasons(patient, { name: 'Vali Aliyev' })).toContain('name');
    expect(matchReasons(patient, { name: 'Vali' })).toContain('name');
    expect(matchReasons(patient, { name: 'Butunlay Boshqa' })).toEqual([]);
  });

  it('bir nechta sabab birga qaytadi', () => {
    const reasons = matchReasons(patient, { phone: '+998901234567', passport_number: 'AA1234567' });
    expect(reasons).toContain('phone');
    expect(reasons).toContain('passport');
  });
});

describe('buildCallAnnouncement — ovozli chaqiruv matni', () => {
  it('bron bemori uchun to\'liq e\'lon tuzadi (PII qisqartirilgan)', () => {
    const text = buildCallAnnouncement({
      patient_name: 'Aliyev Vali', doctor_name: 'Dr Karimov', access_code: 'A1B2', room: 3,
    });
    expect(text).toBe('Hurmatli Aliyev V., 3-xona, Dr Karimov qabuliga marhamat. Kodingiz: A1B2.');
  });

  it('walk-in bemor uchun navbat raqamini aytadi', () => {
    const text = buildCallAnnouncement({ patient_name: 'Bemor B', doctor_name: 'Qabul', queue_number: 12 });
    expect(text).toBe('Hurmatli Bemor B., Qabul qabuliga marhamat. Kodingiz: N12.');
  });

  it('bo\'sh yoki ismsiz element uchun bo\'sh qaytaradi', () => {
    expect(buildCallAnnouncement(null)).toBe('');
    expect(buildCallAnnouncement({ patient_name: '  ' })).toBe('');
  });
});
