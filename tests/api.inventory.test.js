import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { closeTestApp, getTestApp } from './helpers/test-app.js';

let app;
let adminToken;
let internalSecret;
let testItemId;
let testBatchId;
let testNormId;
let createdItemIds = [];

beforeAll(async () => {
  app = await getTestApp();
  internalSecret = process.env.INTERNAL_SECRET;

  // Login as admin
  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD });
  expect(loginRes.status).toBe(200);
  adminToken = loginRes.body.token;
});

afterAll(closeTestApp);

// ─── 1. POST /api/inventory/add ─────────────────────────────────
describe('POST /api/inventory/add', () => {
  const validItem = {
    name: 'Test Syringe',
    sku: 'TS-001',
    category: 'Medical',
    quantity: 100,
    unit: 'dona',
    cost_price: 5.0,
    min_stock: 10,
    batch_number: 'BATCH-TEST-001',
    expiration_date: '2027-12-31'
  };

  it('creates a new inventory item', async () => {
    const res = await request(app)
      .post('/api/inventory/add')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(validItem);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.is_update).toBe(false);
    expect(res.body.item.name).toBe('Test Syringe');
    expect(res.body.item.sku).toBe('TS-001');
    expect(res.body.item.current_stock).toBe(100);
    expect(res.body.batch_number).toBe('BATCH-TEST-001');
    testItemId = res.body.item.id;
  createdItemIds.push(testItemId);
});

  it('replenishes existing SKU (update mode)', async () => {
    const res = await request(app)
      .post('/api/inventory/add')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validItem, quantity: 50, batch_number: 'BATCH-TEST-002' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.is_update).toBe(true);
    expect(res.body.item.current_stock).toBe(150);
  });

  it('rejects without auth token', async () => {
    const res = await request(app)
      .post('/api/inventory/add')
      .send(validItem);
    expect(res.status).toBe(401);
  });

  it('rejects invalid body (missing required fields)', async () => {
    const res = await request(app)
      .post('/api/inventory/add')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Incomplete' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/validatsiya/i);
  });

  it('rejects non-positive quantity', async () => {
    const res = await request(app)
      .post('/api/inventory/add')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...validItem, sku: 'TS-NEG', quantity: -5 });
    expect(res.status).toBe(400);
  });
});

// ─── 2. GET /api/inventory/status ──────────────────────────────
describe('GET /api/inventory/status', () => {
  it('returns inventory items with batch metadata', async () => {
    const res = await request(app)
      .get('/api/inventory/status')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.total_value).toBeDefined();
    expect(res.body.low_count).toBeDefined();

    const ourItem = res.body.items.find(i => i.id === testItemId);
    expect(ourItem).toBeDefined();
    expect(ourItem.name).toBe('Test Syringe');
    expect(ourItem.current_stock).toBe(150);
    expect(ourItem.batch_count).toBeGreaterThanOrEqual(1);
  });

  it('rejects without auth', async () => {
    const res = await request(app).get('/api/inventory/status');
    expect(res.status).toBe(401);
  });
});

// ─── 3. GET /api/inventory/search ──────────────────────────────
describe('GET /api/inventory/search', () => {
  it('finds items by name', async () => {
    const res = await request(app)
      .get('/api/inventory/search?q=Syringe')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
    expect(res.body.items[0].name).toMatch(/Syringe/i);
  });

  it('finds items by SKU', async () => {
    const res = await request(app)
      .get('/api/inventory/search?q=TS-001')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for no match', async () => {
    const res = await request(app)
      .get('/api/inventory/search?q=ZZZZNOMATCH')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('rejects without auth', async () => {
    const res = await request(app).get('/api/inventory/search?q=Syringe');
    expect(res.status).toBe(401);
  });
});

// ─── 4. GET /api/inventory/batches/:item_id ────────────────────
describe('GET /api/inventory/batches/:item_id', () => {
  it('lists batches for an item', async () => {
    const res = await request(app)
      .get(`/api/inventory/batches/${testItemId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.item).toBeDefined();
    expect(res.body.item.id).toBe(testItemId);
    expect(Array.isArray(res.body.batches)).toBe(true);
    expect(res.body.batches.length).toBeGreaterThanOrEqual(1);
    testBatchId = res.body.batches[0].id;
  });

  it('returns null item for non-existent id', async () => {
    const res = await request(app)
      .get('/api/inventory/batches/99999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.item).toBeNull();
    expect(res.body.batches).toEqual([]);
  });

  it('rejects without auth', async () => {
    const res = await request(app).get(`/api/inventory/batches/${testItemId}`);
    expect(res.status).toBe(401);
  });
});

// ─── 5. PUT /api/inventory/batches/:id ─────────────────────────
describe('PUT /api/inventory/batches/:id', () => {
  it('updates batch expiration date', async () => {
    const res = await request(app)
      .put(`/api/inventory/batches/${testBatchId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ expiration_date: '2028-06-15' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.batch.expiration_date).toBe('2028-06-15');
  });

  it('updates batch number', async () => {
    const res = await request(app)
      .put(`/api/inventory/batches/${testBatchId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ batch_number: 'BATCH-UPDATED-001' });
    expect(res.status).toBe(200);
    expect(res.body.batch.batch_number).toBe('BATCH-UPDATED-001');
  });

  it('rejects updating non-existent batch', async () => {
    const res = await request(app)
      .put('/api/inventory/batches/99999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ batch_number: 'GHOST' });
    expect(res.status).toBe(404);
  });

  it('rejects without auth', async () => {
    const res = await request(app)
      .put(`/api/inventory/batches/${testBatchId}`)
      .send({ batch_number: 'NO-AUTH' });
    expect(res.status).toBe(401);
  });
});

// ─── 6. POST /api/inventory/consume (direct mode, agent bypass) ─
describe('POST /api/inventory/consume (direct via internal secret)', () => {
  it('consumes stock via FEFO with internal secret', async () => {
    const res = await request(app)
      .post('/api/inventory/consume')
      .set('x-internal-secret', internalSecret)
      .set('x-tenant-id', 'default')
      .send({
        item_id: testItemId,
        requested_quantity: 10,
        reason: 'Test consumption'
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.item_name).toBe('Test Syringe');
    expect(res.body.total_consumed).toBe(10);
    expect(res.body.batch_consumptions).toBeDefined();
    expect(res.body.batch_consumptions.length).toBeGreaterThanOrEqual(1);
    expect(res.body.balance_after).toBeLessThan(res.body.balance_before);
  });

  it('rejects with insufficient stock', async () => {
    const res = await request(app)
      .post('/api/inventory/consume')
      .set('x-internal-secret', internalSecret)
      .set('x-tenant-id', 'default')
      .send({
        item_id: testItemId,
        requested_quantity: 999999
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/yetarli/i);
  });

  it('rejects invalid body via Zod', async () => {
    const res = await request(app)
      .post('/api/inventory/consume')
      .set('x-internal-secret', internalSecret)
      .set('x-tenant-id', 'default')
      .send({ item_id: 'not-a-number' });
    expect(res.status).toBe(400);
  });

  it('rejects without auth or internal secret', async () => {
    const res = await request(app)
      .post('/api/inventory/consume')
      .send({ item_id: testItemId, requested_quantity: 1 });
    expect(res.status).toBe(401);
  });
});

// ─── 7. GET /api/inventory/transactions ────────────────────────
describe('GET /api/inventory/transactions', () => {
  it('returns recent transactions', async () => {
    const res = await request(app)
      .get('/api/inventory/transactions')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.transactions)).toBe(true);
    expect(res.body.transactions.length).toBeGreaterThanOrEqual(1);
    // Should have consumption transactions from the consume test
    const consumptionTx = res.body.transactions.find(t => t.type === 'CONSUMPTION');
    expect(consumptionTx).toBeDefined();
    expect(consumptionTx.item_name).toBeDefined();
    expect(consumptionTx.batch_number).toBeDefined();
  });

  it('respects limit query param', async () => {
    const res = await request(app)
      .get('/api/inventory/transactions?limit=2')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.transactions.length).toBeLessThanOrEqual(2);
  });

  it('rejects without auth', async () => {
    const res = await request(app).get('/api/inventory/transactions');
    expect(res.status).toBe(401);
  });
});

// ─── 8. DELETE /api/inventory/batches/:id ──────────────────────
describe('DELETE /api/inventory/batches/:id', () => {
  let deletableBatchId;

  beforeAll(async () => {
    const addRes = await request(app)
      .post('/api/inventory/add')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Deletable Item',
        sku: 'DEL-ITEM-001',
        quantity: 50,
        batch_number: 'BATCH-TO-DELETE'
      });
    if (addRes.status === 200) {
      createdItemIds.push(addRes.body.item.id);
      const batchRes = await request(app)
        .get(`/api/inventory/batches/${addRes.body.item.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      if (batchRes.body.batches.length > 0) {
        deletableBatchId = batchRes.body.batches[0].id;
      }
    }
  });

  it('deletes a batch', async () => {
    if (!deletableBatchId) return;
    const res = await request(app)
      .delete(`/api/inventory/batches/${deletableBatchId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/o'chirildi/i);
  });

  it('returns 404 for non-existent batch', async () => {
    const res = await request(app)
      .delete('/api/inventory/batches/99999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects without auth', async () => {
    const res = await request(app).delete('/api/inventory/batches/1');
    expect(res.status).toBe(401);
  });
});

// ─── 9. POST /api/internal/inventory/consume ───────────────────
describe('POST /api/internal/inventory/consume (agent endpoint)', () => {
  it('consumes via internal secret', async () => {
    const res = await request(app)
      .post('/api/internal/inventory/consume')
      .set('x-internal-secret', internalSecret)
      .set('x-tenant-id', 'default')
      .send({ item_id: testItemId, quantity: 5, reason: 'Internal agent test' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.item).toBe('Test Syringe');
    expect(res.body.quantity).toBe(5);
    expect(res.body.batch_consumptions).toBeDefined();
  });

  it('rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/internal/inventory/consume')
      .set('x-internal-secret', internalSecret)
      .set('x-tenant-id', 'default')
      .send({ item_id: testItemId });
    expect(res.status).toBe(400);
  });

  it('rejects with non-existent item', async () => {
    const res = await request(app)
      .post('/api/internal/inventory/consume')
      .set('x-internal-secret', internalSecret)
      .set('x-tenant-id', 'default')
      .send({ item_id: 99999, quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('rejects without auth', async () => {
    const res = await request(app)
      .post('/api/internal/inventory/consume')
      .send({ item_id: testItemId, quantity: 1 });
    expect(res.status).toBe(401);
  });
});

// ─── 10. GET /api/reports/inventory-waste ──────────────────────
describe('GET /api/reports/inventory-waste', () => {
  it('returns waste report with admin token (JWT)', async () => {
    const res = await request(app)
      .get('/api/reports/inventory-waste')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total_waste_sum).toBeDefined();
    expect(res.body.total_waste_qty).toBeDefined();
    expect(res.body.waste_transactions).toBeDefined();
    expect(Array.isArray(res.body.top_overused_items)).toBe(true);
    expect(Array.isArray(res.body.doctor_waste_ranking)).toBe(true);
  });

  it('rejects without auth', async () => {
    const res = await request(app).get('/api/reports/inventory-waste');
    expect(res.status).toBe(401);
  });
});

// ─── 11. GET /api/reports/limits ───────────────────────────────
describe('GET /api/reports/limits', () => {
  it('returns doctor monthly limits', async () => {
    const res = await request(app)
      .get('/api/reports/limits')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('rejects without auth', async () => {
    const res = await request(app).get('/api/reports/limits');
    expect(res.status).toBe(401);
  });
});

// ─── 12. POST /api/inventory/norms ─────────────────────────────
describe('POST /api/inventory/norms', () => {
  it('creates a procedure material norm', async () => {
    const res = await request(app)
      .post('/api/inventory/norms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        procedure_name: 'Test Procedure',
        item_id: testItemId,
        standard_quantity: 3
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.norm).toBeDefined();
    expect(res.body.norm.procedure_name).toBe('Test Procedure');
    expect(res.body.norm.item_id).toBe(testItemId);
    expect(res.body.norm.standard_quantity).toBe(3);
    testNormId = res.body.norm.id;
  });

  it('rejects invalid body (missing fields)', async () => {
    const res = await request(app)
      .post('/api/inventory/norms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ procedure_name: 'Incomplete' });
    expect(res.status).toBe(400);
  });

  it('rejects without auth', async () => {
    const res = await request(app)
      .post('/api/inventory/norms')
      .send({ procedure_name: 'X', item_id: 1, standard_quantity: 1 });
    expect(res.status).toBe(401);
  });
});

// ─── 13. GET /api/inventory/norms ──────────────────────────────
describe('GET /api/inventory/norms', () => {
  it('lists all norms', async () => {
    const res = await request(app)
      .get('/api/inventory/norms')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.norms)).toBe(true);
    const ourNorm = res.body.norms.find(n => n.id === testNormId);
    expect(ourNorm).toBeDefined();
    expect(ourNorm.item_name).toBe('Test Syringe');
  });

  it('rejects without auth', async () => {
    const res = await request(app).get('/api/inventory/norms');
    expect(res.status).toBe(401);
  });
});

// ─── 14. PUT /api/inventory/norms/:id ──────────────────────────
describe('PUT /api/inventory/norms/:id', () => {
  it('updates a norm', async () => {
    const res = await request(app)
      .put(`/api/inventory/norms/${testNormId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ standard_quantity: 5 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.norm.standard_quantity).toBe(5);
  });

  it('updates procedure_name', async () => {
    const res = await request(app)
      .put(`/api/inventory/norms/${testNormId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ procedure_name: 'Updated Procedure' });
    expect(res.status).toBe(200);
    expect(res.body.norm.procedure_name).toBe('Updated Procedure');
  });

  it('returns 404 for non-existent norm', async () => {
    const res = await request(app)
      .put('/api/inventory/norms/99999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ standard_quantity: 1 });
    expect(res.status).toBe(404);
  });

  it('rejects with empty body', async () => {
    const res = await request(app)
      .put(`/api/inventory/norms/${testNormId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('rejects without auth', async () => {
    const res = await request(app)
      .put(`/api/inventory/norms/${testNormId}`)
      .send({ standard_quantity: 1 });
    expect(res.status).toBe(401);
  });
});

// ─── 15. DELETE /api/inventory/norms/:id ───────────────────────
describe('DELETE /api/inventory/norms/:id', () => {
  it('deletes a norm', async () => {
    const res = await request(app)
      .delete(`/api/inventory/norms/${testNormId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/o'chirildi/i);
  });

  it('returns 404 for already-deleted norm', async () => {
    const res = await request(app)
      .delete(`/api/inventory/norms/${testNormId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects without auth', async () => {
    const res = await request(app).delete('/api/inventory/norms/1');
    expect(res.status).toBe(401);
  });
});

// ─── 16. POST /api/inventory/consume with JWT (procedure mode) ─
describe('POST /api/inventory/consume (procedure mode with JWT)', () => {
  beforeAll(async () => {
    // Ensure a norm exists for procedure-based consumption
    await request(app)
      .post('/api/inventory/norms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        procedure_name: 'FEFO Test Proc',
        item_id: testItemId,
        standard_quantity: 2
      });
  });

  it('consumes via procedure name with JWT auth', async () => {
    const res = await request(app)
      .post('/api/inventory/consume')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ procedure_name: 'FEFO Test Proc' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.procedure).toBe('FEFO Test Proc');
    expect(res.body.materials_used).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  it('returns 404 for unknown procedure', async () => {
    const res = await request(app)
      .post('/api/inventory/consume')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ procedure_name: 'NonExistentProcedureXYZ' });
    expect(res.status).toBe(404);
  });

  it('rejects without auth and without internal secret', async () => {
    const res = await request(app)
      .post('/api/inventory/consume')
      .send({ procedure_name: 'FEFO Test Proc' });
    expect(res.status).toBe(401);
  });
});
