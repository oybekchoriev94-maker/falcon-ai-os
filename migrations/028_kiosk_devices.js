/**
 * T: Kiosk qurilmalari — token bilan autentifikatsiya.
 *
 * XAVFSIZLIK MUAMMOSI:
 * Kirish zalidagi kiosk bemor telefonini kiritib kartani topishi kerak.
 * Agar bu ochiq (auth'siz) endpoint bo'lsa — istalgan kishi internetdan
 * raqam terib bemor ismini bilib oladi. Bu PII sizishi.
 *
 * YECHIM: har kiosk qurilmasi o'z tokeniga ega. Token faqat klinika
 * ichida, qurilma sozlanganda bir marta kiritiladi va localStorage'da
 * qoladi. Token bo'lmasa — API 401 qaytaradi.
 *
 * Qo'shimcha himoya:
 *  - token_hash saqlanadi (ochiq token bazada turmaydi)
 *  - last_seen_at — qurilma jonli ekanini kuzatish
 *  - is_active — yo'qolgan planshetni darrov bloklash
 *  - allowed_ips (ixtiyoriy) — faqat klinika tarmog'idan
 */
export async function up(knex) {
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS kiosk_devices (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name text NOT NULL,                      -- "Kirish zali planshet"
      kind varchar(20) NOT NULL DEFAULT 'entry', -- 'entry'|'queue_tv'|'result'
      location text,                           -- "1-qavat, registratura yonida"
      token_hash text NOT NULL UNIQUE,         -- sha256(token)
      token_prefix varchar(12) NOT NULL,       -- UI da ko'rsatish uchun "kd_a1b2c3…"
      allowed_ips text[],                      -- NULL = cheklov yo'q
      is_active boolean NOT NULL DEFAULT true,
      last_seen_at timestamptz,
      last_seen_ip inet,
      created_by uuid,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS kiosk_devices_tenant_idx
                  ON kiosk_devices (tenant_id, is_active)`);
  await knex.raw(`CREATE INDEX IF NOT EXISTS kiosk_devices_token_idx
                  ON kiosk_devices (token_hash) WHERE is_active`);

  // Kiosk orqali yaratilgan bronlarni ajratish uchun (statistika + audit)
  await knex.raw(`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS kiosk_device_id uuid
                  REFERENCES kiosk_devices(id) ON DELETE SET NULL`);

  // Kiosk sessiyalari — audit va "kim nima qildi" tahlili uchun
  await knex.raw(`
    CREATE TABLE IF NOT EXISTS kiosk_sessions (
      id uuid PRIMARY KEY,
      tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      device_id uuid REFERENCES kiosk_devices(id) ON DELETE SET NULL,
      patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
      phone_masked varchar(20),                -- "+998 90 *** 45 67"
      step_reached varchar(30),                -- 'phone'|'complaint'|'doctor'|'pay'|'done'
      appointment_id bigint REFERENCES appointments(id) ON DELETE SET NULL,
      abandoned boolean NOT NULL DEFAULT false,
      started_at timestamptz NOT NULL DEFAULT NOW(),
      finished_at timestamptz
    )
  `);
  await knex.raw(`CREATE INDEX IF NOT EXISTS kiosk_sessions_tenant_idx
                  ON kiosk_sessions (tenant_id, started_at DESC)`);
}

export async function down(knex) {
  await knex.raw(`DROP TABLE IF EXISTS kiosk_sessions`);
  await knex.raw(`ALTER TABLE appointments DROP COLUMN IF EXISTS kiosk_device_id`);
  await knex.raw(`DROP TABLE IF EXISTS kiosk_devices`);
}
