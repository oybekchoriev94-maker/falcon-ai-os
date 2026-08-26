/**
 * Xodim vazifalari — belgilangan ishlar va bajarilish nazorati.
 *
 * Rahbar vazifa belgilaydi (staff.manage), xodim o'z vazifasini
 * bajarib belgilaydi (tasks.write). Kechikkan vazifalar 'overdue'
 * deb hisoblanadi (due_at < hozir va status != done) — bu DALIL,
 * jazo emas: hisobot rahbarga ko'rsatiladi.
 *
 * staff_member_id staff_members(bigint) ga bog'lanadi; staff_name
 * denormallashilgan snapshot (ro'yxatda JOIN kerak emas).
 */

export async function up(knex) {
  const has = await knex.schema.hasTable('staff_tasks');
  if (!has) {
    await knex.raw(`
      CREATE TABLE staff_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        staff_member_id bigint NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
        staff_name varchar(120) NOT NULL,
        title varchar(200) NOT NULL,
        description text,
        assigned_by uuid,
        due_at timestamptz,
        status varchar(20) NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'in_progress', 'done')),
        done_at timestamptz,
        result_note text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await knex.raw(`CREATE INDEX staff_tasks_status_idx ON staff_tasks (tenant_id, status)`);
    await knex.raw(`CREATE INDEX staff_tasks_staff_idx ON staff_tasks (tenant_id, staff_member_id)`);
    await knex.raw(`CREATE INDEX staff_tasks_due_idx ON staff_tasks (tenant_id, due_at)`);
    // Tenant izolyatsiyasi — 038-040 bilan bir xil inline siyosat
    await knex.raw('ALTER TABLE staff_tasks ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE staff_tasks FORCE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY falcon_tenant_isolation ON staff_tasks
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
    `);
  }
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS staff_tasks');
}
