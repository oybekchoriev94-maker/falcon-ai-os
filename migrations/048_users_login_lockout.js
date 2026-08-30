/**
 * `users` jadvaliga hisob bloklash maydonlari.
 *
 * MUAMMO: shifokorlar (doctors) uchun 5 ta xato urinishdan keyin 15
 * daqiqaga bloklash ALLAQACHON bor edi, `users` (ceo/admin/registrator/
 * kassir) uchun esa YO'Q. Ya'ni eng ko'p huquqli hisoblar — jumladan
 * `ceo` — cheksiz parol tanlashga ochiq edi.
 *
 * HTTP darajasidagi cheklov (authLimiter, login nomi bo'yicha 15
 * daqiqada 10 urinish) himoya beradi, lekin u XOTIRADA saqlanadi va
 * konteyner qayta ishga tushganda nolga tushadi. Bazadagi hisoblagich
 * esa deploydan keyin ham saqlanadi.
 */

async function hasColumn(knex, table, column) {
  const { rows } = await knex.raw(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = ? AND column_name = ?`,
    [table, column]
  );
  return rows.length > 0;
}

export async function up(knex) {
  if (!(await knex.schema.hasTable('users'))) return;

  if (!(await hasColumn(knex, 'users', 'failed_attempts'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0');
    console.log('[048] users.failed_attempts qo\'shildi');
  }
  if (!(await hasColumn(knex, 'users', 'locked_until'))) {
    await knex.raw('ALTER TABLE users ADD COLUMN locked_until timestamptz');
    console.log('[048] users.locked_until qo\'shildi — hisob bloklash yoqildi');
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('users'))) return;
  await knex.raw('ALTER TABLE users DROP COLUMN IF EXISTS locked_until');
  await knex.raw('ALTER TABLE users DROP COLUMN IF EXISTS failed_attempts');
}
