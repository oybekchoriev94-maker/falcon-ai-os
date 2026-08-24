import { describe, it, expect, vi } from 'vitest';
import {
  calcPlatformFee, calcCommission,
  deductDoctorBalance, accruePatientCashback,
  redeemPatientCashback, topupDoctorBalance
} from '../backend/services/finance-engine.js';

describe('calcPlatformFee', () => {
  it('3% of amount', () => expect(calcPlatformFee(100000)).toBe(3000));
  it('rounds to 2 decimal', () => expect(calcPlatformFee(33333)).toBe(999.99));
  it('0 for 0', () => expect(calcPlatformFee(0)).toBe(0));
});

describe('calcCommission', () => {
  it('X% of amount', () => expect(calcCommission(100000, 10)).toBe(10000));
  it('non-integer percent', () => expect(calcCommission(200000, 3.5)).toBe(7000));
  it('0 for 0%', () => expect(calcCommission(50000, 0)).toBe(0));
});

describe('deductDoctorBalance', () => {
  it('deducts when sufficient inside the tenant', async () => {
    const q = vi.fn().mockResolvedValue({ rowCount: 1 });
    await expect(deductDoctorBalance(q, 'tenant-a', 'd1', 10000)).resolves.toBe(true);
    expect(q.mock.calls[0][0]).toContain('tenant_id = $2');
    expect(q.mock.calls[0][1]).toEqual([10000, 'tenant-a', 'd1', 10000]);
  });
  it('returns false when insufficient', async () => {
    const q = vi.fn().mockResolvedValue({ rowCount: 0 });
    await expect(deductDoctorBalance(q, 'tenant-a', 'd1', 999999)).resolves.toBe(false);
  });
});

describe('accruePatientCashback', () => {
  it('increments cashback inside the tenant', async () => {
    const q = vi.fn().mockResolvedValue({ rowCount: 1 });
    await accruePatientCashback(q, 'tenant-a', 'p1', 5000);
    expect(q.mock.calls[0][1]).toEqual([5000, 'tenant-a', 'p1']);
  });
});

describe('redeemPatientCashback', () => {
  it('deducts when sufficient inside the tenant', async () => {
    const q = vi.fn().mockResolvedValue({ rows: [{ id: 'p1' }] });
    await expect(redeemPatientCashback(q, 'tenant-a', 'p1', 10000)).resolves.toBe(true);
    expect(q.mock.calls[0][1]).toEqual([10000, 'tenant-a', 'p1', 10000]);
  });
});

describe('topupDoctorBalance', () => {
  it('increments balance inside the tenant', async () => {
    const q = vi.fn().mockResolvedValue({ rowCount: 1 });
    await topupDoctorBalance(q, 'tenant-a', 'd1', 20000);
    expect(q.mock.calls[0][1]).toEqual([20000, 'tenant-a', 'd1']);
  });
});
