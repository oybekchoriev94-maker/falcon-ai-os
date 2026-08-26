import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { seedDefaultUsers } from '../backend/routes/auth.js';

describe('seedDefaultUsers', () => {
  it('creates all default roles and waits for every insert', async () => {
    const inserted = [];
    const pool = {
      async query(sql, params) {
        if (sql.startsWith('SELECT id FROM users')) return { rows: [] };
        if (sql.includes('INSERT INTO users')) {
          inserted.push({ sql, params });
          return { rows: [] };
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      },
    };

    process.env.TENANT_ID = 'tenant-test';
    process.env.SEED_ADMIN_PASSWORD = randomBytes(24).toString('base64url');
    process.env.SEED_CEO_PASSWORD = randomBytes(24).toString('base64url');
    process.env.SEED_RECEPTION_PASSWORD = randomBytes(24).toString('base64url');
    process.env.SEED_DOCTOR_PASSWORD = randomBytes(24).toString('base64url');
    await seedDefaultUsers(pool);

    expect(inserted).toHaveLength(4);
    expect(inserted.map(({ params }) => params[4])).toEqual([
      'ceo', 'admin', 'receptionist', 'doctor',
    ]);
    expect(inserted.every(({ params }) => params[1] === 'tenant-test')).toBe(true);
  });
});
