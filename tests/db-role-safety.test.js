import { describe, expect, it } from 'vitest';
import {
  assertApplicationRoleIsRlsSafe,
  assertPlatformRoleCanBypassRls,
} from '../backend/db.js';

function rolePool(overrides = {}) {
  const role = {
    role_name: 'falcon_app',
    is_superuser: false,
    bypasses_rls: false,
    has_rls_tables: true,
    owns_rls_tables: false,
    owns_all_rls_tables: false,
    ...overrides,
  };
  return { query: async () => ({ rows: [role] }) };
}

describe('database role safety checks', () => {
  it('accepts an RLS-constrained application role', async () => {
    const role = await assertApplicationRoleIsRlsSafe(rolePool());
    expect(role.role_name).toBe('falcon_app');
  });

  it.each([
    ['superuser', { is_superuser: true }],
    ['BYPASSRLS', { bypasses_rls: true }],
    ['table owner', { owns_rls_tables: true }],
    ['missing RLS', { has_rls_tables: false }],
  ])('rejects an application role that is %s', async (_label, overrides) => {
    await expect(assertApplicationRoleIsRlsSafe(rolePool(overrides)))
      .rejects.toThrow('RLS application role xavfsiz emas');
  });

  it('accepts a platform role that can bypass every RLS policy', async () => {
    const role = await assertPlatformRoleCanBypassRls(rolePool({
      role_name: 'falcon_owner',
      owns_rls_tables: true,
      owns_all_rls_tables: true,
    }));
    expect(role.role_name).toBe('falcon_owner');
  });

  it('rejects a constrained application role as the platform connection', async () => {
    await expect(assertPlatformRoleCanBypassRls(rolePool()))
      .rejects.toThrow('Platform DB roli cross-tenant operatsiyalar uchun yetarli emas');
  });
});
