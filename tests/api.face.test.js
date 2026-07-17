import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { randomBytes } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

let app;
let getDb;
let adminToken;
let ceoToken;
let doctorToken;
let testDoctorId;
let testPatientId;

// ─── Helpers ────────────────────────────────────────────────────────

/** Generate a valid 128-element face descriptor array (-1..1) */
function makeFaceDescriptor(len = 128) {
  const arr = [];
  for (let i = 0; i < len; i++) {
    arr.push(Math.random() * 2 - 1);
  }
  return arr;
}

/** Generate a unique nonce string */
function makeNonce() {
  return randomBytes(16).toString('hex');
}

/** Generate a pair { nonce, timestamp } valid for 30 s */
function noncePair() {
  return { nonce: makeNonce(), timestamp: Date.now() };
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  process.env.INTERNAL_SECRET = randomBytes(32).toString('hex');
  process.env.FACE_ENCRYPTION_KEY = randomBytes(32).toString('hex');

  const server = await import('../server.js?t=' + Date.now());
  app = server.app;
  getDb = () => server.getDb;

  // Logins
  const adminLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD || 'admin123' });
  adminToken = adminLogin.body.token;

  const ceoLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'ceo', password: 'ceo-change-me-now' });
  ceoToken = ceoLogin.body.token;

  const docLogin = await request(app)
    .post('/api/auth/login')
    .send({ username: 'doctor', password: 'doctor-change-me-now' });
  doctorToken = docLogin.body.token;

  // Ensure a doctor exists in the DB for testing CRUD endpoints
  const db = getDb();
  let doctor = db.prepare('SELECT id, first_name, last_name FROM doctors LIMIT 1').get();
  if (!doctor) {
    const id = uuidv4();
    db.prepare(
      'INSERT INTO doctors (id, first_name, last_name, specialty, status) VALUES (?, ?, ?, ?, ?)'
    ).run(id, 'Test', 'Doctor', 'General', 'Faol');
    testDoctorId = id;
  } else {
    testDoctorId = doctor.id;
  }
});

// ─── GET /api/face/doctors ──────────────────────────────────────────

describe('GET /api/face/doctors', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/face/doctors');
    expect(res.status).toBe(401);
  });

  it('returns 403 for doctor role', async () => {
    const res = await request(app)
      .get('/api/face/doctors')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it('returns doctors list for admin (200)', async () => {
    const res = await request(app)
      .get('/api/face/doctors')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.doctors)).toBe(true);
  });

  it('returns doctors list for ceo (200)', async () => {
    const res = await request(app)
      .get('/api/face/doctors')
      .set('Authorization', `Bearer ${ceoToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── POST /api/face/register ────────────────────────────────────────

describe('POST /api/face/register', () => {
  const validFace = makeFaceDescriptor();

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/face/register')
      .send({ doctor_id: testDoctorId, ...noncePair(), face_descriptor: validFace });
    expect(res.status).toBe(401);
  });

  it('returns 403 for doctor role', async () => {
    const res = await request(app)
      .post('/api/face/register')
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ doctor_id: testDoctorId, ...noncePair(), face_descriptor: validFace });
    expect(res.status).toBe(403);
  });

  it('returns 400 for empty body', async () => {
    const res = await request(app)
      .post('/api/face/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing doctor_id', async () => {
    const res = await request(app)
      .post('/api/face/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...noncePair(), face_descriptor: validFace });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-uuid doctor_id', async () => {
    const res = await request(app)
      .post('/api/face/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ doctor_id: 'not-a-uuid', ...noncePair(), face_descriptor: validFace });
    expect(res.status).toBe(400);
  });

  it('returns 400 for too-small face_descriptor', async () => {
    const res = await request(app)
      .post('/api/face/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ doctor_id: testDoctorId, ...noncePair(), face_descriptor: [0.1, 0.2] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for expired timestamp', async () => {
    const res = await request(app)
      .post('/api/face/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        doctor_id: testDoctorId,
        nonce: makeNonce(),
        timestamp: Date.now() - 60000,
        face_descriptor: validFace,
      });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing nonce', async () => {
    const res = await request(app)
      .post('/api/face/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        doctor_id: testDoctorId,
        timestamp: Date.now(),
        face_descriptor: validFace,
      });
    expect(res.status).toBe(400);
  });

  it('registers a face descriptor successfully (200)', async () => {
    const res = await request(app)
      .post('/api/face/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        doctor_id: testDoctorId,
        ...noncePair(),
        face_descriptor: makeFaceDescriptor(),
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/saqlandi/i);
  });

  it('returns 409 for duplicate nonce', async () => {
    const pair = noncePair();
    // First call
    await request(app)
      .post('/api/face/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ doctor_id: testDoctorId, ...pair, face_descriptor: makeFaceDescriptor() });
    // Second call with same nonce
    const res = await request(app)
      .post('/api/face/register')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ doctor_id: testDoctorId, ...pair, face_descriptor: makeFaceDescriptor() });
    expect(res.status).toBe(409);
  });
});

// ─── POST /api/face/verify ──────────────────────────────────────────

describe('POST /api/face/verify', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/face/verify')
      .send({ ...noncePair(), face_descriptor: makeFaceDescriptor() });
    expect(res.status).toBe(401);
  });

  it('returns 400 for empty body', async () => {
    const res = await request(app)
      .post('/api/face/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for too-small face_descriptor', async () => {
    const res = await request(app)
      .post('/api/face/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...noncePair(), face_descriptor: [0.5] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for expired timestamp', async () => {
    const res = await request(app)
      .post('/api/face/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nonce: makeNonce(),
        timestamp: Date.now() - 60000,
        face_descriptor: makeFaceDescriptor(),
      });
    expect(res.status).toBe(400);
  });

  it('returns 200 with matched=false for random face', async () => {
    const res = await request(app)
      .post('/api/face/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...noncePair(), face_descriptor: makeFaceDescriptor() });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Random descriptor won't match anyone
    expect(res.body.matched).toBe(false);
  });

  it('returns 200 with liveness_passed=false when score is low', async () => {
    const res = await request(app)
      .post('/api/face/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...noncePair(),
        face_descriptor: makeFaceDescriptor(),
        liveness_score: 0.1,
      });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.spoof_warning).toBe(true);
  });

  it('accepts valid liveness_score', async () => {
    const res = await request(app)
      .post('/api/face/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...noncePair(),
        face_descriptor: makeFaceDescriptor(),
        liveness_score: 0.95,
      });
    expect(res.status).toBe(200);
    expect(res.body.liveness_passed).toBe(true);
  });

  it('returns 409 for duplicate nonce', async () => {
    const pair = noncePair();
    await request(app)
      .post('/api/face/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...pair, face_descriptor: makeFaceDescriptor() });
    const res = await request(app)
      .post('/api/face/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...pair, face_descriptor: makeFaceDescriptor() });
    expect(res.status).toBe(409);
  });
});

// ─── GET /api/face/logs ─────────────────────────────────────────────

describe('GET /api/face/logs', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/face/logs');
    expect(res.status).toBe(401);
  });

  it('returns 403 for doctor role', async () => {
    const res = await request(app)
      .get('/api/face/logs')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it('returns face logs for admin (200)', async () => {
    const res = await request(app)
      .get('/api/face/logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('returns face logs for ceo (200)', async () => {
    const res = await request(app)
      .get('/api/face/logs')
      .set('Authorization', `Bearer ${ceoToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─── GET /api/face/doctors/status ───────────────────────────────────

describe('GET /api/face/doctors/status', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/face/doctors/status');
    expect(res.status).toBe(401);
  });

  it('returns 403 for doctor role', async () => {
    const res = await request(app)
      .get('/api/face/doctors/status')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it('returns biometric status for admin (200)', async () => {
    const res = await request(app)
      .get('/api/face/doctors/status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.doctors)).toBe(true);
    if (res.body.doctors.length > 0) {
      const doc = res.body.doctors[0];
      expect(doc).toHaveProperty('id');
      expect(doc).toHaveProperty('biometric_status');
      expect(doc).toHaveProperty('account_status');
      expect(['active', 'no_face']).toContain(doc.biometric_status);
    }
  });
});

// ─── POST /api/face/doctors/:id/block ───────────────────────────────

describe('POST /api/face/doctors/:id/block', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post(`/api/face/doctors/${testDoctorId}/block`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for doctor role', async () => {
    const res = await request(app)
      .post(`/api/face/doctors/${testDoctorId}/block`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent doctor', async () => {
    const res = await request(app)
      .post('/api/face/doctors/00000000-0000-0000-0000-000000000000/block')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('blocks a doctor successfully', async () => {
    const res = await request(app)
      .post(`/api/face/doctors/${testDoctorId}/block`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/bloklandi/i);

    // Verify status changed
    const db = getDb();
    const doc = db.prepare('SELECT status FROM doctors WHERE id = ?').get(testDoctorId);
    expect(doc.status).toBe('Bloklangan');
  });
});

// ─── POST /api/face/doctors/:id/unblock ─────────────────────────────

describe('POST /api/face/doctors/:id/unblock', () => {
  beforeAll(async () => {
    // Ensure doctor is in blocked state for unblock test
    const db = getDb();
    db.prepare("UPDATE doctors SET status = 'Bloklangan' WHERE id = ?").run(testDoctorId);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).post(`/api/face/doctors/${testDoctorId}/unblock`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for doctor role', async () => {
    const res = await request(app)
      .post(`/api/face/doctors/${testDoctorId}/unblock`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent doctor', async () => {
    const res = await request(app)
      .post('/api/face/doctors/00000000-0000-0000-0000-000000000000/unblock')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('unblocks a doctor successfully', async () => {
    const res = await request(app)
      .post(`/api/face/doctors/${testDoctorId}/unblock`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/faollashtirildi/i);

    const db = getDb();
    const doc = db.prepare('SELECT status FROM doctors WHERE id = ?').get(testDoctorId);
    expect(doc.status).toBe('Faol');
  });
});

// ─── DELETE /api/face/doctors/:id/face ──────────────────────────────

describe('DELETE /api/face/doctors/:id/face', () => {
  beforeAll(async () => {
    // Ensure doctor has a face descriptor set
    const db = getDb();
    db.prepare("UPDATE doctors SET face_descriptor = '[1,2,3]', status = 'Faol' WHERE id = ?").run(testDoctorId);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).delete(`/api/face/doctors/${testDoctorId}/face`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for doctor role', async () => {
    const res = await request(app)
      .delete(`/api/face/doctors/${testDoctorId}/face`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent doctor', async () => {
    const res = await request(app)
      .delete('/api/face/doctors/00000000-0000-0000-0000-000000000000/face')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('deletes face descriptor successfully', async () => {
    const res = await request(app)
      .delete(`/api/face/doctors/${testDoctorId}/face`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/o'chirildi/i);

    const db = getDb();
    const doc = db.prepare('SELECT face_descriptor, status FROM doctors WHERE id = ?').get(testDoctorId);
    expect(doc.face_descriptor).toBeNull();
    expect(doc.status).toBe('Faol');
  });
});

// ─── POST /api/face/consent ─────────────────────────────────────────

describe('POST /api/face/consent', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/face/consent')
      .send({ user_type: 'doctor', user_id: testDoctorId });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid user_type', async () => {
    const res = await request(app)
      .post('/api/face/consent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_type: 'invalid', user_id: 'x' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty body', async () => {
    const res = await request(app)
      .post('/api/face/consent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('accepts valid doctor consent (201)', async () => {
    // Clean up any previous consent
    const db = getDb();
    db.prepare("DELETE FROM consent_logs WHERE user_type = 'doctor' AND user_id = ?").run(testDoctorId);

    const res = await request(app)
      .post('/api/face/consent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_type: 'doctor', user_id: testDoctorId, consent_text: 'Test consent' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/berildi/i);
  });

  it('returns 200 for duplicate consent', async () => {
    const res = await request(app)
      .post('/api/face/consent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_type: 'doctor', user_id: testDoctorId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/avval berilgan/i);
  });

  it('accepts valid patient consent (201)', async () => {
    const db = getDb();
    db.prepare("DELETE FROM consent_logs WHERE user_type = 'patient' AND user_id = 'face-test-patient'").run();

    const res = await request(app)
      .post('/api/face/consent')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ user_type: 'patient', user_id: 'face-test-patient' });
    expect([200, 201]).toContain(res.status);
  });
});

// ─── GET /api/face/consent/:userType/:userId ────────────────────────

describe('GET /api/face/consent/:userType/:userId', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get(`/api/face/consent/doctor/${testDoctorId}`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for doctor role', async () => {
    const res = await request(app)
      .get(`/api/face/consent/doctor/${testDoctorId}`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it('returns consent=true for doctor with consent', async () => {
    const res = await request(app)
      .get(`/api/face/consent/doctor/${testDoctorId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.consent).toBe(true);
    expect(res.body.data).not.toBeNull();
  });

  it('returns consent=false for unknown patient', async () => {
    const res = await request(app)
      .get('/api/face/consent/patient/nonexistent-id')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.consent).toBe(false);
    expect(res.body.data).toBeNull();
  });
});

// ─── DELETE /api/face/forget/doctor/:id ─────────────────────────────

describe('DELETE /api/face/forget/doctor/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).delete(`/api/face/forget/doctor/${testDoctorId}`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for doctor role', async () => {
    const res = await request(app)
      .delete(`/api/face/forget/doctor/${testDoctorId}`)
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent doctor', async () => {
    const res = await request(app)
      .delete('/api/face/forget/doctor/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('forgets doctor biometric data successfully', async () => {
    // Set up face descriptor for the doctor
    const db = getDb();
    db.prepare("UPDATE doctors SET face_descriptor = '[1,2,3]' WHERE id = ?").run(testDoctorId);

    const res = await request(app)
      .delete(`/api/face/forget/doctor/${testDoctorId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/o'chirildi/i);

    // Verify face_descriptor is null
    const doc = db.prepare('SELECT face_descriptor FROM doctors WHERE id = ?').get(testDoctorId);
    expect(doc.face_descriptor).toBeNull();

    // Verify consent_logs deleted
    const consent = db.prepare(
      "SELECT id FROM consent_logs WHERE user_type = 'doctor' AND user_id = ?"
    ).get(testDoctorId);
    expect(consent).toBeUndefined();
  });
});

// ─── DELETE /api/face/forget/patient/:id ────────────────────────────

describe('DELETE /api/face/forget/patient/:id', () => {
  beforeAll(async () => {
    // Create a test patient
    const db = getDb();
    const existing = db.prepare("SELECT id FROM patients WHERE id = 'face-test-patient'").get();
    if (!existing) {
      db.prepare(
        "INSERT INTO patients (id, first_name, last_name, phone, face_descriptor) VALUES (?, ?, ?, ?, ?)"
      ).run('face-test-patient', 'Test', 'Patient', '+998****4567', '[1,2,3]');
    }
    // Record consent for the patient
    db.prepare("DELETE FROM consent_logs WHERE user_type = 'patient' AND user_id = 'face-test-patient'").run();
    db.prepare(
      "INSERT INTO consent_logs (user_type, user_id, consent_version, consent_text) VALUES ('patient', 'face-test-patient', 'v1', 'test')"
    ).run();
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/api/face/forget/patient/face-test-patient');
    expect(res.status).toBe(401);
  });

  it('returns 403 for doctor role', async () => {
    const res = await request(app)
      .delete('/api/face/forget/patient/face-test-patient')
      .set('Authorization', `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent patient', async () => {
    const res = await request(app)
      .delete('/api/face/forget/patient/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('forgets patient biometric data successfully', async () => {
    const res = await request(app)
      .delete('/api/face/forget/patient/face-test-patient')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/o'chirildi/i);

    const db = getDb();
    const patient = db.prepare("SELECT face_descriptor FROM patients WHERE id = 'face-test-patient'").get();
    expect(patient.face_descriptor).toBeNull();

    const consent = db.prepare(
      "SELECT id FROM consent_logs WHERE user_type = 'patient' AND user_id = 'face-test-patient'"
    ).get();
    expect(consent).toBeUndefined();
  });
});

// ─── POST /api/face/register-patient ────────────────────────────────

describe('POST /api/face/register-patient', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/face/register-patient')
      .send({ first_name: 'New', ...noncePair(), face_descriptor: makeFaceDescriptor() });
    expect(res.status).toBe(401);
  });

  it('returns 400 for empty body', async () => {
    const res = await request(app)
      .post('/api/face/register-patient')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing first_name', async () => {
    const res = await request(app)
      .post('/api/face/register-patient')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...noncePair(), face_descriptor: makeFaceDescriptor() });
    expect(res.status).toBe(400);
  });

  it('returns 400 for too-small face_descriptor', async () => {
    const res = await request(app)
      .post('/api/face/register-patient')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ first_name: 'New', ...noncePair(), face_descriptor: [0.1] });
    expect(res.status).toBe(400);
  });

  it('registers a patient face successfully (200)', async () => {
    const res = await request(app)
      .post('/api/face/register-patient')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'NewPatient',
        last_name: 'Test',
        phone: '+998****4568',
        ...noncePair(),
        face_descriptor: makeFaceDescriptor(),
        liveness_score: 0.95,
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.patient).toBeDefined();
    expect(res.body.patient.first_name).toBe('NewPatient');
    expect(res.body.liveness_passed).toBe(true);
    testPatientId = res.body.patient.id;
  });

  it('rejects low liveness score', async () => {
    const res = await request(app)
      .post('/api/face/register-patient')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        first_name: 'Spoof',
        ...noncePair(),
        face_descriptor: makeFaceDescriptor(),
        liveness_score: 0.1,
      });
    // Liveness threshold is 0.85
    expect(res.status).toBe(403);
    expect(res.body.spoof_warning).toBe(true);
    expect(res.body.liveness_score).toBe(0.1);
  });
});

// ─── GET /api/face/attendance ───────────────────────────────────────

describe('GET /api/face/attendance', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/face/attendance');
    expect(res.status).toBe(401);
  });

  it('returns attendance logs for authenticated user', async () => {
    const res = await request(app)
      .get('/api/face/attendance')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });
});

// ─── GET /api/face/patient-checkins ─────────────────────────────────

describe('GET /api/face/patient-checkins', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/face/patient-checkins');
    expect(res.status).toBe(401);
  });

  it('returns patient checkins for authenticated user', async () => {
    const res = await request(app)
      .get('/api/face/patient-checkins')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });
});

// ─── GET /api/face/patients ─────────────────────────────────────────

describe('GET /api/face/patients', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/face/patients');
    expect(res.status).toBe(401);
  });

  it('returns patients list for authenticated user', async () => {
    const res = await request(app)
      .get('/api/face/patients')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.patients)).toBe(true);
  });

  it('supports search query parameter', async () => {
    const res = await request(app)
      .get('/api/face/patients?q=New')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns empty array for unmatched search', async () => {
    const res = await request(app)
      .get('/api/face/patients?q=ZZZZNONEXISTENT')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.patients).toEqual([]);
  });
});
