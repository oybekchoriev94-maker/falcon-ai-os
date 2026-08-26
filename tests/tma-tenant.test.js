import { beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import tmaRoutes from '../backend/routes/tma.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

function makeApp(query) {
  const app = express();
  app.use(express.json());
  app.use('/api/tma', tmaRoutes({ query }));
  return app;
}

describe('TMA tenant isolation', () => {
  it('scopes patient lookup by resolved clinic and verified Telegram ID', async () => {
    const query = vi.fn(async (sql, params) => {
      if (sql.includes('FROM tenants')) return { rows: [{ id: 'tenant-a', code: 'CLINIC-A' }] };
      if (sql.includes('FROM patients')) {
        expect(sql).toContain('tenant_id = $1 AND telegram_id = $2');
        expect(params).toEqual(['tenant-a', '777']);
        return { rows: [{ id: 'patient-a', tenant_id: 'tenant-a', first_name: 'Ali' }] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await request(makeApp(query))
      .get('/api/tma/my-data')
      .set('x-telegram-id', '777')
      .set('x-clinic-code', 'CLINIC-A');

    expect(response.status).toBe(200);
    expect(response.body.patient.tenant_id).toBe('tenant-a');
  });

  it('does not use x-tenant-id as clinic authority', async () => {
    const query = vi.fn(async (sql, params) => {
      if (sql.includes('FROM tenants')) {
        expect(params).toEqual(['default']);
        return { rows: [{ id: 'default', code: 'DEFAULT' }] };
      }
      if (sql.includes('FROM patients')) {
        expect(params).toEqual(['default', '777']);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await request(makeApp(query))
      .get('/api/tma/my-data')
      .set('x-telegram-id', '777')
      .set('x-tenant-id', 'victim-clinic');

    expect(response.status).toBe(200);
    expect(response.body.registered).toBe(false);
  });

  it('links an existing phone only inside the selected clinic', async () => {
    const query = vi.fn(async (sql, params) => {
      if (sql.includes('FROM tenants')) return { rows: [{ id: 'tenant-a', code: 'CLINIC-A' }] };
      if (sql.includes('FROM patients') && sql.includes('telegram_id')) {
        expect(params).toEqual(['tenant-a', '777']);
        return { rows: [] };
      }
      if (sql.includes('FROM patients') && sql.includes('phone = $2')) {
        expect(params).toEqual(['tenant-a', '+998901234567']);
        return { rows: [{ id: 'patient-a', tenant_id: 'tenant-a' }] };
      }
      if (sql.startsWith('UPDATE patients')) {
        expect(sql).toContain('tenant_id = $2');
        expect(params).toEqual(['777', 'tenant-a', 'patient-a']);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await request(makeApp(query))
      .post('/api/tma/register-patient')
      .set('x-telegram-id', '777')
      .set('x-clinic-code', 'CLINIC-A')
      .send({ first_name: 'Ali', phone: '+998901234567' });

    expect(response.status).toBe(200);
    expect(response.body.patient.tenant_id).toBe('tenant-a');
  });
});
