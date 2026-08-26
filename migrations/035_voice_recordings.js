/**
 * Ovozli diktantlarni SAQLASH — "hech bir diktovka yo'qolmasin".
 *
 * MUAMMO: shu paytgacha audio HECH QAYERDA saqlanmasdi. Barcha 7 ta
 * endpoint `transcribe(req.file.buffer, ...)` deb chaqirar va bufer
 * shundan keyin yo'qolardi. Ya'ni STT yiqilsa, LLM xato bersa, tarmoq
 * uzilsa yoki konteyner qayta ishga tushsa — shifokorning diktanti
 * BUTUNLAY yo'qolardi va u ko'rikni eslab, qaytadan gapirishi kerak
 * edi. Bemor oldida bu qabul qilib bo'lmaydigan holat.
 *
 * YECHIM: audio transkripsiyadan OLDIN diskka yoziladi va shu jadvalga
 * qayd etiladi. Natija muvaffaqiyatli bo'lsa `transcribed` deb
 * belgilanadi; xato bo'lsa yozuv `failed` bo'lib QOLADI va uni qayta
 * ishlash yoki qo'lda tinglash mumkin.
 *
 * MAXFIYLIK: fayllar `public/` ostida EMAS (u statik tarqatiladi —
 * bemor ovozi internetga ochilib qolardi). Alohida `voice-recordings`
 * papkasi, faqat backend o'qiydi.
 *
 * SAQLASH MUDDATI: audio — vaqtinchalik nusxa, doimiy arxiv emas.
 * Eskilari cron orqali o'chiriladi (transkripsiya matni jadvalda
 * qoladi). Bu diskni ham, maxfiylik xavfini ham cheklaydi.
 */

export async function up(knex) {
  const exists = await knex.schema.hasTable('voice_recordings');
  if (exists) return;

  await knex.schema.createTable('voice_recordings', (t) => {
    t.uuid('id').primary();
    t.text('tenant_id').notNullable()
      .references('id').inTable('tenants').onDelete('CASCADE');

    // Kim diktant qildi (shifokor/registrator). Foydalanuvchi o'chirilsa
    // yozuv qolishi kerak — audit uchun, shuning uchun SET NULL.
    t.uuid('user_id').nullable();

    // Qaysi oqimdan keldi: doctor_visit | reception_register | obhod |
    // scribe | admission. Erkin matn — yangi oqim qo'shilsa migratsiya
    // talab qilmaydi.
    t.string('source', 40).notNullable();

    // Bog'liq yozuv identifikatori (appointment.id, admission.id, ...).
    // Turli jadvallarga ishora qilgani uchun FK emas.
    t.text('ref_id').nullable();
    t.uuid('patient_id').nullable();

    // Diskdagi yo'l — VOICE_DIR ga nisbatan (absolut emas: konteyner
    // yo'li o'zgarsa yozuvlar yaroqsiz bo'lib qolmasin).
    t.text('file_path').notNullable();
    t.string('mime', 60).nullable();
    t.integer('size_bytes').nullable();
    t.string('language', 5).nullable();

    // pending — yozildi, hali transkripsiya qilinmadi
    // transcribed — muvaffaqiyatli
    // failed — STT yoki LLM xato berdi (audio qayta ishlash uchun turadi)
    // purged — audio o'chirildi (muddati tugadi), matn qoldi
    t.string('status', 20).notNullable().defaultTo('pending');
    t.text('transcript').nullable();
    t.text('error').nullable();

    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('transcribed_at').nullable();

    t.index(['tenant_id', 'status']);
    t.index(['tenant_id', 'created_at']);
  });

  // Muvaffaqiyatsiz diktantlarni tez topish uchun (qayta ishlash ro'yxati).
  // Partial indeks — jadvalning katta qismi 'transcribed' bo'ladi.
  await knex.raw(
    `CREATE INDEX IF NOT EXISTS voice_recordings_failed_idx
       ON voice_recordings (tenant_id, created_at DESC)
       WHERE status = 'failed'`
  );
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS voice_recordings_failed_idx');
  await knex.schema.dropTableIfExists('voice_recordings');
}
