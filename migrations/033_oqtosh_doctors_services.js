/**
 * Oqtosh Klinikasi — shifokorlar, xizmatlar va ish jadvali.
 *
 * NEGA MIGRATSIYA: bu ma'lumot bemor yozilishining UCHALA kanaliga
 * (kiosk, registratura, Telegram) birdan kerak. Qo'lda kiritilsa
 * narx/ixtisos nomlari har joyda boshqacha yozilib ketadi.
 *
 * TUZILISH QOIDASI: bir shifokor bir nechta ixtisosda ishlasa, u
 * uchun HAR IXTISOSGA ALOHIDA yozuv ochiladi (bazadagi mavjud qoida —
 * frontend `dedupeByPerson` ularni bemorga bitta qilib ko'rsatadi).
 * Shuning uchun urolog+xirurg shifokorlarda 2 tadan yozuv bo'ladi.
 *
 * IDEMPOTENT: qayta ishga tushirilsa dublikat yaratmaydi — mavjud
 * yozuvni ismi bo'yicha topib yangilaydi.
 *
 * BOSHQA BAZALARDA: tenant "Oqtosh Klinikasi" topilmasa, migratsiya
 * hech narsa qilmaydi (boshqa klinikaning bazasiga bu ma'lumot tushmaydi).
 */

const SERVICES = [
  { name: 'Reproduktolog — 1-qabul',    price: 200000, specialty: 'reproduktolog', duration_min: 30 },
  { name: 'Reproduktolog — qayta qabul', price: 100000, specialty: 'reproduktolog', duration_min: 20 },
  { name: 'Shifokor ko\'rigi',           price:  80000, specialty: 'reproduktolog', duration_min: 20 },
  { name: 'Urolog qabuli',               price:  80000, specialty: 'urolog',        duration_min: 20 },
  { name: 'Xirurg qabuli',               price:  80000, specialty: 'xirurg',        duration_min: 20 },
];

// Har bir shifokor: [ism, familiya, [ixtisoslar]]
const DOCTORS = [
  ['Xoltoji',  'Qurbonov',      ['reproduktolog']],
  ['Islom',    'Tursunpulatov', ['reproduktolog']],
  ['Zamira',   'Bobokulova',    ['reproduktolog']],
  ['Faroxat',  'Aramova',       ['reproduktolog']],
  ['Dilshoda', 'Chorieva',      ['reproduktolog']],
  ['Dildora',  'Jo\'rayeva',    ['reproduktolog']],
  ['Nargiza',  'Eshboriyeva',   ['reproduktolog']],
  ['Behruz',   'Tursunpulatov', ['urolog', 'xirurg']],
  ['Akmal',    'Mirzayev',      ['urolog', 'xirurg']],
  // Bazada allaqachon "Tursunpo'latov" imlosida 2 ta yozuv bor —
  // shu imloni saqlaymiz, aks holda uchinchi dublikat paydo bo'ladi.
  ['Jamshid',  'Tursunpo\'latov', ['urolog', 'xirurg']],
];

const WORK_DAYS = [1, 2, 3, 4, 5, 6];   // Dush–Shan (0 = Yakshanba, dam)
const START_TIME = '08:00';
const END_TIME = '17:00';
const SLOT_MIN = 30;

/** Imlo farqlarini yo'qotib solishtirish uchun (apostrof turlari, registr) */
const norm = (s) => String(s || '').toLowerCase().replace(/['''`]/g, "'").trim();

export async function up(knex) {
  const tenant = await knex('tenants').where('name', 'Oqtosh Klinikasi').first('id');
  if (!tenant) {
    console.log('[033] "Oqtosh Klinikasi" tenant topilmadi — o\'tkazib yuborildi');
    return;
  }
  const tenantId = tenant.id;

  // ── Xizmatlar ──
  for (const s of SERVICES) {
    const existing = await knex('services_catalog')
      .where({ tenant_id: tenantId })
      .whereRaw('lower(name) = ?', [s.name.toLowerCase()])
      .first('id');

    if (existing) {
      await knex('services_catalog').where('id', existing.id).update({
        price: s.price, specialty: s.specialty, duration_min: s.duration_min,
        category: 'Qabul', active: true,
      });
    } else {
      await knex('services_catalog').insert({
        id: knex.raw('gen_random_uuid()'),
        tenant_id: tenantId, name: s.name, category: 'Qabul',
        specialty: s.specialty, price: s.price, duration_min: s.duration_min, active: true,
      });
    }
  }

  // ── Shifokorlar ──
  // Mavjudlarni ismi bo'yicha topamiz. Bir odamda bir nechta ixtisos
  // bo'lsa, ixtisossiz (yoki 'doctor' default) yozuvlar navbat bilan
  // to'ldiriladi; yetmasa yangisi ochiladi.
  const existingDocs = await knex('doctors').where({ tenant_id: tenantId })
    .select('id', 'first_name', 'last_name', 'specialization');

  const doctorIds = [];

  for (const [firstName, lastName, specializations] of DOCTORS) {
    const samePerson = existingDocs.filter(
      (d) => norm(d.first_name) === norm(firstName) && norm(d.last_name) === norm(lastName)
    );
    const unclaimed = samePerson.filter((d) => !specializations.includes(d.specialization));

    for (const spec of specializations) {
      // 1) Shu ixtisosdagi yozuv allaqachon bormi?
      let row = samePerson.find((d) => d.specialization === spec);

      if (!row && unclaimed.length) {
        // 2) Ixtisosi belgilanmagan mavjud yozuvni qayta ishlatamiz
        row = unclaimed.shift();
        await knex('doctors').where('id', row.id).update({
          specialization: spec, specialty: spec, status: 'Faol',
        });
      } else if (!row) {
        // 3) Yangi yozuv
        const [inserted] = await knex('doctors').insert({
          id: knex.raw('gen_random_uuid()'),
          tenant_id: tenantId, first_name: firstName, last_name: lastName,
          specialization: spec, specialty: spec, status: 'Faol',
        }).returning('id');
        row = { id: inserted.id || inserted };
      } else {
        // Mavjud — `specialty` ustunida ilgari ISM yozilgan edi, tuzatamiz
        await knex('doctors').where('id', row.id).update({ specialty: spec, status: 'Faol' });
      }
      doctorIds.push(row.id);
    }
  }

  // ── Ish jadvali ──
  // Jadval bo'lmasa bo'sh vaqtlar UMUMAN chiqmaydi ("Bu kunga jadval yo'q")
  // va bemor yozila olmaydi — shuning uchun bu qadam majburiy.
  for (const doctorId of doctorIds) {
    for (const dow of WORK_DAYS) {
      await knex('doctor_schedules')
        .insert({
          tenant_id: tenantId, doctor_id: doctorId, day_of_week: dow,
          start_time: START_TIME, end_time: END_TIME, slot_duration: SLOT_MIN,
        })
        .onConflict(['tenant_id', 'doctor_id', 'day_of_week'])
        .merge({ start_time: START_TIME, end_time: END_TIME, slot_duration: SLOT_MIN });
    }
  }

  console.log(`[033] Oqtosh: ${SERVICES.length} xizmat, ${doctorIds.length} shifokor yozuvi, jadval ${START_TIME}–${END_TIME}`);
}

export async function down(knex) {
  const tenant = await knex('tenants').where('name', 'Oqtosh Klinikasi').first('id');
  if (!tenant) return;
  // Faqat shu migratsiya qo'shgan xizmatlarni o'chiramiz. Shifokorlarga
  // TEGMAYMIZ: ularga bronlar bog'langan bo'lishi mumkin.
  await knex('services_catalog')
    .where({ tenant_id: tenant.id })
    .whereIn('name', SERVICES.map((s) => s.name))
    .delete();
}
