// ============================================================
// "Shifokor qabuli" bo'limi — YAGONA MANBA.
//
// NEGA ALOHIDA FAYL: bemor uchta yo'l bilan yoziladi (kiosk,
// registratura, Telegram). Ro'yxatni har kanal o'zi yig'sa, biri
// nofaol shifokorni ko'rsatadi, ikkinchisi jadvalsizini, uchinchisi
// narxni boshqacha oladi — va "hamma joyda bir hil bo'lsin" talabi
// jimgina buziladi. Shuning uchun uchala kanal SHU funksiyani chaqiradi.
// ============================================================

/**
 * Yo'nalish nomlari. Bazada texnik kalit ('reproduktolog') turadi,
 * bemorga chiroyli nom kerak. Ilgari bu xarita faqat kiosk ichida
 * (booking-flow.tsx) bor edi — Telegram va registratura xom kalitni
 * ko'rsatardi. Endi bitta joyda.
 */
const SPECIALTY_LABEL = {
  reproduktolog: 'Reproduktolog',
  ginekolog:     'Ginekolog',
  urolog:        'Urolog',
  xirurg:        'Xirurg',
  terapevt:      'Terapevt',
  therapy:       'Terapevt',
  kardiolog:     'Kardiolog',
  nevropatolog:  'Nevropatolog',
  pediatr:       'Pediatr',
  lor:           'LOR (quloq-burun-tomoq)',
  oftalmolog:    'Oftalmolog',
  dermatolog:    'Dermatolog',
  endokrinolog:  'Endokrinolog',
  travmatolog:   'Travmatolog',
  stomatolog:    'Stomatolog',
  uzi:           'UZI mutaxassisi',
  laborant:      'Laborant',
  fizioterapevt: 'Fizioterapevt',
  rentgen:       'Rentgenolog',
  doctor:        'Umumiy amaliyot shifokori',
};

export function specialtyLabel(key) {
  const k = String(key || '').trim().toLowerCase();
  return SPECIALTY_LABEL[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : 'Shifokor');
}

const fullName = (d) => [d.last_name, d.first_name].filter(Boolean).join(' ').trim() || 'Shifokor';

/**
 * Klinikaning "Shifokor qabuli" bo'limi.
 *
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @returns {Promise<{ specialties: Array, missing_setup: Array }>}
 *
 * `specialties[]` — bemorga ko'rsatiladigan, TO'LIQ sozlangan yo'nalishlar.
 * `missing_setup[]` — shifokori bor, lekin yozib bo'lmaydigan yo'nalishlar
 *   (qabul xizmati yoki ish jadvali yo'q). Bemorga KO'RSATILMAYDI: aks holda
 *   u shifokorni tanlab, "bo'sh vaqt yo'q" devoriga urilardi. Admin panel
 *   shu ro'yxat orqali kamchilikni ko'radi.
 */
export async function listConsultations(pool, tenantId) {
  if (!tenantId) return { specialties: [], missing_setup: [] };

  // Qabul xizmatlari (034 migratsiyasidagi is_consultation bayrog'i bo'yicha)
  const services = (await pool.query(
    `SELECT id, name, COALESCE(specialty, 'doctor') AS specialty,
            price::float8 AS price, COALESCE(duration_min, 20) AS duration_min, icon
       FROM services_catalog
      WHERE tenant_id = $1 AND is_consultation = true AND active = true
      ORDER BY price ASC, name ASC`,
    [tenantId]
  )).rows;

  // Shifokorlar + ish jadvali bor-yo'qligi.
  // status: eski yozuvlarda NULL bo'lishi mumkin — booking.js bilan bir xil qoida.
  const doctors = (await pool.query(
    `SELECT d.id, d.first_name, d.last_name,
            COALESCE(NULLIF(d.specialization, ''), 'doctor') AS specialty,
            EXISTS(SELECT 1 FROM doctor_schedules ds
                    WHERE ds.tenant_id = d.tenant_id AND ds.doctor_id = d.id) AS has_schedule
       FROM doctors d
      WHERE d.tenant_id = $1
        AND (d.status IS NULL OR d.status = 'Faol')
      ORDER BY d.last_name ASC, d.first_name ASC`,
    [tenantId]
  )).rows;

  const svcBySpec = new Map();
  for (const s of services) {
    const k = s.specialty.toLowerCase();
    if (!svcBySpec.has(k)) svcBySpec.set(k, []);
    svcBySpec.get(k).push({
      id: s.id, name: s.name, price: s.price,
      duration_min: s.duration_min, icon: s.icon || null,
    });
  }

  const specialties = [];
  const missing_setup = [];
  const seen = new Set();

  for (const d of doctors) {
    const key = d.specialty.toLowerCase();
    const svc = svcBySpec.get(key) || [];
    const doc = { id: d.id, name: fullName(d), first_name: d.first_name, last_name: d.last_name };

    if (!svc.length || !d.has_schedule) {
      missing_setup.push({
        doctor_id: d.id, doctor: doc.name, specialty: key, label: specialtyLabel(key),
        reason: !svc.length ? 'qabul_xizmati_yoq' : 'ish_jadvali_yoq',
      });
      continue;
    }

    if (!seen.has(key)) {
      seen.add(key);
      specialties.push({
        key,
        label: specialtyLabel(key),
        // Eng arzon qabul narxi — kartochkada "80 000 so'mdan" deb ko'rsatish uchun
        from_price: Math.min(...svc.map((x) => x.price)),
        services: svc,
        doctors: [],
      });
    }
    specialties.find((x) => x.key === key).doctors.push(doc);
  }

  // Bemor uchun mantiqiy tartib: arzonroq/ko'proq shifokorli yuqorida emas —
  // alifbo bo'yicha, chunki u barqaror va har kanalda bir xil chiqadi.
  specialties.sort((a, b) => a.label.localeCompare(b.label, 'uz'));

  return { specialties, missing_setup };
}
