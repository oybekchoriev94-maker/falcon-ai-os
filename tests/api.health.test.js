import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { closeTestApp, getTestApp } from './helpers/test-app.js';

let app;

beforeAll(async () => {
  app = await getTestApp();
});

afterAll(closeTestApp);

describe('service health endpoints', () => {
  it('reports ready only after both database pools respond', async () => {
    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ready: true, database: 'ok' });
  });

  it('exposes a lightweight liveness probe', async () => {
    const response = await request(app).get('/api/health/live');
    expect(response.status).toBe(200);
  });
});
