import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { refreshWindowSeconds, validateRefreshClaims } from '../backend/routes/auth.js';
import { JWT_VERIFY_OPTIONS, signToken } from '../backend/shared.js';

describe('authentication session policy', () => {
  it('signs only HS256 tokens with the expected issuer and audience', () => {
    const previousSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret-with-at-least-32-chars';
    try {
      const token = signToken({
        id: 'user-id', tenant_id: 'tenant-id', username: 'admin', role: 'admin', name: 'Admin',
      });
      const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_VERIFY_OPTIONS);
      expect(decoded).toMatchObject({
        id: 'user-id', tenant_id: 'tenant-id', iss: 'falcon-ai-os', aud: 'falcon-clinic-api',
      });
      expect(jwt.decode(token, { complete: true }).header.alg).toBe('HS256');
    } finally {
      if (previousSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previousSecret;
    }
  });

  it('uses a seven-day refresh window by default', () => {
    expect(refreshWindowSeconds({})).toBe(7 * 24 * 60 * 60);
  });

  it('rejects invalid refresh window configuration', () => {
    expect(() => refreshWindowSeconds({ JWT_REFRESH_WINDOW_DAYS: '0' })).toThrow(/1 dan 30/);
    expect(() => refreshWindowSeconds({ JWT_REFRESH_WINDOW_DAYS: '31' })).toThrow(/1 dan 30/);
    expect(() => refreshWindowSeconds({ JWT_REFRESH_WINDOW_DAYS: '1.5' })).toThrow(/1 dan 30/);
  });

  it('accepts a complete token inside the refresh window', () => {
    const now = 2_000_000;
    const expiresAt = validateRefreshClaims({
      jti: 'session-id',
      id: 'user-id',
      tenant_id: 'tenant-id',
      iat: now - 60,
    }, now, 600);

    expect(expiresAt).toBe(now + 540);
  });

  it('rejects stale, future-dated and incomplete refresh tokens', () => {
    const base = { jti: 'session-id', id: 'user-id', tenant_id: 'tenant-id' };
    expect(() => validateRefreshClaims({ ...base, iat: 100 }, 1_000, 600)).toThrow(/muddati tugagan/);
    expect(() => validateRefreshClaims({ ...base, iat: 1_061 }, 1_000, 600)).toThrow(/muddati tugagan/);
    expect(() => validateRefreshClaims({ iat: 900 }, 1_000, 600)).toThrow(/majburiy session/);
  });
});
