/**
 * Zona qoidalariga presence_required turi (roadmap: zona-faollik).
 *
 * 039'da vision_zone_rules.rule_type CHECK faqat after_hours va
 * restricted edi. Yangi tur — presence_required: "smenada bu xodim
 * shu zonada bo'lishi kutiladi" (masalan, qabulxona). Buzilish =
 * SIGNAL (rahbar ko'radi), jazo emas — boshqa qoidalar kabi.
 */

export async function up(knex) {
  // Eski CHECK'ni olib tashlab, kengaytirilganini qo'yamiz
  await knex.raw(`
    ALTER TABLE vision_zone_rules
      DROP CONSTRAINT IF EXISTS vision_zone_rules_rule_type_check
  `);
  await knex.raw(`
    ALTER TABLE vision_zone_rules
      ADD CONSTRAINT vision_zone_rules_rule_type_check
      CHECK (rule_type IN ('after_hours', 'restricted', 'presence_required'))
  `);
}

export async function down(knex) {
  // Orqaga: presence_required qoidalarni o'chirib, eski CHECK'ni qaytaramiz
  await knex.raw(`DELETE FROM vision_zone_rules WHERE rule_type = 'presence_required'`);
  await knex.raw(`
    ALTER TABLE vision_zone_rules
      DROP CONSTRAINT IF EXISTS vision_zone_rules_rule_type_check
  `);
  await knex.raw(`
    ALTER TABLE vision_zone_rules
      ADD CONSTRAINT vision_zone_rules_rule_type_check
      CHECK (rule_type IN ('after_hours', 'restricted'))
  `);
}
