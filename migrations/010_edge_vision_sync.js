const POLICY_NAME = 'falcon_tenant_isolation';
const TABLES = ['edge_nodes', 'edge_nonces', 'vision_events'];

async function enableTenantPolicy(knex, table) {
  await knex.raw(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS ${POLICY_NAME} ON public.${table}`);
  await knex.raw(`
    CREATE POLICY ${POLICY_NAME} ON public.${table}
    FOR ALL
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
    WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
  `);
}

export async function up(knex) {
  await knex.schema
    .createTable('edge_nodes', (table) => {
      table.uuid('id').primary();
      table.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('clinic_id', 64).notNullable();
      table.string('node_id', 64).notNullable();
      table.string('display_name', 120).notNullable();
      table.string('key_id', 64).notNullable().unique();
      table.text('signing_secret_ciphertext').notNullable();
      table.string('status', 24).notNullable().defaultTo('provisioned');
      table.string('software_version', 32);
      table.jsonb('capabilities').notNullable().defaultTo('[]');
      table.jsonb('cameras').notNullable().defaultTo('[]');
      table.string('last_event_hash', 64).notNullable().defaultTo('0'.repeat(64));
      table.timestamp('last_seen_at', { useTz: true });
      table.timestamp('last_registered_at', { useTz: true });
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.unique(['tenant_id', 'node_id']);
      table.index(['tenant_id', 'status']);
    })
    .createTable('edge_nonces', (table) => {
      table.bigIncrements('id');
      table.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('node_id', 64).notNullable();
      table.string('nonce', 64).notNullable();
      table.timestamp('expires_at', { useTz: true }).notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.unique(['tenant_id', 'node_id', 'nonce']);
      table.foreign(['tenant_id', 'node_id'])
        .references(['tenant_id', 'node_id'])
        .inTable('edge_nodes')
        .onDelete('CASCADE');
      table.index(['expires_at']);
    })
    .createTable('vision_events', (table) => {
      table.uuid('id').primary();
      table.text('tenant_id').notNullable().references('id').inTable('tenants').onDelete('CASCADE');
      table.string('clinic_id', 64).notNullable();
      table.string('node_id', 64).notNullable();
      table.string('camera_id', 64).notNullable();
      table.string('zone_id', 64).notNullable();
      table.string('event_type', 64).notNullable();
      table.string('subject_ref', 96);
      table.decimal('confidence', 6, 5).notNullable();
      table.timestamp('occurred_at', { useTz: true }).notNullable();
      table.timestamp('edge_received_at', { useTz: true }).notNullable();
      table.string('model_version', 96).notNullable();
      table.string('evidence_sha256', 64);
      table.string('dedup_key', 190).notNullable();
      table.jsonb('metadata').notNullable().defaultTo('{}');
      table.string('previous_hash', 64).notNullable();
      table.string('record_hash', 64).notNullable();
      table.timestamp('ingested_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.unique(['tenant_id', 'node_id', 'dedup_key']);
      table.index(['tenant_id', 'occurred_at']);
      table.index(['tenant_id', 'camera_id', 'occurred_at']);
      table.index(['tenant_id', 'event_type', 'occurred_at']);
      table.index(['tenant_id', 'node_id', 'previous_hash']);
    });

  await knex.raw(`
    ALTER TABLE public.edge_nodes
      ADD CONSTRAINT edge_nodes_status_check
      CHECK (status IN ('provisioned', 'active', 'disabled')),
      ADD CONSTRAINT edge_nodes_last_event_hash_check
      CHECK (last_event_hash ~ '^[a-f0-9]{64}$');
    ALTER TABLE public.vision_events
      ADD CONSTRAINT vision_events_confidence_check
      CHECK (confidence >= 0 AND confidence <= 1),
      ADD CONSTRAINT vision_events_hashes_check
      CHECK (
        previous_hash ~ '^[a-f0-9]{64}$'
        AND record_hash ~ '^[a-f0-9]{64}$'
        AND (evidence_sha256 IS NULL OR evidence_sha256 ~ '^[a-f0-9]{64}$')
      );
  `);

  for (const table of TABLES) await enableTenantPolicy(knex, table);
}

export async function down(knex) {
  await knex.schema.dropTableIfExists('vision_events');
  await knex.schema.dropTableIfExists('edge_nonces');
  await knex.schema.dropTableIfExists('edge_nodes');
}
