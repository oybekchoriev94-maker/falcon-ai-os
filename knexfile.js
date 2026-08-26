export default {
  development: {
    client: 'postgresql',
    connection: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
    pool: { min: 2, max: 10 },
    migrations: { tableName: 'knex_migrations' },
  },
  test: {
    client: 'postgresql',
    connection: process.env.MIGRATION_DATABASE_URL || process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
    pool: { min: 0, max: 5 },
    migrations: { tableName: 'knex_migrations' },
  },
  production: {
    client: 'postgresql',
    connection: {
      connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    },
    pool: { min: 2, max: 25 },
    migrations: { tableName: 'knex_migrations' },
  },
};
