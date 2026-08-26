/**
 * Xodim nazorati: smena jadvali va kamera zona qoidalari
 * (roadmap modullari 4 — Xodim nazorati, 5 — Aqlli NVR).
 *
 * ASOSIY QOIDA (yo'l xarita): "Face ID asosiy jazo mexanizmi bo'lmaydi.
 * HRMS check-in/smena asosiy yozuv, kamera tasdiqlovchi dalil bo'ladi."
 * Shu sababli bu yerda:
 *   - staff_shifts     — kutilayotgan smena (asosiy yozuv);
 *   - vision_zone_rules— qaysi zonaga qachon kirish mumkinligi;
 *                        buzilishlar faqat SIGNAL, jazo emas —
 *                        rahbar tekshiradi.
 *
 * Davomatning o'zi mavjud attendance_events (Face ID agent) va
 * vision_events (Edge kameralar) jadvallaridan olinadi — yangi
 * hodisa jadvali kerak emas.
 */

export async function up(knex) {
  if (!(await knex.schema.hasTable('staff_shifts'))) {
    await knex.raw(`
      CREATE TABLE staff_shifts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        staff_name text NOT NULL,
        doctor_id uuid REFERENCES doctors(id) ON DELETE SET NULL,
        shift_date date NOT NULL,
        start_time time NOT NULL,
        end_time time NOT NULL,
        grace_minutes integer NOT NULL DEFAULT 15,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, staff_name, shift_date)
      )
    `);
    await knex.raw(
      `CREATE INDEX staff_shifts_date_idx ON staff_shifts (tenant_id, shift_date)`
    );
  }

  if (!(await knex.schema.hasTable('vision_zone_rules'))) {
    await knex.raw(`
      CREATE TABLE vision_zone_rules (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        zone_id varchar(64) NOT NULL,
        rule_type varchar(20) NOT NULL CHECK (rule_type IN ('after_hours', 'restricted')),
        allowed_start time,
        allowed_end time,
        severity varchar(10) NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, zone_id, rule_type)
      )
    `);
  }
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS vision_zone_rules');
  await knex.raw('DROP TABLE IF EXISTS staff_shifts');
}
