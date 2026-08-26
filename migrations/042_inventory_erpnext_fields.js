/**
 * Ombor — ERPNext ko'prik ustunlari (roadmap PR #11).
 *
 * inventory_items va inventory_transactions bigIncrements (bigint)
 * ID'ga ega — external_ids (uuid local_id) ularga sig'maydi
 * (staff_members'dagi holat kabi). Shu sababli ID ko'prigi to'g'ridan-
 * to'g'ri ustunlarda saqlanadi:
 *
 *   inventory_items.erpnext_item_code       — ERPNext Item doc name
 *   inventory_transactions.erpnext_entry    — ERPNext Stock Entry name
 *
 * Ikkala ustun ham nullable — ERPNext o'chiq bo'lsa hech narsa o'zgarmaydi.
 */

export async function up(knex) {
  const addIfMissing = async (table, col, ddl) => {
    const exists = await knex.raw(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = ? AND column_name = ?`,
      [table, col]
    );
    if (!exists.rows.length) await knex.raw(ddl);
  };

  await addIfMissing('inventory_items', 'erpnext_item_code',
    'ALTER TABLE inventory_items ADD COLUMN erpnext_item_code varchar(140)');
  await addIfMissing('inventory_transactions', 'erpnext_entry',
    'ALTER TABLE inventory_transactions ADD COLUMN erpnext_entry varchar(140)');
}

export async function down(knex) {
  await knex.raw('ALTER TABLE inventory_transactions DROP COLUMN IF EXISTS erpnext_entry');
  await knex.raw('ALTER TABLE inventory_items DROP COLUMN IF EXISTS erpnext_item_code');
}
