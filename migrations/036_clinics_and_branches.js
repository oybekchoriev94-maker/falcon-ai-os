/**
 * Multi-klinika ma'lumot modeli (roadmap PR #4).
 *
 * Hozir tenant = bitta klinika deb qaraladi. Yo'l xaritasiga ko'ra har bir
 * tashkilot (tenant) ichida bir nechta klinika va filial bo'lishi mumkin:
 *
 *   tenant (1) -> clinics (N) -> branches (N)
 *
 * Ushbu migratsiya:
 *   1. clinics va branches jadvallarini yaratadi (tenant_id bilan, RLS ostida);
 *   2. asosiy operational jadvallarga ixtiyoriy branch_id qo'shadi — NULL
 *      "yagona filial" degani, mavjud yozuvlarni ko'chirish shart emas;
 *   3. har bir mavjud tenant uchun bitta default klinika + filial yaratadi;
 *   4. RLS siyosatini BARCHA tenant_id li jadvallarga qayta tatbiq etadi —
 *      008 migratsiyadan keyin yaratilgan jadvallar (attendance_events,
 *      voice_recordings va h.k.) siyosatsiz qolib ketgan edi.
 */
const POLICY_NAME = 'falcon_tenant_isolation';

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function tenantTables(knex) {
  const result = await knex.raw(`
    SELECT DISTINCT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name
  `);
  return result.rows;
}

async function applyTenantPolicy(knex, schema, table) {
  const qualifiedTable = `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
  const policyName = quoteIdentifier(POLICY_NAME);
  await knex.raw(`ALTER TABLE ${qualifiedTable} ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS ${policyName} ON ${qualifiedTable}`);
  await knex.raw(`
    CREATE POLICY ${policyName} ON ${qualifiedTable}
    FOR ALL
    USING (
      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
    )
    WITH CHECK (
      tenant_id = NULLIF(current_setting('app.tenant_id', true), '')
    )
  `);
}

export async function up(knex) {
  if (!(await knex.schema.hasTable('clinics'))) {
    await knex.schema.createTable('clinics', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.string('name', 255).notNullable();
      t.string('code', 50).notNullable();
      t.string('phone', 50);
      t.text('address');
      t.string('region', 100);
      t.string('city', 100);
      t.string('status', 50).notNullable().defaultTo('active');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.unique(['tenant_id', 'code']);
    });
  }

  if (!(await knex.schema.hasTable('branches'))) {
    await knex.schema.createTable('branches', (t) => {
      t.uuid('id').primary();
      t.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
      t.string('name', 255).notNullable();
      t.string('code', 50).notNullable();
      t.string('phone', 50);
      t.text('address');
      t.string('status', 50).notNullable().defaultTo('active');
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.unique(['tenant_id', 'clinic_id', 'code']);
      t.index(['tenant_id', 'clinic_id']);
    });
  }

  // Asosiy jadvallarga ixtiyoriy branch_id. NULL = default filial.
  const branchTargets = ['users', 'doctors', 'appointments', 'inventory_items'];
  for (const table of branchTargets) {
    const hasColumn = await knex.schema.hasColumn(table, 'branch_id');
    if (!hasColumn) {
      await knex.schema.table(table, (t) => {
        t.uuid('branch_id').references('id').inTable('branches').onDelete('SET NULL');
        t.index(['tenant_id', 'branch_id']);
      });
    }
  }

  // Mavjud tenantlar uchun default klinika + filial.
  const tenants = await knex.raw('SELECT id, name FROM tenants');
  for (const tenant of tenants.rows) {
    const clinicId = (await knex.raw('SELECT gen_random_uuid()::text AS id')).rows[0].id;
    const branchId = (await knex.raw('SELECT gen_random_uuid()::text AS id')).rows[0].id;
    await knex.raw(
      `INSERT INTO clinics (id, tenant_id, name, code, status)
       VALUES ($1, $2, $3, 'main', 'active')
       ON CONFLICT (tenant_id, code) DO NOTHING`,
      [clinicId, tenant.id, tenant.name || 'Klinika']
    );
    await knex.raw(
      `INSERT INTO branches (id, tenant_id, clinic_id, name, code, status)
       SELECT $1, $2, c.id, 'Bosh filial', 'main', 'active'
       FROM clinics c
       WHERE c.tenant_id = $2 AND c.code = 'main'
         AND NOT EXISTS (
           SELECT 1 FROM branches b WHERE b.tenant_id = $2 AND b.code = 'main'
         )`,
      [branchId, tenant.id]
    );
  }

  // RLS: yangi jadvallar + 008'dan keyin qolib ketganlar uchun qayta tatbiq.
  const tables = await tenantTables(knex);
  for (const { table_schema: schema, table_name: table } of tables) {
    await applyTenantPolicy(knex, schema, table);
  }
}

export async function down(knex) {
  for (const table of ['users', 'doctors', 'appointments', 'inventory_items']) {
    if (await knex.schema.hasColumn(table, 'branch_id')) {
      await knex.schema.table(table, (t) => {
        t.dropIndex(['tenant_id', 'branch_id']);
        t.dropColumn('branch_id');
      });
    }
  }
  await knex.schema.dropTableIfExists('branches');
  await knex.schema.dropTableIfExists('clinics');
}
