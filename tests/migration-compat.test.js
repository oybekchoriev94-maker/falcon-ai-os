import { describe, expect, it } from 'vitest';
import {
  KNOWN_LEGACY_PRODUCTION_MIGRATIONS,
  assertKnownLegacyMigrationHistory,
  findMissingAppliedMigrations,
} from '../scripts/migration-compat.js';

describe('legacy production migration compatibility', () => {
  it('detects applied migration records whose files are no longer present', () => {
    expect(findMissingAppliedMigrations(
      ['001_initial_schema.js', '007_services_and_receipts.js'],
      ['001_initial_schema.js', '007_tenant_isolation_and_tma_integrity.js'],
    )).toEqual(['007_services_and_receipts.js']);
  });

  it('allows only the explicitly audited legacy production history', () => {
    expect(assertKnownLegacyMigrationHistory(
      KNOWN_LEGACY_PRODUCTION_MIGRATIONS,
    )).toBe(true);
    expect(assertKnownLegacyMigrationHistory([])).toBe(false);
  });

  it('keeps validation enabled for any unknown missing migration', () => {
    expect(() => assertKnownLegacyMigrationHistory([
      '007_services_and_receipts.js',
      '999_unreviewed_hotfix.js',
    ])).toThrow('unknown missing files: 999_unreviewed_hotfix.js');
  });
});
