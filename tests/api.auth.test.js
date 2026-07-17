import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'crypto';

let app;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.INTERNAL_SECRET = randomBytes(32).toString('hex');
  process.env.ADMIN_PASSWORD = 'TestAdmin123';
  process.env.SEED_CEO_PASSWORD = 'ceo-change-me-now';

  const server = await import('../server.js?t=' + Date.now());
  app = server.app;
});

describe('POST /api/auth/login', () => {
  it('logs in with valid admin credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'TestAdmin123' });
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
      .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'admin123' });
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
      .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'admin123' });
    const token = login.body.token;

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(logout.status).toBe(200);

    const reuse = await request(app)
      .get('/api/face/doctors/status')
      .set('Authorization', `Bearer ${token}`);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error).toMatch(/bekor qilingan/i);
  });
});

describe('POST /api/face/consent — Zod validation', () => {
  it('rejects invalid user_type', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'admin123' });
    const res = await request(app)
      .post('/api/face/consent')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ user_type: 'invalid', user_id: 'x' });
    expect(res.status).toBe(400);
  });

  it('accepts valid consent', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'admin123' });
    const res = await request(app)
      .post('/api/face/consent')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ user_type: 'doctor', user_id: 'test-doc-001' });
    expect([200, 201]).toContain(res.status);
  });
});
