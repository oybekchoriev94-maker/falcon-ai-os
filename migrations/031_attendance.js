/**
 * Xodimlar davomati — yuz tanish orqali keldi/ketdi.
 *
 * ARXITEKTURA QARORI: yuz shablonlari (embedding) bu yerga YOZILMAYDI.
 * Ular klinika kompyuterida qoladi. VPS'ga faqat hodisa keladi:
 * "Aliyev Vali 08:32 da keldi". Sabablari:
 *
 *  1) Huquqiy — biometrik ma'lumot alohida toifa va O'zbekiston
 *     fuqarolarining shaxsiy ma'lumotlari mamlakat hududidagi serverda
 *     saqlanishi shart. Bizning VPS Germaniyada.
 *  2) Trafik — video oqimini markazga yuborish oyiga ~415 GB/kamera.
 *     Hodisalar esa kuniga ~20 KB.
 *  3) Uzilishga chidamlilik — internet yo'q bo'lsa agent lokal ishlaydi
 *     va hodisalarni navbatga yig'adi.
 *
 * Qurilma autentifikatsiyasi uchun MAVJUD kiosk_devices jadvali
 * ishlatiladi — yangi 'attendance' turi qo'shiladi. Shu bilan token
 * yaratish, bloklash va admin UI qayta yozilmaydi.
 */
export async function up(knex) {
  // kiosk_devices.kind — matn ustuni, DB darajasida cheklov yo'q,
  // shuning uchun jadval o'zgartirilmaydi. Yangi qiymat ('attendance')
  // faqat backend validatsiyasida ochiladi.

  const has = await knex.schema.hasTable('attendance_events');
  if (!has) {
    await knex.schema.createTable('attendance_events', (t) => {
      t.bigIncrements('id');
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');

      // Ism — klinika kompyuteridagi faces/ papkasidagi nom bilan bir xil.
      // Shifokor/foydalanuvchi bilan bog'lash ixtiyoriy: davomat tizimga
      // kiritilmagan xodimlar (hamshira, farrosh) uchun ham ishlashi kerak.
      t.text('person_name').notNullable();
      t.uuid('doctor_id').references('id').inTable('doctors').onDelete('SET NULL');

      // 'in' | 'out'
      t.string('direction', 8).notNullable();
      t.timestamp('occurred_at').notNullable();

      // Qaysi qurilmadan keldi (audit uchun)
      t.uuid('device_id').references('id').inTable('kiosk_devices').onDelete('SET NULL');
      // 'face' | 'manual' — kelajakda qo'lda tuzatish uchun
      t.string('source', 16).notNullable().defaultTo('face');
      // Tanish ishonchi (0..1) — past bo'lsa qo'lda tekshirish mumkin
      t.float('confidence');

      t.timestamp('created_at').defaultTo(knex.fn.now());

      t.index(['tenant_id', 'occurred_at']);
      t.index(['tenant_id', 'person_name', 'occurred_at']);
    });

    // Takroriylikka qarshi. Agent qayta yuborishi mumkin (internet uzilib,
    // navbat qayta jo'natilganda) yoki ikki kamera bir odamni ko'rishi
    // mumkin. Bir xil odam + yo'nalish + AYNI SONIYA = bitta yozuv.
    // Kengroq oyna (bir necha daqiqa) kod tomonida tekshiriladi —
    // indeks faqat aniq nusxalarni to'sadi.
    await knex.raw(`
      CREATE UNIQUE INDEX attendance_events_dedup
      ON attendance_events (tenant_id, person_name, direction, occurred_at)
    `);
  }
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS attendance_events_dedup');
  await knex.schema.dropTableIfExists('attendance_events');
}
