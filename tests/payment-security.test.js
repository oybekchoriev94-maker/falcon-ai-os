import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  delete process.env.UZUM_SECRET;
  delete process.env.PAYME_MERCHANT_KEY;
  vi.resetModules();
});

describe('payment webhook authentication', () => {
  it('accepts a valid Uzum bearer secret and rejects a wrong one', async () => {
    process.env.UZUM_SECRET = crypto.randomBytes(32).toString('hex');
    const { verifyUzumAuth } = await import('../backend/services/payment-gateway.js');

    expect(verifyUzumAuth({ headers: { authorization: `Bearer ${process.env.UZUM_SECRET}` }, body: {} })).toBe(true);
    expect(verifyUzumAuth({ headers: { authorization: `Bearer ${crypto.randomBytes(32).toString('hex')}` }, body: {} })).toBe(false);
  });

  it('accepts a valid Uzum HMAC signature', async () => {
    process.env.UZUM_SECRET = crypto.randomBytes(32).toString('hex');
    const body = { orderId: 'order-1', amount: 100000, status: 'paid' };
    const signature = crypto.createHmac('sha256', process.env.UZUM_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
    const { verifyUzumAuth } = await import('../backend/services/payment-gateway.js');

    expect(verifyUzumAuth({ headers: { 'x-uzum-signature': signature }, body })).toBe(true);
  });

  it('fails closed when Uzum secret is missing', async () => {
    const { verifyUzumAuth } = await import('../backend/services/payment-gateway.js');
    expect(verifyUzumAuth({ headers: {}, body: {} })).toBe(false);
  });
});
