import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

import { buildEdgeSignature } from '../backend/services/edge-crypto.js';
import { closeTestApp, getTestApp } from './helpers/test-app.js';

let app;
let adminToken;
let signingKey;
let keyId;
const nodeId = `edge-${randomUUID().slice(0, 8)}`;
const nowIso = new Date().toISOString();

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJson(value[key])])
    );
  }
  return value;
}

function canonicalJson(payload) {
  return JSON.stringify(sortJson(payload));
}

function edgeRequest(path, payload, overrides = {}) {
  const body = canonicalJson(payload);
  const timestamp = overrides.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = overrides.nonce ?? randomUUID().replaceAll('-', '');
  const signature = buildEdgeSignature({
    secret: overrides.signingKey ?? signingKey,
    method: 'POST',
    path,
    timestamp,
    nonce,
    body: Buffer.from(body),
  });
  return request(app)
    .post(path)
    .set('Content-Type', 'application/json')
    .set('X-Falcon-Tenant', 'default')
    .set('X-Falcon-Clinic', 'default')
    .set('X-Falcon-Node', nodeId)
    .set('X-Falcon-Key-ID', overrides.keyId ?? keyId)
    .set('X-Falcon-Timestamp', String(timestamp))
    .set('X-Falcon-Nonce', nonce)
    .set('X-Content-SHA256', signature.bodyHash)
    .set('X-Falcon-Signature', `v1=${overrides.signature ?? signature.signature}`)
    .send(body);
}

beforeAll(async () => {
  app = await getTestApp();
  const login = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD });
  expect(login.status).toBe(200);
  adminToken = login.body.token;

  const provision = await request(app)
    .post('/api/v1/edge/nodes')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      node_id: nodeId,
      clinic_id: 'default',
      display_name: 'Oqtosh test Edge',
    });
  expect(provision.status).toBe(201);
  signingKey = provision.body.signing_key;
  keyId = provision.body.node.key_id;
});

afterAll(closeTestApp);

describe('Edge vision control plane', () => {
  const registration = {
    tenant_id: 'default',
    clinic_id: 'default',
    node_id: nodeId,
    software_version: '0.2.0',
    capabilities: ['event-spool', 'falcon-sync-v1'],
    cameras: [{
      camera_id: 'cam-01',
      channel: 1,
      zone_id: 'warehouse',
      display_name: 'Ombor kamerasi',
      enabled: true,
      vendor: 'hikvision',
      created_at: nowIso,
      updated_at: nowIso,
    }],
  };

  it('registers a provisioned node and rejects nonce replay', async () => {
    const nonce = randomUUID().replaceAll('-', '');
    const accepted = await edgeRequest('/api/edge/v1/nodes/register', registration, { nonce });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ accepted: true });

    const replay = await edgeRequest('/api/edge/v1/nodes/register', registration, { nonce });
    expect(replay.status).toBe(409);
  });

  it('rejects bad signatures and stale timestamps', async () => {
    const badSignature = await edgeRequest('/api/edge/v1/nodes/register', registration, {
      signature: '0'.repeat(64),
    });
    expect(badSignature.status).toBe(401);

    const stale = await edgeRequest('/api/edge/v1/nodes/register', registration, {
      timestamp: Math.floor(Date.now() / 1000) - 301,
    });
    expect(stale.status).toBe(401);
  });

  it('ingests an idempotent hash-chained batch and exposes tenant dashboard events', async () => {
    const firstId = randomUUID();
    const secondId = randomUUID();
    const firstHash = '1'.repeat(64);
    const secondHash = '2'.repeat(64);
    const base = {
      tenant_id: 'default',
      clinic_id: 'default',
      node_id: nodeId,
      camera_id: 'cam-01',
      zone_id: 'warehouse',
      event_type: 'inventory.after_hours_motion',
      subject_ref: null,
      confidence: 0.98,
      occurred_at: nowIso,
      received_at: nowIso,
      model_version: 'motion-v1',
      evidence_sha256: null,
      metadata: { channel: 1, privacy: 'no-video-upload' },
    };
    const batch = {
      events: [
        {
          ...base,
          id: firstId,
          dedup_key: `dedup-${firstId}`,
          previous_hash: '0'.repeat(64),
          record_hash: firstHash,
        },
        {
          ...base,
          id: secondId,
          dedup_key: `dedup-${secondId}`,
          previous_hash: firstHash,
          record_hash: secondHash,
        },
      ],
    };

    const ingest = await edgeRequest('/api/edge/v1/events/batch', batch);
    expect(ingest.status).toBe(200);
    expect(ingest.body.accepted_ids).toEqual([firstId, secondId]);

    const retry = await edgeRequest('/api/edge/v1/events/batch', batch);
    expect(retry.status).toBe(200);
    expect(retry.body.accepted_ids).toEqual([firstId, secondId]);

    const events = await request(app)
      .get('/api/v1/edge/events?camera_id=cam-01')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(events.status).toBe(200);
    expect(events.body.events.filter((event) => [firstId, secondId].includes(event.id)))
      .toHaveLength(2);

    const broken = {
      events: [{
        ...base,
        id: randomUUID(),
        dedup_key: `dedup-${randomUUID()}`,
        previous_hash: '9'.repeat(64),
        record_hash: '3'.repeat(64),
      }],
    };
    const rejected = await edgeRequest('/api/edge/v1/events/batch', broken);
    expect(rejected.status).toBe(409);
    expect(rejected.body.code).toBe('EDGE_CHAIN_MISMATCH');
  });

  it('never returns ciphertext and invalidates the old key on rotation', async () => {
    const list = await request(app)
      .get('/api/v1/edge/nodes')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const node = list.body.nodes.find((item) => item.node_id === nodeId);
    expect(node).toBeDefined();
    expect(node.signing_key).toBeUndefined();
    expect(node.signing_secret_ciphertext).toBeUndefined();

    const oldKey = signingKey;
    const oldKeyId = keyId;
    const rotation = await request(app)
      .post(`/api/v1/edge/nodes/${nodeId}/rotate-key`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(rotation.status).toBe(200);
    signingKey = rotation.body.signing_key;
    keyId = rotation.body.node.key_id;
    expect(signingKey).not.toBe(oldKey);

    const oldCredential = await edgeRequest('/api/edge/v1/nodes/register', registration, {
      signingKey: oldKey,
      keyId: oldKeyId,
    });
    expect(oldCredential.status).toBe(401);

    const newCredential = await edgeRequest('/api/edge/v1/nodes/register', registration);
    expect(newCredential.status).toBe(200);
  });
});
