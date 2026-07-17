export async function up(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.string('middle_name', 100);
    t.string('region', 100);
    t.string('district', 100);
    t.text('address');
    t.string('passport_number', 20);
    t.string('gender', 10);
    t.string('benefit_category', 100);
    t.string('department', 100);
    t.string('order_number', 50);
    t.string('medical_record_number', 50);
    t.text('notes');
    t.string('payment_type', 50).defaultTo('kassa');
  });
}

export async function down(knex) {
  await knex.schema.alterTable('patients', (t) => {
    t.dropColumn('middle_name');
    t.dropColumn('region');
    t.dropColumn('district');
    t.dropColumn('address');
    t.dropColumn('passport_number');
    t.dropColumn('gender');
    t.dropColumn('benefit_category');
    t.dropColumn('department');
    t.dropColumn('order_number');
    t.dropColumn('medical_record_number');
    t.dropColumn('notes');
    t.dropColumn('payment_type');
  });
}
