export async function up(knex) {
  await knex.schema.table('tenants', (t) => {
    t.string('email', 255);
  });
}

export async function down(knex) {
  await knex.schema.table('tenants', (t) => {
    t.dropColumn('email');
  });
}
