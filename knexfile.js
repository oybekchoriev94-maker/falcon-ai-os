export default {
  development: {
    client: 'postgresql',
    connection: process.env.DATABASE_URL || 'postgresql://falcon:falcon@localhost:5432/falcon_ai_os',
    pool: { min: 2, max: 10 },
    migrations: { tableName: 'knex_migrations' },
  },
  production: {
    client: 'postgresql',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    pool: { min: 2, max: 25 },
    migrations: { tableName: 'knex_migrations' },
  },
};
