import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { closeTestApp, getTestApp } from './helpers/test-app.js';

let app;

beforeAll(async () => {
  app = await getTestApp();
});

afterAll(closeTestApp);

describe('POST /api/auth/login', () => {
  it('logs in with valid admin credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.role).toBe('admin');
  });

  it('rejects invalid password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('rejects empty body via Zod', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/refresh', () => {
  it('refreshes a valid token', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD });
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects expired token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/logout → blacklist', () => {
  it('logs out and blacklists token', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD });
    const token = login.body.token;

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(200);

    const reuse = await request(app)
      .get('/api/patients')
      .set('Authorization', `Bearer ${token}`);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error).toMatch(/bekor qilingan/i);
  });
});

describe('Protected medical endpoints', () => {
  it('rejects patient report access without auth', async () => {
    const res = await request(app)
      .get('/api/patient/report/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(401);
  });
});
