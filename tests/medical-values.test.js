// ============================================================
// Tibbiy qiymatlarni tekshirish — LLM'ga ishonmaydigan oxirgi qatlam.
//
// Bu yerdagi holatlarning KO'PCHILIGI production'da kuzatilgan:
// harorat 375 bo'lib kelgan, "oltmish sakkiz" 69 deb o'girilgan,
// bo'y maydoniga mantiqsiz qiymat tushgan.
//
// ASOSIY TAMOYIL: chegaradan tashqaridagi qiymat NULL bo'ladi, taxmin
// QILINMAYDI. Bo'sh maydon shifokorga ko'rinadi va u to'ldiradi;
// noto'g'ri qiymat esa to'g'ridek ko'rinib, tekshirilmay tibbiy
// hujjatga tushadi.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  uzWordsToNumber, parseNumber,
  sanitizeTemperature, sanitizeHeight, sanitizeWeight,
  sanitizePulse, sanitizeSaturation, sanitizeRespiration,
  sanitizeBloodPressure, sanitizePhone,
} from '../ai/utils/medical-values.js';

describe('uzWordsToNumber', () => {
  it('birlik va o\'nliklarni QO\'SHADI (LLM shu yerda xato qilgan)', () => {
    // Production: "oltmish sakkiz" -> 69 deb o'girilgan edi
    expect(uzWordsToNumber('oltmish sakkiz')).toBe(68);
    expect(uzWordsToNumber('yetmish besh')).toBe(75);
    expect(uzWordsToNumber("to'qson to'qqiz")).toBe(99);
  });

  it('yuzlik va minglikni to\'g\'ri hisoblaydi', () => {
    expect(uzWordsToNumber('bir yuz sakson ikki')).toBe(182);
    expect(uzWordsToNumber('yuz yetmish')).toBe(170);
    expect(uzWordsToNumber('ikki ming yigirma besh')).toBe(2025);
  });

  it('apostrofning turli ko\'rinishlarini tushunadi', () => {
    // Whisper va turli klaviaturalar boshqa-boshqa apostrof chiqaradi
    expect(uzWordsToNumber("o'ttiz")).toBe(30);
    expect(uzWordsToNumber('oʻttiz')).toBe(30);
    expect(uzWordsToNumber('o‘ttiz')).toBe(30);
  });

  it('son bo\'lmasa null', () => {
    expect(uzWordsToNumber('qorin og\'rig\'i')).toBeNull();
    expect(uzWordsToNumber('')).toBeNull();
  });
});

describe('parseNumber', () => {
  it('raqamni ham, so\'zni ham oladi', () => {
    expect(parseNumber('68')).toBe(68);
    expect(parseNumber('68 kg')).toBe(68);
    expect(parseNumber('37,5')).toBe(37.5);
    expect(parseNumber('oltmish sakkiz')).toBe(68);
    expect(parseNumber(68)).toBe(68);
  });
  it('bo\'sh qiymatga null', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });
});

describe('sanitizeTemperature', () => {
  it('tushib qolgan o\'nlik nuqtani tiklaydi', () => {
    // Production: 375 va 379 kelgan (37.5 / 37.9 o'rniga)
    expect(sanitizeTemperature(375)).toBe(37.5);
    expect(sanitizeTemperature(379)).toBe(37.9);
    expect(sanitizeTemperature(3750)).toBe(37.5);
  });
  it('normal qiymatga tegmaydi', () => {
    expect(sanitizeTemperature(37.5)).toBe(37.5);
    expect(sanitizeTemperature('36,6')).toBe(36.6);
  });
  it('tibbiy chegaradan tashqarisini rad etadi', () => {
    expect(sanitizeTemperature(12)).toBeNull();    // juda past
    expect(sanitizeTemperature(45)).toBeNull();    // yashash mumkin emas
    expect(sanitizeTemperature(0)).toBeNull();
  });
  it('so\'z bilan aytilganini ham o\'giradi', () => {
    expect(sanitizeTemperature("o'ttiz yetti")).toBe(37);
  });
});

describe('sanitizeHeight / sanitizeWeight', () => {
  it('chegara ichidagini qabul qiladi', () => {
    expect(sanitizeHeight(172)).toBe(172);
    expect(sanitizeHeight('bir yuz sakson ikki')).toBe(182);
    expect(sanitizeWeight(68)).toBe(68);
    expect(sanitizeWeight('oltmish sakkiz')).toBe(68);
  });
  it('mantiqsiz qiymatni TASHLAYDI (taxmin qilmaydi)', () => {
    expect(sanitizeHeight(1082)).toBeNull();   // "bir ming sakson ikki"
    expect(sanitizeHeight(20)).toBeNull();
    expect(sanitizeWeight(500)).toBeNull();
    expect(sanitizeWeight(0)).toBeNull();
  });
});

describe('vital ko\'rsatkichlar', () => {
  it('puls / saturatsiya / nafas chegaralari', () => {
    expect(sanitizePulse(78)).toBe(78);
    expect(sanitizePulse(400)).toBeNull();
    expect(sanitizeSaturation(98)).toBe(98);
    expect(sanitizeSaturation(140)).toBeNull();
    expect(sanitizeRespiration(18)).toBe(18);
    expect(sanitizeRespiration(120)).toBeNull();
  });

  it('qon bosimini formatlaydi', () => {
    expect(sanitizeBloodPressure('120/80')).toBe('120/80');
    expect(sanitizeBloodPressure('130 / 85')).toBe('130/85');
  });

  it('teskari yozilgan bosimga ishonmaydi', () => {
    // Diastolik sistolikdan katta bo'lishi mumkin emas — o'rni almashgan
    // yoki noto'g'ri o'qilgan. Taxmin qilib tuzatmaymiz.
    expect(sanitizeBloodPressure('80/120')).toBeNull();
    expect(sanitizeBloodPressure('500/300')).toBeNull();
    expect(sanitizeBloodPressure('shunchaki matn')).toBeNull();
  });
});

describe('sanitizePhone', () => {
  it('raqamli ko\'rinishlarni normallashtiradi', () => {
    expect(sanitizePhone('943123456')).toBe('+998943123456');
    expect(sanitizePhone('+998 94 312 34 56')).toBe('+998943123456');
    expect(sanitizePhone('94-312-34-56')).toBe('+998943123456');
  });

  it('so\'z bilan aytilgan raqamni yig\'adi', () => {
    // Diktantda odatda bo'laklab aytiladi
    expect(sanitizePhone("to'qson to'rt, uch yuz o'n ikki, o'ttiz to'rt, ellik olti"))
      .toBe('+998943123456');
  });

  it('aralash (raqam + so\'z) holatni ham uddalaydi', () => {
    expect(sanitizePhone("94, uch yuz o'n ikki, 34, ellik olti"))
      .toBe('+998943123456');
  });

  it('to\'liq bo\'lmagan raqamga null', () => {
    expect(sanitizePhone('94 312')).toBeNull();
    expect(sanitizePhone('')).toBeNull();
    expect(sanitizePhone('telefon aytilmadi')).toBeNull();
  });
});
