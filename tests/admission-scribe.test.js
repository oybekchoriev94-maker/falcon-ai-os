// ============================================================
// admission-scribe — modelning "deyarli to'g'ri" javobini formaga
// yaroqli holga keltirish mantig'i.
//
// NEGA TEST: bu nuqsonlarning HAMMASI production'da topilgan. Ular
// jimgina yuz beradi — shifokor formani ko'radi, maydon bo'sh yoki
// noto'g'ri, lekin xato xabari chiqmaydi. Shuning uchun har biri
// alohida qayd etilgan.
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';

// LLM chaqiruvini almashtiramiz — bu test PARSING mantig'ini sinaydi,
// modelning o'zini emas.
const llmJson = vi.fn();
vi.mock('../ai/core/tools.js', () => ({ llmJson: (...a) => llmJson(...a) }));

const { handler } = await import('../ai/agents/admission-scribe.js');

const run = (fake) => {
  llmJson.mockResolvedValueOnce(fake);
  return handler({ text: 'diktant matni' });
};

beforeEach(() => llmJson.mockReset());

describe('admission-scribe — formaga moslashtirish', () => {
  it('ismni bosh harflar bilan yozadi', async () => {
    const r = await run({ patient_name: 'qurbonov shohista' });
    expect(r.fields.patient_name).toBe('Qurbonov Shohista');
  });

  it('BOSH HARF bilan yozilgan ismni ham to\'g\'rilaydi', async () => {
    const r = await run({ patient_name: 'QURBONOV  SHOHISTA' });
    expect(r.fields.patient_name).toBe('Qurbonov Shohista');
  });

  it('parhez stolini dropdown qiymatiga keltiradi', async () => {
    for (const [given, want] of [['1-stol', '1'], ['№ 5', '5'], ['5a', '5a'],
                                 ['10-stol', '10'], ['birinchi', '']]) {
      const r = await run({ diet_number: given });
      expect(r.fields.diet_number, `"${given}"`).toBe(want);
    }
  });

  it('ro\'yxatda yo\'q parhezni bo\'sh qoldiradi (noto\'g\'ri tanlov xavfli)', async () => {
    const r = await run({ diet_number: '99' });
    expect(r.fields.diet_number).toBe('');
  });

  it('"birinchi stol" klinika maydoniga tushib qolsa — parhezga ko\'chiradi', async () => {
    // Production'da aynan shunday bo'lgan: model parhezni "yo'llagan
    // muassasa" deb tushunib, referring_clinic ga yozgan.
    const r = await run({ referring_clinic: '1-stol', diet_number: '' });
    expect(r.fields.diet_number).toBe('1');
    expect(r.fields.referring_clinic).toBe('');
  });

  it('haqiqiy klinika nomiga tegmaydi', async () => {
    const r = await run({ referring_clinic: 'Termiz shahar poliklinikasi' });
    expect(r.fields.referring_clinic).toBe('Termiz shahar poliklinikasi');
  });

  it('takrorlangan jumlalarni maydonlar bo\'ylab olib tashlaydi', async () => {
    const r = await run({
      complaints: "Qorin og'rig'i bor. Ko'ngil aynishi.",
      anamnesis:  "Qorin og'rig'i bor. Uch kundan beri davom etmoqda.",
      notes:      "Ko'ngil aynishi. Uch kundan beri davom etmoqda.",
    });
    expect(r.fields.complaints).toBe("Qorin og'rig'i bor. Ko'ngil aynishi.");
    expect(r.fields.anamnesis).toBe('Uch kundan beri davom etmoqda.');
    expect(r.fields.notes).toBe('');   // hammasi allaqachon aytilgan
  });

  it('registr va tinish belgisi farqi takrorni yashirmasin', async () => {
    const r = await run({
      complaints: "Qorin og'rig'i bor.",
      notes:      "qorin og'rig'i bor",
    });
    expect(r.fields.notes).toBe('');
  });

  it('yotqizish turini faqat ruxsat etilgan qiymatga keltiradi', async () => {
    expect((await run({ admission_type: 'Shoshilinch' })).fields.admission_type)
      .toBe('shoshilinch');
    // 'planli' formada YO'Q — bo'sh qolishi kerak, aks holda select buziladi
    expect((await run({ admission_type: 'planli' })).fields.admission_type).toBe('');
  });

  it('shoshilinch/tez yordam bo\'lsa urgent belgisini qo\'yadi', async () => {
    expect((await run({ admission_type: 'tez_yordam' })).fields.urgent_admission).toBe(true);
    expect((await run({ admission_type: 'rejali' })).fields.urgent_admission).toBe(false);
  });

  it('sonlarni son sifatida qaytaradi, aralash matndan ham', async () => {
    const r = await run({ weight_kg: '68', height_cm: '172 sm', temperature_on_admission: '37,8' });
    expect(r.fields.weight_kg).toBe(68);
    expect(r.fields.height_cm).toBe(172);
    expect(r.fields.temperature_on_admission).toBe(37.8);
  });

  it('son aytilmagan bo\'lsa null — nol EMAS', async () => {
    // 0 kg vazn "ma'lumot yo'q" degani emas — bu xato ma'lumot bo'lardi
    const r = await run({ weight_kg: '', height_cm: null });
    expect(r.fields.weight_kg).toBeNull();
    expect(r.fields.height_cm).toBeNull();
  });

  it('LLM javob bermasa diktant matni saqlanadi', async () => {
    llmJson.mockResolvedValueOnce(null);
    const r = await handler({ text: 'xom diktant' });
    expect(r.structured).toBe(false);
    expect(r.raw_text).toBe('xom diktant');
    expect(r.note).toMatch(/qo'lda/);
  });
});
