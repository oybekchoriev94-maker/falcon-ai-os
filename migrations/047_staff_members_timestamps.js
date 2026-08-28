/**
 * staff_members jadvaliga created_at / updated_at qo'shadi.
 *
 * MUAMMO: backend/routes/hrms.js xodimni tahrirlaganda `updated_at = now()`
 * yozadi (161 va 209-qatorlar), lekin bu ustun jadvalda YO'Q edi.
 * staff_members 001-migratsiyada yaratilgan (telegram bot uchun, atigi
 * 6 ta ustun bilan), 041 esa HRMS maydonlarini qo'shganda vaqt
 * belgilarini o'tkazib yuborgan.
 *
 * Natijada HRMS modulida xodimni tahrirlashning HAR BIR urinishi
 * `column "updated_at" does not exist` xatosi bilan 500 qaytarardi —
 * ya'ni modul umuman ishlamasdi.
 *
 * created_at ham qo'shiladi: u yo'qligi sababli xodim qachon
 * qo'shilganini bilib bo'lmasdi.
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
  if (!(await knex.schema.hasTable('staff_members'))) {
    console.log('[047] staff_members jadvali yo\'q — o\'tkazib yuborildi');
    return;
  }

  if (!(await hasColumn(knex, 'staff_members', 'created_at'))) {
    await knex.raw(
      `ALTER TABLE staff_members ADD COLUMN created_at timestamptz NOT NULL DEFAULT now()`
    );
    console.log('[047] staff_members.created_at qo\'shildi');
  }

  if (!(await hasColumn(knex, 'staff_members', 'updated_at'))) {
    await knex.raw(
      `ALTER TABLE staff_members ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()`
    );
    console.log('[047] staff_members.updated_at qo\'shildi — HRMS tahrirlash ishlaydi');
  }
}

export async function down(knex) {
  if (!(await knex.schema.hasTable('staff_members'))) return;
  // created_at ni QOLDIRAMIZ: u ma'lumot (xodim qachon qo'shilgani),
  // uni o'chirish tarixni yo'qotadi. updated_at esa faqat texnik maydon.
  await knex.raw('ALTER TABLE staff_members DROP COLUMN IF EXISTS updated_at');
}
