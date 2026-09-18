/**
 * Ombor: shtrix-kod (barcode/QR) maydoni.
 *
 * Nega kerak: dori qutisidagi shtrix-kodni skanerlab, qo'lda nom/SKU
 * yozmasdan tovarni topish yoki kirim qilish. Ikkala usul bir xil
 * maydonga yozadi:
 *   - USB skaner (klaviatura emulyatsiyasi) — maydonga o'zi "yozadi"
 *   - Telefon kamerasi — brauzerning BarcodeDetector API'si orqali
 *
 * UNIQUE faqat NULL bo'lmagan qiymatlarga (partial index): ko'p
 * tovarlarda shtrix-kod bo'lmasligi mumkin, ular bir-biriga xalaqit
 * qilmasin. Kod tenant ichida yagona — boshqa klinikada bir xil
 * dorining shtrix-kodi bo'lishi normal.
 */

export async function up(knex) {
  const has = await knex.schema.hasColumn('inventory_items', 'barcode');
  if (!has) {
    await knex.raw(`ALTER TABLE inventory_items ADD COLUMN barcode varchar(64)`);
    await knex.raw(`
      CREATE UNIQUE INDEX inventory_items_barcode_uq
        ON inventory_items (tenant_id, barcode)
        WHERE barcode IS NOT NULL
    `);
  }
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS inventory_items_barcode_uq');
  await knex.raw('ALTER TABLE inventory_items DROP COLUMN IF EXISTS barcode');
}
