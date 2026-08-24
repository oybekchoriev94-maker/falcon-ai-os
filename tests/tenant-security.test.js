import { describe, expect, it } from 'vitest';
import { findUnscopedTable, TenantScopeError, assertTenantScoped } from '../backend/tenant-guard.js';
import { tenantContext } from '../backend/tenant-context.js';
import { agentBypassOrAuth, isValidInternalSecret } from '../backend/shared.js';

describe('tenantContext', () => {
  it('ignores client-controlled tenant header and query string', () => {
    const req = {
      headers: { 'x-tenant-id': 'victim-clinic' },
      query: { tenant_id: 'victim-clinic' },
    };
    tenantContext(req, {}, () => {});
    expect(req.tenant_id).toBeNull();
  });
});

describe('tenant SQL guard', () => {
  it('rejects tenant_id selected as data but not used as a predicate', () => {
    expect(findUnscopedTable('SELECT id, tenant_id FROM patients ORDER BY created_at')).toBe('patients');
  });

  it('accepts an alias-scoped predicate', () => {
    expect(findUnscopedTable('SELECT p.id FROM patients p WHERE p.tenant_id = $1')).toBeNull();
  });

  it('rejects an insert without tenant_id', () => {
    expect(findUnscopedTable('INSERT INTO bookings (doctor_id, patient_name) VALUES ($1, $2)')).toBe('bookings');
  });

  it('accepts an insert that explicitly stores tenant_id', () => {
    expect(findUnscopedTable('INSERT INTO bookings (tenant_id, doctor_id) VALUES ($1, $2)')).toBeNull();
  });

  it('blocks unscoped queries by default', () => {
    expect(() => assertTenantScoped('DELETE FROM patients WHERE id = $1')).toThrow(TenantScopeError);
  });
});

describe('internal agent secret', () => {
  it('fails closed when INTERNAL_SECRET is not configured', () => {
    const previous = process.env.INTERNAL_SECRET;
    delete process.env.INTERNAL_SECRET;
    try {
      expect(isValidInternalSecret(undefined)).toBe(false);

      let nextCalled = false;
      const req = { headers: { 'x-tenant-id': 'victim-clinic' } };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json() { return this; },
      };
      agentBypassOrAuth('admin')(req, res, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(res.statusCode).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.INTERNAL_SECRET;
      else process.env.INTERNAL_SECRET = previous;
    }
  });
});
