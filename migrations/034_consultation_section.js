/**
 * "Shifokor qabuli" — alohida bo'lim sifatida.
 *
 * MUAMMO: shu paytgacha tizimda "shifokor qabuli" degan tushuncha YO'Q edi —
 * u oddiy xizmat qatorida `services_catalog` da yotardi. Natijada kiosk
 * xizmatdan boshlaydigan oqim qurgan (avval tekshiruv, keyin uni bajaradigan
 * shifokor), va "shifokorga yozilaman" degan bemor uchun alohida yo'l
 * umuman ko'rinmasdi. Registratura va Telegram'da ham qabul boshqa
 * xizmatlardan farq qilmasdi.
 *
 * YECHIM: qabul xizmatini ANIQ belgilaymiz — `is_consultation` ustuni.
 *
 * NEGA KATEGORIYA NOMI YETARLI EMAS: `category` erkin matn (klinika
 * o'zgartira oladi, imlo har xil: "Qabul", "Shifokor qabuli",
 * "Konsultatsiya"). Uchala kanal shu matnni solishtirsa, biri ishlaydi
 * ikkinchisi ishlamaydi — aynan "hamma joyda bir hil" talabi buziladi.
 * Boolean ustun — bitta haqiqat manbai, indekslanadi, imloga bog'liq emas.
 *
 * KO'P IJARACHI XAVFSIZLIGI: boshqa klinikalarga YANGI xizmat qo'shmaymiz.
 * Faqat mavjudlarini belgilaymiz. Aks holda ularning katalogida narxi 0
 * bo'lgan "qabul" paydo bo'lib, bemor tekinga yozilib ketishi mumkin edi.
 */

/** Qabul xizmatini tanish qoidasi — bir joyda, ikkala yo'nalish uchun */
const CONSULTATION_MATCH = `(
     category IN ('Shifokor qabuli', 'Qabul', 'Konsultatsiya', 'Konsultatsiyalar')
  OR name ILIKE '%qabuli%'
  OR name ILIKE '%ko''rigi%'
)`;

export async function up(knex) {
  const hasCol = await knex.schema.hasColumn('services_catalog', 'is_consultation');
  if (!hasCol) {
    await knex.schema.alterTable('services_catalog', (t) => {
      t.boolean('is_consultation').notNullable().defaultTo(false);
    });
    // Kanallar har safar "qabul xizmatlari"ni so'raydi — indeks shart.
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS services_consultation_idx
         ON services_catalog (tenant_id, is_consultation)
         WHERE is_consultation = true`
    );
  }

  // ── Mavjud qabul xizmatlarini belgilash ──
  const marked = await knex.raw(
    `UPDATE services_catalog
        SET is_consultation = true,
            category = 'Shifokor qabuli'
      WHERE is_consultation = false
        AND ${CONSULTATION_MATCH}
      RETURNING id`
  );
  console.log(`[034] ${marked.rowCount ?? marked.rows?.length ?? 0} ta xizmat "Shifokor qabuli" deb belgilandi`);

  // ── Qabul xizmatining `specialty` si bo'sh qolmasin ──
  // Bo'lim bo'yicha guruhlash aynan shu ustunga tayanadi; NULL bo'lsa
  // shifokor hech qaysi guruhga tushmaydi va bemor uni ko'rmaydi.
  await knex.raw(
    `UPDATE services_catalog s
        SET specialty = 'doctor'
      WHERE s.is_consultation = true
        AND (s.specialty IS NULL OR s.specialty = '')`
  );
}

export async function down(knex) {
  const hasCol = await knex.schema.hasColumn('services_catalog', 'is_consultation');
  if (!hasCol) return;
  await knex.raw('DROP INDEX IF EXISTS services_consultation_idx');
  await knex.schema.alterTable('services_catalog', (t) => {
    t.dropColumn('is_consultation');
  });
  // `category` ni qaytarmaymiz: eski qiymat saqlanmagan va 'Shifokor qabuli'
  // baribir to'g'ri nom. Xizmatlarni O'CHIRMAYMIZ — ularga bronlar bog'langan.
}
