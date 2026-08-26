import 'dotenv/config';
import knex from 'knex';
import knexConfig from '../knexfile.js';
import { resolveMigrationOptions } from './migration-compat.js';

const env = process.env.NODE_ENV || 'development';
const config = knexConfig[env];

if (!config) {
  console.error(`Unknown environment: ${env}`);
  process.exit(1);
}

const db = knex(config);

async function migrate() {
  try {
    console.log(`[MIGRATE] Running migrations (${env})...`);
    const migrationOptions = await resolveMigrationOptions(db, config.migrations);
    const [batch, migrations] = await db.migrate.latest(migrationOptions);
    if (migrations.length === 0) {
      console.log('[MIGRATE] All migrations already applied');
    } else {
      console.log(`[MIGRATE] Batch ${batch}: ${migrations.join(', ')}`);
    }
    console.log('[MIGRATE] Done!');
  } catch (e) {
    console.error('[MIGRATE] Error:', e);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

migrate();
