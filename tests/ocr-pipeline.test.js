// ============================================================
// Hujjat elektronlashtirish pipeline — unit testlar (DB'siz, PR #8)
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  DOC_TYPES, DOC_TYPE_LABEL, STRUCTURED_KEYS,
  buildExtractionPrompt, sanitizeRawText, parseStructured, decideStatus,
} from '../backend/services/ocr-pipeline.js';

describe('buildExtractionPrompt — hujjat turi bo\'yicha prompt', () => {
  it('har bir tur uchun label promptga kiradi', () => {
    for (const t of DOC_TYPES) {
      const { system, label } = buildExtractionPrompt(t);
      expect(label).toBe(DOC_TYPE_LABEL[t]);
      expect(system).toContain(label);
    }
  });

  it('JSON sharti va haluksizlik qoidasi promptda bor', () => {
    const { system } = buildExtractionPrompt('tibbiy_karta');
    expect(system).toContain('JSON');
    expect(system).toContain('null');
    expect(system.toLowerCase()).toContain("o'ylama");
  });

  it('noma\'lum tur "boshqa"ga tushadi', () => {
    const { label } = buildExtractionPrompt('not-a-type');
    expect(label).toBe(DOC_TYPE_LABEL.boshqa);
  });
});

describe('sanitizeRawText — xom matn tozalash', () => {
  it('bo\'shliqlarni ixchamlaydi', () => {
    expect(sanitizeRawText('  salom    dunyo  ')).toBe('salom dunyo');
    expect(sanitizeRawText('a\r\nb')).toBe('a\nb');
    expect(sanitizeRawText('a\n\n\n\nb')).toBe('a\n\nb');
  });

  it('juda uzun matnni chegaralaydi', () => {
    const long = 'x'.repeat(200_000);
    expect(sanitizeRawText(long)).toHaveLength(100_000);
  });

  it('matn bo\'lmasa bo\'sh qaytaradi', () => {
    expect(sanitizeRawText(null)).toBe('');
    expect(sanitizeRawText(123)).toBe('');
    expect(sanitizeRawText('   ')).toBe('');
  });
});

describe('parseStructured — AI javobini tozalash', () => {
  it('whitelist maydonlarni saqlaydi, qolganlarini tashlaydi', () => {
    const out = parseStructured({
      patient_name: '  Aliyev Vali ',
      diagnosis: 'Gastrit',
      hacker_field: 'DROP TABLE',
    });
    expect(out.patient_name).toBe('Aliyev Vali');
    expect(out.diagnosis).toBe('Gastrit');
    expect(out.hacker_field).toBeUndefined();
    expect(out.summary).toBeNull();
  });

  it('bo\'sh va null qiymatlar null bo\'ladi', () => {
    const out = parseStructured({ patient_name: '', diagnosis: '   ', notes: null });
    expect(out).toBeNull(); // hech narsa topilmadi
  });

  it('array maydonlar birlashtiriladi', () => {
    const out = parseStructured({ medications: ['Paratsetamol', '  ', 'Ibuprofen'] });
    expect(out.medications).toBe('Paratsetamol; Ibuprofen');
  });

  it('sonli qiymat satrga aylanadi', () => {
    const out = parseStructured({ phone: 998901234567 });
    expect(out.phone).toBe('998901234567');
  });

  it('uzun maydon 2000 belgiga kesiladi', () => {
    const out = parseStructured({ notes: 'a'.repeat(5000) });
    expect(out.notes).toHaveLength(2000);
  });

  it('xato va noto\'g\'ri kirishlar null qaytaradi', () => {
    expect(parseStructured({ error: 'LLM xatosi' })).toBeNull();
    expect(parseStructured(null)).toBeNull();
    expect(parseStructured('oddiy matn')).toBeNull();
    expect(parseStructured(['array'])).toBeNull();
  });

  it('barcha STRUCTURED_KEYS promptdagi shart bilan mos', () => {
    expect(STRUCTURED_KEYS).toContain('summary');
    expect(STRUCTURED_KEYS).toContain('patient_name');
    expect(STRUCTURED_KEYS).toHaveLength(10);
  });
});

describe('decideStatus — pipeline holati', () => {
  it('qattiq xato bo\'lsa — failed', () => {
    const r = decideStatus({ rawText: 'matn bor', structured: null, hardError: 'OCR xatosi' });
    expect(r.status).toBe('failed');
    expect(r.error).toContain('OCR');
  });

  it('matn olinmasa — failed', () => {
    const r = decideStatus({ rawText: '   ', structured: null, hardError: null });
    expect(r.status).toBe('failed');
    expect(r.error).toBeTruthy();
  });

  it('matn bor, structured yo\'q bo\'lsa ham — done (qo\'lda to\'ldiriladi)', () => {
    const r = decideStatus({ rawText: 'Bemor shikoyati bor', structured: null, hardError: null });
    expect(r).toEqual({ status: 'done', error: null });
  });

  it('uzun xato 500 belgiga kesiladi', () => {
    const r = decideStatus({ rawText: '', structured: null, hardError: 'x'.repeat(900) });
    expect(r.error).toHaveLength(500);
  });
});
