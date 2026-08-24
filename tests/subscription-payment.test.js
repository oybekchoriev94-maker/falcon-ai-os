import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomBytes } from 'node:crypto';

const dbMocks = vi.hoisted(() => ({
  q: vi.fn(),
  qGet: vi.fn(),
}));

vi.mock('../backend/db.js', () => dbMocks);

import subscriptionRoutes from '../backend/routes/subscription.js';
import { signToken } from '../backend/shared.js';

describe('paid subscription changes', () => {
  beforeEach(() => {
    dbMocks.q.mockReset().mockResolvedValue([]);
    dbMocks.qGet.mockReset();
    process.env.JWT_SECRET = randomBytes(32).toString('hex');
  });

  it('creates a pending payment and does not activate a paid plan immediately', async () => {
    dbMocks.qGet.mockResolvedValueOnce({
      id: 'plan_pro', code: 'pro', name: 'Professional',
      monthly_price: 790000, annual_price: 7900000, active: true,
    });

    const app = express();
    app.use(express.json());
    app.locals.pool = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    app.use('/subscription', subscriptionRoutes());

    const token = signToken({
      id: 'user-1', role: 'ceo', tenant_id: 'tenant-a', username: 'ceo', name: 'CEO',
    });
    const response = await request(app)
      .post('/subscription/change')
      .set('Authorization', `Bearer ${token}`)
      .send({ plan_id: 'plan_pro', billing_cycle: 'monthly' });

    expect(response.status).toBe(202);
    expect(response.body.activated).toBe(false);
    expect(response.body.amount).toBe(790000);
    expect(dbMocks.q).toHaveBeenCalledTimes(1);
    expect(dbMocks.q.mock.calls[0][0]).toContain("'subscription_upgrade', 'pending'");
    expect(dbMocks.q.mock.calls[0][0]).not.toContain('UPDATE subscriptions');
  });
});
