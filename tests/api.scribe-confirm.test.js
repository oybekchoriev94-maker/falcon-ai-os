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

describe('POST /api/scribe/transcribe — draft oqimi (PR #7)', () => {
  let consultationId;

  it('matnli diktant DRAFT sifatida saqlanadi', async () => {
    const res = await request(app)
      .post('/api/scribe/transcribe')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ raw_text: 'Bemor Aliyev Vali. Tashxis: angina. Paratsetamol 500 mg buyurildi.' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('draft');
    expect(res.body.consultation_id).toBeTruthy();
    expect(Array.isArray(res.body.medication_warnings)).toBe(true);
    consultationId = res.body.consultation_id;
  });

  it('draft GET orqali ko\'rinadi', async () => {
    const res = await request(app)
      .get(`/api/scribe/consultations/${consultationId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.consultation.status).toBe('draft');
  });

  it('draft tahrirlanadi', async () => {
    const res = await request(app)
      .put(`/api/scribe/consultations/${consultationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ data_json: { diagnosis: 'Angina (tuzatilgan)', medicines: 'paratsetamol 500 mg' } });
    expect(res.status).toBe(200);
    expect(res.body.consultation.status).toBe('draft');
  });

  it('tasdiqlash — status confirmed bo\'ladi', async () => {
    const res = await request(app)
      .post(`/api/scribe/consultations/${consultationId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');
  });

  it('qayta tasdiqlash — 409', async () => {
    const res = await request(app)
      .post(`/api/scribe/consultations/${consultationId}/confirm`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
  });

  it('tasdiqlangan yozuv tahrirlanmaydi — 409', async () => {
    const res = await request(app)
      .put(`/api/scribe/consultations/${consultationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ raw_text: 'o\'zgartirish' });
    expect(res.status).toBe(409);
  });

  it('history ?status=confirmed filtrida ko\'rinadi', async () => {
    const res = await request(app)
      .get('/api/scribe/history?status=confirmed')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.consultations.some((c) => c.id === consultationId)).toBe(true);
  });
});

describe('Shifokor egaligi', () => {
  let consultationId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/scribe/transcribe')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ raw_text: 'Bemor testi. Tashxis: ORVI.' });
    consultationId = res.body.consultation_id;
  });

  it('boshqa shifokor tasdiqlay olmaydi — 403', async () => {
    const res = await request(app)
      .post(`/api/scribe/consultations/${consultationId}/confirm`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it('yo\'q konsultatsiya — 404', async () => {
    const res = await request(app)
      .post('/api/scribe/consultations/00000000-0000-0000-0000-000000000000/confirm')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/scribe/patient-summary', () => {
  it('yozuvi yo\'q bemor uchun bo\'sh xulosa', async () => {
    const res = await request(app)
      .get('/api/scribe/patient-summary/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('none');
    expect(res.body.consultations).toBe(0);
  });
});
