/**
 * Lavozim bo'yicha doimiy vazifa shablonlari.
 *
 * Masalan "hamshira" lavozimiga 5 ta standart vazifa biriktiriladi;
 * har kuni FAOL xodimlarga o'z lavozimidagi shablonlar asosida
 * staff_tasks avtomatik yaratiladi (backend/cron/duty-tasks.js).
 *
 * position ustuni staff_members.position bilan ANIQ (harfma-harf)
 * mos kelishi kerak — bu qat'iy tashqi kalit emas (position matn
 * sifatida saqlanadi), shuning uchun UI'da ogohlantirish beriladi.
 *
 * Bir xodimga bir shablondan kuniga faqat bitta vazifa yaratilishi
 * uchun (tenant, xodim, shablon, sana) unique index qo'yiladi —
 * NULL qiymatlar (qo'lda yaratilgan vazifalar) bir-biriga zid
 * kelmaydi, chunki Postgres NULL'larni alohida hisoblaydi.
 */

export async function up(knex) {
  const hasTemplates = await knex.schema.hasTable('duty_templates');
  if (!hasTemplates) {
    await knex.raw(`
      CREATE TABLE duty_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        position varchar(80) NOT NULL,
        title varchar(200) NOT NULL,
        description text,
        sort_order int NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await knex.raw(`CREATE INDEX duty_templates_position_idx ON duty_templates (tenant_id, position)`);
    await knex.raw('ALTER TABLE duty_templates ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE duty_templates FORCE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY falcon_tenant_isolation ON duty_templates
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
    `);
  }

  const hasCol = await knex.schema.hasColumn('staff_tasks', 'duty_template_id');
  if (!hasCol) {
    await knex.raw(`ALTER TABLE staff_tasks ADD COLUMN duty_template_id uuid REFERENCES duty_templates(id) ON DELETE SET NULL`);
    await knex.raw(`ALTER TABLE staff_tasks ADD COLUMN generated_for_date date`);
    await knex.raw(`
      CREATE UNIQUE INDEX staff_tasks_daily_duty_uq
        ON staff_tasks (tenant_id, staff_member_id, duty_template_id, generated_for_date)
    `);
  }
}

export async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS staff_tasks_daily_duty_uq');
  await knex.raw('ALTER TABLE staff_tasks DROP COLUMN IF EXISTS generated_for_date');
  await knex.raw('ALTER TABLE staff_tasks DROP COLUMN IF EXISTS duty_template_id');
  await knex.raw('DROP TABLE IF EXISTS duty_templates');
}
