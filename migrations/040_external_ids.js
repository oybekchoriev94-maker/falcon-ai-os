/**
 * Tashqi tizim ID'lari — Medplum/FHIR integratsiyasi poydevori (roadmap PR #5).
 *
 * MUAMMO: Falcon bemor kartalari va qabullar ichki UUID'da yashaydi.
 * Medplum (FHIR server) o'z ID'larini beradi — Patient/123, Encounter/456.
 * Ikkisi orasidagi ko'prik yo'q edi.
 *
 * YECHIM: external_ids — umumiy mapping jadvali (tenant_id, system,
 * entity, local_id -> external_id). Hozircha system='medplum', keyin
 * ERPNext/Orthanc ham shu jadvalga yoziladi — yangi jadval shart emas.
 *
 * UNIQUE (tenant_id, system, entity, local_id) — bitta Falcon yozuvi
 * bitta tizimda faqat bitta tashqi IDga ega bo'ladi (sinhronizatsiya
 * takrorlanganda UPDATE qilinadi, dublikat yozuv chiqmaydi).
 */

export async function up(knex) {
  const has = await knex.schema.hasTable('external_ids');
  if (!has) {
    await knex.raw(`
      CREATE TABLE external_ids (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        system varchar(40) NOT NULL,
        entity varchar(40) NOT NULL,
        local_id uuid NOT NULL,
        external_id varchar(120) NOT NULL,
        external_version varchar(40),
        synced_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (tenant_id, system, entity, local_id)
      )
    `);
    await knex.raw(
      `CREATE INDEX external_ids_lookup_idx
         ON external_ids (tenant_id, system, entity, local_id)`
    );
    await knex.raw(
      `CREATE INDEX external_ids_reverse_idx
         ON external_ids (tenant_id, system, external_id)`
    );
    // Tenant izolyatsiyasi — 038/039 bilan bir xil inline siyosat
    await knex.raw('ALTER TABLE external_ids ENABLE ROW LEVEL SECURITY');
    await knex.raw('ALTER TABLE external_ids FORCE ROW LEVEL SECURITY');
    await knex.raw(`
      CREATE POLICY falcon_tenant_isolation ON external_ids
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
    `);
  }
}

export async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS external_ids');
}
