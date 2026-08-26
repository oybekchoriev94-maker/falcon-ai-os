// ============================================================
// Face ID v2 server tekshiruvi testlari (PR #10)
// Sof funksiyalar — DB kerak emas.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  parseFaceSubject,
  validateFaceEvent,
  MIN_CONFIRM_FRAMES,
  MIN_LIVENESS_SCORE,
  PATIENT_PREFIXES,
} from '../backend/services/face-validation.js';

describe('parseFaceSubject', () => {
  it('oddiy ism xodim deb qabul qilinadi', () => {
    expect(parseFaceSubject('Aliyev Vali')).toEqual({ subjectType: 'staff', personName: 'Aliyev Vali' });
  });

  it('bemor_ prefiksi bemorni ajratadi va ismni tozalaydi', () => {
    expect(parseFaceSubject('bemor_Alisher Karimov')).toEqual({
      subjectType: 'patient', personName: 'Alisher Karimov',
    });
  });

  it('bemor: prefiksi ham ishlaydi', () => {
    expect(parseFaceSubject('bemor:Dilnoza'))
      .toEqual({ subjectType: 'patient', personName: 'Dilnoza' });
  });

  it('prefiks registrga bog\'liq emas', () => {
    expect(parseFaceSubject('BEMOR_Alisher').subjectType).toBe('patient');
  });

  it('prefiksdan keyin ism bo\'lmasa asl nom qaytadi', () => {
    const r = parseFaceSubject('bemor_');
    expect(r.subjectType).toBe('patient');
    expect(r.personName).toBe('bemor_');
  });

  it('bo\'sh/null kiritish xavfsiz', () => {
    expect(parseFaceSubject(null)).toEqual({ subjectType: 'staff', personName: '' });
    expect(parseFaceSubject(undefined).personName).toBe('');
    expect(parseFaceSubject('  ').personName).toBe('');
  });

  it('har ikkala prefiks ro\'yxatda', () => {
    expect(PATIENT_PREFIXES).toContain('bemor_');
    expect(PATIENT_PREFIXES).toContain('bemor:');
  });
});

describe('validateFaceEvent', () => {
  it('eski agent (metadata yo\'q) legacy deb qabul qilinadi', () => {
    expect(validateFaceEvent({})).toEqual({ ok: true, flag: null, legacy: true });
    expect(validateFaceEvent()).toEqual({ ok: true, flag: null, legacy: true });
  });

  it('to\'liq v2 hodisa tekshiruvdan o\'tadi', () => {
    const r = validateFaceEvent({ frame_count: 4, liveness_score: 0.05, liveness_ok: true });
    expect(r).toEqual({ ok: true, flag: null, legacy: false });
  });

  it('liveness juda past — foto shubhasi', () => {
    const r = validateFaceEvent({ frame_count: 5, liveness_score: 0.004 });
    expect(r.ok).toBe(false);
    expect(r.flag).toBe('photo_suspect');
  });

  it('liveness chegarada (aynan MIN) o\'tadi', () => {
    const r = validateFaceEvent({ frame_count: 3, liveness_score: MIN_LIVENESS_SCORE });
    expect(r.ok).toBe(true);
    expect(r.flag).toBe(null);
  });

  it('liveness o\'tsa ham kadr yetarli emas — low_frames', () => {
    const r = validateFaceEvent({ frame_count: 1, liveness_score: 0.08 });
    expect(r.ok).toBe(false);
    expect(r.flag).toBe('low_frames');
  });

  it('liveness chegaradan past bo\'lsa kadr sonidan oldin tekshiriladi', () => {
    const r = validateFaceEvent({ frame_count: 1, liveness_score: 0.0 });
    expect(r.flag).toBe('photo_suspect');
  });

  it('chegara qiymatlari agentdagi standartlar bilan mos', () => {
    expect(MIN_CONFIRM_FRAMES).toBe(3);
    expect(MIN_LIVENESS_SCORE).toBe(0.02);
  });

  it('noto\'g\'ri tipli maydonlar e\'tiborga olinmaydi', () => {
    // frame_count matn, liveness_score undefined -> legacy
    expect(validateFaceEvent({ frame_count: 'uch' })).toEqual({ ok: true, flag: null, legacy: true });
  });

  it('faqat liveness yuborilsa ham tekshiriladi', () => {
    expect(validateFaceEvent({ liveness_score: 0.05 }).ok).toBe(true);
    expect(validateFaceEvent({ liveness_score: 0.001 }).flag).toBe('photo_suspect');
  });

  it('FAQAT frame_count yuborilsa ham tekshiriladi', () => {
    expect(validateFaceEvent({ frame_count: 3 }).ok).toBe(true);
    expect(validateFaceEvent({ frame_count: 2 }).flag).toBe('low_frames');
  });
});
