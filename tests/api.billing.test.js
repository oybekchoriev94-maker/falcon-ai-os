import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'crypto';

let app;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.INTERNAL_SECRET = randomBytes(32).toString('hex');
  process.env.ADMIN_PASSWORD = 'TestAdmin123';
  
  const server = await import('../server.js?t=' + Date.now());
  app = server.app;
});

describe('POST /api/billing/redeem', () => {
  let token;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'TestAdmin123' });
    token = res.body.token;
  });

  it('rejects empty body via Zod', async () => {
    const res = await request(app)
      .post('/api/billing/redeem')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects missing patient_id', async () => {
    const res = await request(app)
      .post('/api/billing/redeem')
      .set('Authorization', `Bearer ${token}`)
      .send({ booking_id: 1, base_cost: 100000, points_to_redeem: 5000 });
    expect(res.status).toBe(400);
  });

  it('rejects non-positive base_cost', async () => {
    const res = await request(app)
      .post('/api/billing/redeem')
      .set('Authorization', `Bearer ${token}`)
      .send({ patient_id: '00000000-0000-0000-0000-000000000000', booking_id: 1, base_cost: -100, points_to_redeem: 0 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/doctors/toggle-status — Zod', () => {
  let token;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'admin123' });
    token = res.body.token;
  });

  it('rejects empty body', async () => {
    const res = await request(app)
      .post('/api/doctors/toggle-status')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects non-uuid doctor_id', async () => {
    const res = await request(app)
      .post('/api/doctors/toggle-status')
      .set('Authorization', `Bearer ${token}`)
      .send({ doctor_id: 'not-a-uuid' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/campaign/settings — Zod', () => {
  let token;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'admin123' });
    token = res.body.token;
  });

  it('rejects invalid campaign mode', async () => {
    const res = await request(app)
      .post('/api/campaign/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ campaign_mode: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('accepts valid always mode', async () => {
    const res = await request(app)
      .post('/api/campaign/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ campaign_mode: 'always' });
    expect(res.status).toBe(200);
  });
});

describe('Path traversal protection', () => {
  it('blocks directory traversal attempts', async () => {
    const res = await request(app).get('/..%2f..%2f.env');
    expect(res.status).toBe(404);
  });

  it('blocks .env direct access', async () => {
    const res = await request(app).get('/.env');
    expect(res.status).toBe(404);
  });

  it('serves whitelisted pages', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});

describe('Unauthenticated endpoints blocked', () => {
  it('blocks agent-create without auth', async () => {
    const res = await request(app)
      .post('/api/referrals/agent-create')
      .send({});
    expect(res.status).toBe(401);
  });

  it('blocks pipeline without auth', async () => {
    const res = await request(app)
      .post('/api/referrals/pipeline')
      .send({});
    expect(res.status).toBe(401);
  });
});

describe('GET /api/health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('Falcon AI OS');
  });
});
