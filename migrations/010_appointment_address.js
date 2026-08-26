/**
 * A1: Bemorning yashash joyi.
 *
 * Klinikaga viloyat bo'ylab bemor keladi — qaysi tumandan kelayotganini bilish
 * ham qabulda kerak, ham statistika uchun (qaysi tumandan ko'p kelishadi).
 *
 * region  — viloyat (sukut bo'yicha Surxondaryo, keyin boshqa viloyatlar ham bo'lishi mumkin)
 * district— tuman/shahar (ro'yxatdan tanlanadi)
 * mahalla — mahalla nomi (erkin matn; takliflar klinikaning o'z yozuvlaridan yig'iladi,
 *           chunki respublika bo'yicha rasmiy mahalla ro'yxati tizimda yo'q)
 */
export async function up(knex) {
  await knex.schema.alterTable('appointments', (t) => {
    t.string('region', 60);
    t.string('district', 80);
    t.string('mahalla', 120);
    // Statistika: qaysi tumandan qancha bemor
    t.index(['tenant_id', 'district']);
    // Mahalla takliflari shu indeks orqali tez topiladi
    t.index(['tenant_id', 'district', 'mahalla']);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('appointments', (t) => {
    t.dropIndex(['tenant_id', 'district', 'mahalla']);
    t.dropIndex(['tenant_id', 'district']);
    t.dropColumn('mahalla');
    t.dropColumn('district');
    t.dropColumn('region');
  });
}
