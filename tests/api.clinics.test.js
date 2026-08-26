import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { closeTestApp, getTestApp } from './helpers/test-app.js';

let app;
let adminToken;
let doctorToken;

beforeAll(async () => {
  app = await getTestApp();
  const admin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD });
  adminToken = admin.body.token;
  const doctor = await request(app)
    .post('/api/auth/login')
    .send({ username: 'doctor', password: process.env.SEED_DOCTOR_PASSWORD });
  doctorToken = doctor.body.token;
});

afterAll(closeTestApp);

describe('GET /api/clinics', () => {
  it('tokensiz 401', async () => {
    const res = await request(app).get('/api/clinics');
    expect(res.status).toBe(401);
  });

  it('doctor ko\'ra oladi (patients.read)', async () => {
    const res = await request(app)
      .get('/api/clinics')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.clinics)).toBe(true);
  });
});

describe('POST /api/clinics', () => {
  it('doctor yarata olmaydi (structure.manage) — 403', async () => {
    const res = await request(app)
      .post('/api/clinics')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ name: 'Yashirin klinika', code: 'hidden-1' });
    expect(res.status).toBe(403);
    expect(res.body.missing_permissions).toContain('structure.manage');
  });

  it('note\'g\'ri code — 400 (Zod)', async () => {
    const res = await request(app)
      .post('/api/clinics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Test', code: 'UPPER CASE!' });
    expect(res.status).toBe(400);
  });

  it('admin klinika yaratadi, keyin ro\'yxatda ko\'rinadi', async () => {
    const created = await request(app)
      .post('/api/clinics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Oqtosh klinika', code: 'oqtosh-main', city: 'Oqtosh' });
    expect(created.status).toBe(201);
    expect(created.body.clinic.code).toBe('oqtosh-main');

    const list = await request(app)
      .get('/api/clinics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const found = list.body.clinics.find((c) => c.code === 'oqtosh-main');
    expect(found).toBeTruthy();
    expect(Array.isArray(found.branches)).toBe(true);
  });

  it('takroriy code — 409', async () => {
    const res = await request(app)
      .post('/api/clinics')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nusxa', code: 'oqtosh-main' });
    expect(res.status).toBe(409);
  });
});

describe('Filiallar', () => {
  let clinicId;

  beforeAll(async () => {
    const list = await request(app)
      .get('/api/clinics')
      .set('Authorization', `Bearer ${adminToken}`);
    clinicId = list.body.clinics.find((c) => c.code === 'oqtosh-main').id;
  });

  it('admin filial yaratadi', async () => {
    const res = await request(app)
      .post(`/api/clinics/${clinicId}/branches`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Markaziy filial', code: 'filial-1' });
    expect(res.status).toBe(201);
    expect(res.body.branch.clinic_id).toBe(clinicId);
  });

  it('filial code takrori — 409', async () => {
    const res = await request(app)
      .post(`/api/clinics/${clinicId}/branches`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Nusxa filial', code: 'filial-1' });
    expect(res.status).toBe(409);
  });

  it('yo\'q klinika filiali — 404', async () => {
    const res = await request(app)
      .post('/api/clinics/00000000-0000-0000-0000-000000000000/branches')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Xayoliy', code: 'filial-x' });
    expect(res.status).toBe(404);
  });

  it('doctor filial yarata olmaydi — 403', async () => {
    const res = await request(app)
      .post(`/api/clinics/${clinicId}/branches`)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ name: 'Noqonuniy', code: 'filial-2' });
    expect(res.status).toBe(403);
  });
});
