// ============================================================
// "Shifokor qabuli" katalogi — uchala kanalning YAGONA manbai.
//
// NEGA TEST: kiosk, registratura va Telegram shu bitta funksiyaga
// tayanadi. Undagi xato bir vaqtning o'zida uchala kanalda chiqadi va
// bemor yozila olmay qoladi. Ayniqsa "yozib bo'lmaydigan shifokorni
// ko'rsatmaslik" qoidasi muhim: u buzilsa bemor shifokorni tanlab,
// "bo'sh vaqt yo'q" devoriga uriladi va registraturaga qo'ng'iroq qiladi.
// ============================================================
import { describe, it, expect } from 'vitest';
import { listConsultations, specialtyLabel } from '../backend/services/consultation-catalog.js';

/** Haqiqiy pg.Pool o'rniga — so'rov matniga qarab tayyor javob qaytaradi */
function fakePool({ services = [], doctors = [] } = {}) {
  return {
    async query(sql) {
      if (/FROM services_catalog/i.test(sql)) return { rows: services };
      if (/FROM doctors/i.test(sql)) return { rows: doctors };
      throw new Error('Kutilmagan so\'rov: ' + sql.slice(0, 60));
    },
  };
}

const svc = (o) => ({
  id: 's1', name: 'Qabul', specialty: 'urolog', price: 80000,
  duration_min: 20, icon: null, ...o,
});
const doc = (o) => ({
  id: 'd1', first_name: 'Ali', last_name: 'Valiyev',
  specialty: 'urolog', has_schedule: true, ...o,
});

describe('listConsultations', () => {
  it('tenant berilmasa bo\'sh qaytaradi (boshqa klinika ma\'lumoti sizmasin)', async () => {
    const r = await listConsultations(fakePool(), null);
    expect(r.specialties).toEqual([]);
    expect(r.missing_setup).toEqual([]);
  });

  it('shifokorlarni yo\'nalish bo\'yicha guruhlaydi va nomini chiroyli beradi', async () => {
    const r = await listConsultations(fakePool({
      services: [svc({ id: 'sv-u', specialty: 'urolog' })],
      doctors: [
        doc({ id: 'd1', first_name: 'Ali', last_name: 'Valiyev' }),
        doc({ id: 'd2', first_name: 'Vali', last_name: 'Aliyev' }),
      ],
    }), 't1');

    expect(r.specialties).toHaveLength(1);
    expect(r.specialties[0].key).toBe('urolog');
    expect(r.specialties[0].label).toBe('Urolog');
    expect(r.specialties[0].doctors.map((d) => d.name))
      .toEqual(['Valiyev Ali', 'Aliyev Vali']);
  });

  it('qabul xizmati yo\'q yo\'nalish bemorga KO\'RSATILMAYDI', async () => {
    const r = await listConsultations(fakePool({
      services: [svc({ specialty: 'urolog' })],
      doctors: [doc({ id: 'd9', specialty: 'xirurg' })],   // xirurg qabuli yo'q
    }), 't1');

    expect(r.specialties.map((s) => s.key)).toEqual([]);
    expect(r.missing_setup).toHaveLength(1);
    expect(r.missing_setup[0].reason).toBe('qabul_xizmati_yoq');
  });

  it('ish jadvali yo\'q shifokor KO\'RSATILMAYDI (yozib bo\'lmaydi)', async () => {
    const r = await listConsultations(fakePool({
      services: [svc({ specialty: 'urolog' })],
      doctors: [
        doc({ id: 'd1', has_schedule: true }),
        doc({ id: 'd2', first_name: 'Bek', has_schedule: false }),
      ],
    }), 't1');

    expect(r.specialties[0].doctors.map((d) => d.id)).toEqual(['d1']);
    expect(r.missing_setup[0].doctor_id).toBe('d2');
    expect(r.missing_setup[0].reason).toBe('ish_jadvali_yoq');
  });

  it('from_price — eng arzon qabul narxi', async () => {
    const r = await listConsultations(fakePool({
      services: [
        svc({ id: 'a', name: '1-qabul', price: 200000 }),
        svc({ id: 'b', name: 'Qayta qabul', price: 100000 }),
      ],
      doctors: [doc()],
    }), 't1');

    expect(r.specialties[0].from_price).toBe(100000);
    expect(r.specialties[0].services).toHaveLength(2);
  });

  it('bir odam bir nechta yo\'nalishda bo\'lsa HAR IKKALASIDA chiqadi', async () => {
    // Bazadagi qoida: har ixtisosga alohida `doctors` yozuvi. Bemor
    // "urologga yozilaman" yoki "xirurgga yozilaman" deb tanlaydi —
    // shuning uchun bu yerda bittaga tushirish NOTO'G'RI bo'lardi.
    const r = await listConsultations(fakePool({
      services: [
        svc({ id: 'sv-u', specialty: 'urolog' }),
        svc({ id: 'sv-x', specialty: 'xirurg' }),
      ],
      doctors: [
        doc({ id: 'd1', specialty: 'urolog', first_name: 'Behruz', last_name: 'Tursunpulatov' }),
        doc({ id: 'd2', specialty: 'xirurg', first_name: 'Behruz', last_name: 'Tursunpulatov' }),
      ],
    }), 't1');

    expect(r.specialties).toHaveLength(2);
    expect(r.specialties.flatMap((s) => s.doctors.map((d) => d.name)))
      .toEqual(['Tursunpulatov Behruz', 'Tursunpulatov Behruz']);
  });

  it('yo\'nalishlar barqaror (alifbo) tartibda — har kanalda bir xil chiqishi uchun', async () => {
    const r = await listConsultations(fakePool({
      services: [
        svc({ id: 'a', specialty: 'xirurg' }),
        svc({ id: 'b', specialty: 'ginekolog' }),
        svc({ id: 'c', specialty: 'urolog' }),
      ],
      doctors: [
        doc({ id: 'd1', specialty: 'xirurg' }),
        doc({ id: 'd2', specialty: 'ginekolog' }),
        doc({ id: 'd3', specialty: 'urolog' }),
      ],
    }), 't1');

    expect(r.specialties.map((s) => s.label)).toEqual(['Ginekolog', 'Urolog', 'Xirurg']);
  });
});

describe('specialtyLabel', () => {
  it('ma\'lum kalitlarni tarjima qiladi', () => {
    expect(specialtyLabel('reproduktolog')).toBe('Reproduktolog');
    expect(specialtyLabel('LOR')).toBe('LOR (quloq-burun-tomoq)');
  });

  it('noma\'lum kalitni ham o\'qish mumkin qiladi (xom kalit chiqmasin)', () => {
    expect(specialtyLabel('allergolog')).toBe('Allergolog');
    expect(specialtyLabel('')).toBe('Shifokor');
    expect(specialtyLabel(null)).toBe('Shifokor');
  });
});
