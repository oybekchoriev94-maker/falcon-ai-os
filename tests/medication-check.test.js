import { describe, it, expect } from 'vitest';
import { validateMedications } from '../backend/services/medication-check.js';

describe('validateMedications — yangi format (medications massivi)', () => {
  it('to\'liq dori ogohlantirishsiz o\'tadi', () => {
    const { medications, warnings } = validateMedications({
      medications: [{ name: 'Paratsetamol', dose: '500 mg', frequency: '3 mahal' }],
    });
    expect(medications).toHaveLength(1);
    expect(medications[0].warnings).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('dozasi yo\'q dori — NO_DOSE', () => {
    const { medications, warnings } = validateMedications({
      medications: [{ name: 'Ibuprofen' }],
    });
    expect(medications[0].warnings).toContain('NO_DOSE');
    expect(warnings.some((w) => w.includes('Ibuprofen'))).toBe(true);
  });

  it('nomi yo\'q yozuv — NO_NAME', () => {
    const { medications } = validateMedications({
      medications: [{ dose: '10 ml' }],
    });
    expect(medications[0].warnings).toContain('NO_NAME');
  });

  it('dozada raqam yo\'q — DOSE_NO_NUMBER', () => {
    const { medications } = validateMedications({
      medications: [{ name: 'Omeprazol', dose: 'kuniga bir marta' }],
    });
    expect(medications[0].warnings).toContain('DOSE_NO_NUMBER');
  });

  it('shubhali katta son — IMPLAUSIBLE_VALUE (narx aralashgan)', () => {
    const { medications } = validateMedications({
      medications: [{ name: 'Azitromitsin', dose: '500000 so\'m' }],
    });
    expect(medications[0].warnings).toContain('IMPLAUSIBLE_VALUE');
  });

  it('satr ko\'rinishidagi element ham qayta ishlanadi', () => {
    const { medications } = validateMedications({
      medications: ['Metformin 850 mg'],
    });
    expect(medications[0].name).toBe('Metformin 850 mg');
  });
});

describe('validateMedications — eski format (medicines satri)', () => {
  it('vergul bilan ajratilgan ro\'yxatni bo\'ladi', () => {
    const { medications, warnings } = validateMedications({
      medicines: 'paratsetamol 500 mg; ibuprofen 200 mg',
    });
    expect(medications).toHaveLength(2);
    expect(medications[0].name).toBe('paratsetamol');
    expect(medications[0].dose).toBe('500 mg');
    expect(warnings).toEqual([]);
  });

  it('dozasi yo\'q satr — NO_DOSE ogohlantirish', () => {
    const { warnings } = validateMedications({ medicines: 'amoksitsillin' });
    expect(warnings.some((w) => w.includes('doza'))).toBe(true);
  });

  it('bo\'sh natija — bo\'sh ro\'yxat', () => {
    const { medications, warnings } = validateMedications({});
    expect(medications).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('LLM xato obyekti bo\'lsa ham yiqilmaydi', () => {
    const { medications } = validateMedications({ error: 'LLM sozlanmagan' });
    expect(medications).toEqual([]);
  });

  it('primitiv (satr) natija bilan yiqilmaydi', () => {
    expect(() => validateMedications('shunchaki matn')).not.toThrow();
  });

  it('o\'nlik dozalar (vergul bilan) to\'g\'ri o\'qiladi', () => {
    const { medications } = validateMedications({
      medications: [{ name: 'L-tiroksin', dose: '0,5 tabletka' }],
    });
    expect(medications[0].warnings).toEqual([]);
  });
});
