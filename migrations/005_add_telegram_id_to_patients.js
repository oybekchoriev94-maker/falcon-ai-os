export async function up(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.string('telegram_id', 100).unique();
  });
}

export async function down(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('telegram_id');
  });
}
